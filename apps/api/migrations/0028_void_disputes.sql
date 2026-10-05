CREATE TABLE "purchase_void_disputes" (
	"confirmation_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"note" varchar(500) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_void_rulings" (
	"confirmation_id" uuid PRIMARY KEY NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"decision" varchar(20) NOT NULL,
	"reason" varchar(500) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_void_ruling_decision" CHECK ("purchase_void_rulings"."decision" in ('upheld', 'reversed'))
);
--> statement-breakpoint
ALTER TABLE "funding_transfers" DROP CONSTRAINT "funding_transfer_kind";--> statement-breakpoint
ALTER TABLE "purchase_void_disputes" ADD CONSTRAINT "purchase_void_disputes_confirmation_id_purchase_confirmations_id_fk" FOREIGN KEY ("confirmation_id") REFERENCES "public"."purchase_confirmations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_void_disputes" ADD CONSTRAINT "purchase_void_disputes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_void_rulings" ADD CONSTRAINT "purchase_void_rulings_confirmation_id_purchase_confirmations_id_fk" FOREIGN KEY ("confirmation_id") REFERENCES "public"."purchase_confirmations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_void_rulings" ADD CONSTRAINT "purchase_void_rulings_reviewer_id_accounts_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_transfers" ADD CONSTRAINT "funding_transfer_kind" CHECK ("funding_transfers"."kind" in ('funding_confirmed', 'task_lock', 'task_reward', 'purchase_cashback', 'prize_claim', 'payout_hold', 'payout_paid', 'payout_returned', 'campaign_return', 'prize_handover', 'prize_cash_value', 'void_reversal'));
--> statement-breakpoint
-- A voided purchase still holds its place and its money while the shopper
-- may dispute it (7 days) or while a dispute waits for a reviewer.
CREATE FUNCTION purchase_void_open(confirmation uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM purchase_voids v WHERE v.confirmation_id = confirmation
    AND NOT EXISTS (SELECT 1 FROM purchase_void_rulings r WHERE r.confirmation_id = confirmation)
    AND (v.created_at > clock_timestamp() - interval '7 days'
      OR EXISTS (SELECT 1 FROM purchase_void_disputes d WHERE d.confirmation_id = confirmation)))
$$;
--> statement-breakpoint
-- Whether a purchase uses one of the campaign's places: not voided, voided but
-- still open, or voided and then reversed (the shopper was paid).
CREATE FUNCTION purchase_holds_place(confirmation uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT NOT EXISTS (SELECT 1 FROM purchase_voids v WHERE v.confirmation_id = confirmation)
    OR purchase_void_open(confirmation)
    OR EXISTS (SELECT 1 FROM purchase_void_rulings r WHERE r.confirmation_id = confirmation AND r.decision = 'reversed')
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION purchase_void() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p purchase_confirmations%ROWTYPE; owner uuid; total bigint; voided bigint;
BEGIN
  SELECT * INTO p FROM purchase_confirmations WHERE id = NEW.confirmation_id FOR UPDATE;
  SELECT sp.owner_id INTO owner FROM sponsor_tasks t JOIN sponsor_profiles sp ON sp.id = t.sponsor_id WHERE t.id = p.task_id;
  IF p.id IS NULL OR owner IS DISTINCT FROM NEW.actor_id OR clock_timestamp() >= p.release_at
    OR NOT EXISTS (SELECT 1 FROM accounts WHERE id = owner AND access_state = 'active')
    OR EXISTS (SELECT 1 FROM purchase_releases WHERE confirmation_id = p.id)
    OR length(btrim(NEW.reason)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Purchase cannot be voided' USING ERRCODE = '23514';
  END IF;
  -- A business may void at most 20% of a campaign's purchases (always at least
  -- 3), so it cannot take the sales and cancel everyone's cash back.
  PERFORM id FROM sponsor_tasks WHERE id = p.task_id FOR UPDATE;
  SELECT count(*) INTO total FROM purchase_confirmations WHERE task_id = p.task_id;
  SELECT count(*) INTO voided FROM purchase_voids v JOIN purchase_confirmations c ON c.id = v.confirmation_id
    WHERE c.task_id = p.task_id;
  IF voided + 1 > greatest(3, floor(total * 0.2)) THEN
    RAISE EXCEPTION 'Void limit reached' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION purchase_confirm() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c purchase_codes%ROWTYPE; t sponsor_tasks%ROWTYPE; owner uuid; used bigint;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'READ COMMITTED required' USING ERRCODE='23514'; END IF;
  SELECT * INTO c FROM purchase_codes WHERE id = NEW.code_id;
  -- Capacity is serialized per campaign; the daily limit per shopper across campaigns.
  SELECT * INTO t FROM sponsor_tasks WHERE id = c.task_id FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtextextended('purchase-shopper:' || c.account_id::text, 0));
  SELECT owner_id INTO owner FROM sponsor_profiles WHERE id = t.sponsor_id;
  IF c.id IS NULL OR c.task_id <> NEW.task_id OR c.account_id <> NEW.account_id
    OR c.expires_at <= clock_timestamp()
    -- The owner, or active staff with an active account, confirm at the till.
    OR (owner IS DISTINCT FROM NEW.actor_id AND NOT (business_staff_active(t.sponsor_id, NEW.actor_id)
      AND EXISTS (SELECT 1 FROM accounts WHERE id = NEW.actor_id AND access_state = 'active')))
    OR NOT purchase_campaign_live(t, NEW.account_id)
    OR NEW.amount_kobo < (t.campaign_terms->>'minSpendKobo')::bigint THEN
    RAISE EXCEPTION 'Purchase cannot be confirmed' USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO used FROM purchase_confirmations p WHERE p.task_id = t.id
    AND purchase_holds_place(p.id);
  IF used >= t.capacity THEN RAISE EXCEPTION 'Campaign is full' USING ERRCODE = '23514'; END IF;
  -- A staff member confirms at most 100 purchases a day; the owner is not capped.
  IF owner IS DISTINCT FROM NEW.actor_id AND (SELECT count(*) FROM purchase_confirmations
      WHERE actor_id = NEW.actor_id AND task_id = t.id
        AND created_at > clock_timestamp() - interval '24 hours') >= 100 THEN
    RAISE EXCEPTION 'Staff daily confirmation limit reached' USING ERRCODE = '23514';
  END IF;
  IF (SELECT count(*) FROM purchase_confirmations WHERE account_id = NEW.account_id
      AND created_at > clock_timestamp() - interval '24 hours') >= 5 THEN
    RAISE EXCEPTION 'Shopper daily purchase limit reached' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  NEW.release_at := NEW.created_at + (t.campaign_terms->>'holdHours')::integer * interval '1 hour';
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION campaign_return_request() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  t sponsor_tasks%ROWTYPE;
  published boolean;
  balance numeric;
  owed numeric := 0;
BEGIN
  SELECT * INTO t FROM sponsor_tasks WHERE id = NEW.task_id FOR UPDATE;
  IF t.id IS NULL OR NOT EXISTS (
      SELECT 1 FROM sponsor_profiles sp JOIN accounts a ON a.id = sp.owner_id
      WHERE sp.id = t.sponsor_id AND sp.owner_id = NEW.actor_id AND a.access_state = 'active') THEN
    RAISE EXCEPTION 'Campaign funds cannot be returned' USING ERRCODE = '23514';
  END IF;
  published := EXISTS (SELECT 1 FROM task_publications WHERE task_id = t.id);
  -- Live campaigns keep their money. Ended cash back and prize promotions can
  -- return it; jobs only before publication (open appeals may still pay).
  IF published AND (t.ends_at > clock_timestamp() OR t.model NOT IN ('purchase_cashback', 'claim_code')) THEN
    RAISE EXCEPTION 'Campaign funds are still in use' USING ERRCODE = '23514';
  END IF;
  -- Serialize with every other movement of this allocation.
  PERFORM id FROM funding_accounts WHERE id = t.allocation_account_id FOR UPDATE;
  SELECT coalesce(sum(CASE WHEN destination_id = t.allocation_account_id THEN amount_kobo ELSE -amount_kobo END), 0)
    INTO balance FROM funding_transfers
    WHERE source_id = t.allocation_account_id OR destination_id = t.allocation_account_id;
  -- Cash back already earned by shoppers stays locked until they release it.
  IF t.model = 'purchase_cashback' THEN
    -- Voided cash back stays locked for 7 days, or until a dispute is decided.
    SELECT count(*) * t.reward_kobo INTO owed FROM purchase_confirmations p
      WHERE p.task_id = t.id AND (purchase_void_open(p.id) OR (
        NOT EXISTS (SELECT 1 FROM purchase_voids v WHERE v.confirmation_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM purchase_releases r WHERE r.confirmation_id = p.id)));
  END IF;
  -- Item prizes not yet handed over or cashed out stay locked for the winner.
  IF t.model = 'claim_code' THEN
    SELECT count(*) * t.reward_kobo INTO owed FROM prize_vouchers v
      WHERE v.task_id = t.id
        AND NOT EXISTS (SELECT 1 FROM prize_handovers h WHERE h.redemption_id = v.redemption_id)
        AND NOT EXISTS (SELECT 1 FROM prize_cash_outs c WHERE c.redemption_id = v.redemption_id);
  END IF;
  IF balance - owed <= 0 THEN
    RAISE EXCEPTION 'Nothing to return' USING ERRCODE = '23514';
  END IF;
  NEW.amount_kobo := balance - owed;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION funding_validate_transfer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  source_row funding_accounts%ROWTYPE;
  destination_row funding_accounts%ROWTYPE;
  available numeric;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Funding writes require READ COMMITTED isolation' USING ERRCODE = '23514';
  END IF;
  -- Every writer serializes against the same account rows, in UUID order.
  -- There are no provider calls or long-running work inside this transaction.
  PERFORM id FROM funding_accounts WHERE id IN (NEW.source_id, NEW.destination_id) ORDER BY id FOR UPDATE;
  SELECT * INTO source_row FROM funding_accounts WHERE id = NEW.source_id;
  SELECT * INTO destination_row FROM funding_accounts WHERE id = NEW.destination_id;
  IF source_row.id IS NULL OR destination_row.id IS NULL THEN
    RAISE EXCEPTION 'Funding account not found' USING ERRCODE = '23503';
  END IF;
  IF NEW.kind = 'funding_confirmed' THEN
    IF source_row.bucket <> 'clearing' OR destination_row.bucket <> 'available' THEN
      RAISE EXCEPTION 'Invalid funding path' USING ERRCODE = '23514';
    END IF;
    IF NEW.reference LIKE 'intent:%' AND NOT EXISTS (
      SELECT 1 FROM funding_intents i WHERE NEW.reference = 'intent:' || i.id::text
        AND i.account_id = destination_row.owner_id AND i.amount_kobo = NEW.amount_kobo
    ) THEN RAISE EXCEPTION 'Funding does not match its intent' USING ERRCODE = '23514'; END IF;
  ELSIF NEW.kind = 'task_lock' THEN
    IF source_row.bucket <> 'available' OR destination_row.bucket <> 'task_locked'
      OR source_row.owner_id IS DISTINCT FROM destination_row.owner_id
      OR NEW.actor_id IS DISTINCT FROM source_row.owner_id THEN
      RAISE EXCEPTION 'Invalid allocation path' USING ERRCODE = '23514';
    END IF;
    PERFORM id FROM accounts WHERE id = source_row.owner_id AND access_state = 'active' FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Sponsor access is not active' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.kind = 'task_reward' THEN
    IF source_row.bucket <> 'task_locked' OR destination_row.bucket <> 'reward_wallet'
      OR NOT EXISTS (
        SELECT 1 FROM task_claims c JOIN sponsor_tasks t ON t.id=c.task_id
        WHERE NEW.reference = 'claim:' || c.id::text AND t.allocation_account_id=NEW.source_id
          AND c.account_id=destination_row.owner_id AND t.reward_kobo=NEW.amount_kobo
          AND (
            EXISTS (SELECT 1 FROM task_proofs p JOIN proof_decisions d ON d.proof_id=p.id
              WHERE p.claim_id=c.id AND d.decision='approved' AND d.actor_id=NEW.actor_id)
            OR EXISTS (SELECT 1 FROM task_proofs p JOIN task_appeals a ON a.proof_id=p.id
              JOIN appeal_resolutions r ON r.appeal_id=a.id
              WHERE p.claim_id=c.id AND r.decision='approved' AND r.actor_id=NEW.actor_id)
          )
      ) THEN RAISE EXCEPTION 'Invalid reward path' USING ERRCODE='23514'; END IF;
  ELSIF NEW.kind = 'purchase_cashback' THEN
    IF source_row.bucket <> 'task_locked' OR destination_row.bucket <> 'reward_wallet'
      OR NOT EXISTS (
        SELECT 1 FROM purchase_confirmations p JOIN sponsor_tasks t ON t.id=p.task_id
        JOIN purchase_releases r ON r.confirmation_id=p.id
        WHERE NEW.reference = 'purchase:' || p.id::text AND t.allocation_account_id=NEW.source_id
          AND p.account_id=destination_row.owner_id AND NEW.actor_id=p.account_id
          AND t.reward_kobo=NEW.amount_kobo
          AND NOT EXISTS (SELECT 1 FROM purchase_voids v WHERE v.confirmation_id=p.id)
      ) THEN RAISE EXCEPTION 'Invalid cash back path' USING ERRCODE='23514'; END IF;
  ELSIF NEW.kind = 'prize_claim' THEN
    IF source_row.bucket <> 'task_locked' OR destination_row.bucket <> 'reward_wallet'
      OR NOT EXISTS (
        SELECT 1 FROM claim_redemptions r JOIN sponsor_tasks t ON t.id = r.task_id
        WHERE NEW.reference = 'claim-code:' || r.id::text AND t.allocation_account_id = NEW.source_id
          AND r.account_id = destination_row.owner_id AND NEW.actor_id = r.account_id
          AND t.reward_kobo = NEW.amount_kobo
      ) THEN RAISE EXCEPTION 'Invalid prize path' USING ERRCODE='23514'; END IF;
  ELSIF NEW.kind = 'payout_hold' THEN
    IF source_row.bucket <> 'reward_wallet' OR destination_row.bucket <> 'payout_hold'
      OR source_row.owner_id IS DISTINCT FROM destination_row.owner_id
      OR NEW.actor_id IS DISTINCT FROM source_row.owner_id
      OR NOT EXISTS (SELECT 1 FROM withdrawals w WHERE NEW.reference = 'withdrawal:' || w.id::text
        AND w.account_id = source_row.owner_id AND w.amount_kobo = NEW.amount_kobo)
    THEN RAISE EXCEPTION 'Invalid withdrawal hold' USING ERRCODE = '23514'; END IF;
  ELSIF NEW.kind IN ('payout_paid', 'payout_returned') THEN
    IF source_row.bucket <> 'payout_hold'
      OR (NEW.kind = 'payout_paid' AND destination_row.bucket <> 'clearing')
      OR (NEW.kind = 'payout_returned' AND (destination_row.bucket <> 'reward_wallet'
        OR destination_row.owner_id IS DISTINCT FROM source_row.owner_id))
      OR NOT EXISTS (SELECT 1 FROM withdrawals w JOIN withdrawal_outcomes o ON o.withdrawal_id = w.id
        WHERE w.account_id = source_row.owner_id AND w.amount_kobo = NEW.amount_kobo
          AND NEW.actor_id = w.account_id
          AND ((NEW.kind = 'payout_paid' AND o.outcome = 'paid' AND NEW.reference = 'withdrawal-paid:' || w.id::text)
            OR (NEW.kind = 'payout_returned' AND o.outcome = 'failed' AND NEW.reference = 'withdrawal-returned:' || w.id::text)))
    THEN RAISE EXCEPTION 'Invalid withdrawal settlement' USING ERRCODE = '23514'; END IF;
  ELSIF NEW.kind = 'campaign_return' THEN
    IF source_row.bucket <> 'task_locked' OR destination_row.bucket <> 'available'
      OR source_row.owner_id IS DISTINCT FROM destination_row.owner_id
      OR NEW.actor_id IS DISTINCT FROM source_row.owner_id
      OR NOT EXISTS (SELECT 1 FROM campaign_returns c JOIN sponsor_tasks t ON t.id = c.task_id
        WHERE NEW.reference = 'campaign-return:' || c.id::text AND t.allocation_account_id = NEW.source_id
          AND c.amount_kobo = NEW.amount_kobo)
    THEN RAISE EXCEPTION 'Invalid campaign return' USING ERRCODE = '23514'; END IF;
  ELSIF NEW.kind = 'prize_handover' THEN
    -- The deposit for a handed-over item returns to the business owner.
    IF source_row.bucket <> 'task_locked' OR destination_row.bucket <> 'available'
      OR source_row.owner_id IS DISTINCT FROM destination_row.owner_id
      OR NOT EXISTS (SELECT 1 FROM prize_handovers h JOIN claim_redemptions r ON r.id = h.redemption_id
        JOIN sponsor_tasks t ON t.id = r.task_id
        WHERE NEW.reference = 'prize-handover:' || h.redemption_id::text
          AND t.allocation_account_id = NEW.source_id AND t.reward_kobo = NEW.amount_kobo
          AND NEW.actor_id = h.actor_id)
    THEN RAISE EXCEPTION 'Invalid prize handover' USING ERRCODE = '23514'; END IF;
  ELSIF NEW.kind = 'prize_cash_value' THEN
    IF source_row.bucket <> 'task_locked' OR destination_row.bucket <> 'reward_wallet'
      OR NOT EXISTS (SELECT 1 FROM prize_cash_outs c JOIN claim_redemptions r ON r.id = c.redemption_id
        JOIN sponsor_tasks t ON t.id = r.task_id
        WHERE NEW.reference = 'prize-cash:' || c.redemption_id::text
          AND t.allocation_account_id = NEW.source_id AND t.reward_kobo = NEW.amount_kobo
          AND r.account_id = destination_row.owner_id AND NEW.actor_id = r.account_id)
    THEN RAISE EXCEPTION 'Invalid prize cash value' USING ERRCODE = '23514'; END IF;
  ELSIF NEW.kind = 'void_reversal' THEN
    IF source_row.bucket <> 'task_locked' OR destination_row.bucket <> 'reward_wallet'
      OR NOT EXISTS (SELECT 1 FROM purchase_void_rulings r JOIN purchase_confirmations p ON p.id = r.confirmation_id
        JOIN sponsor_tasks t ON t.id = p.task_id
        WHERE NEW.reference = 'void-reversal:' || p.id::text AND r.decision = 'reversed'
          AND t.allocation_account_id = NEW.source_id AND t.reward_kobo = NEW.amount_kobo
          AND p.account_id = destination_row.owner_id AND NEW.actor_id = r.reviewer_id)
    THEN RAISE EXCEPTION 'Invalid void reversal' USING ERRCODE = '23514'; END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported funding operation' USING ERRCODE = '23514';
  END IF;
  IF source_row.bucket <> 'clearing' THEN
    SELECT coalesce(sum(CASE WHEN destination_id = NEW.source_id THEN amount_kobo ELSE -amount_kobo END), 0)
      INTO available FROM funding_transfers WHERE source_id = NEW.source_id OR destination_id = NEW.source_id;
    IF available < NEW.amount_kobo THEN
      RAISE EXCEPTION 'Insufficient available sponsor funds' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION purchase_void_dispute() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p purchase_confirmations%ROWTYPE; v purchase_voids%ROWTYPE;
BEGIN
  SELECT * INTO p FROM purchase_confirmations WHERE id = NEW.confirmation_id FOR UPDATE;
  SELECT * INTO v FROM purchase_voids WHERE confirmation_id = NEW.confirmation_id;
  IF p.id IS NULL OR v.confirmation_id IS NULL OR p.account_id IS DISTINCT FROM NEW.account_id
    OR v.created_at <= clock_timestamp() - interval '7 days'
    OR NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND access_state = 'active')
    OR length(btrim(NEW.note)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Dispute unavailable' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER purchase_void_dispute BEFORE INSERT ON purchase_void_disputes FOR EACH ROW EXECUTE FUNCTION purchase_void_dispute();
--> statement-breakpoint
-- An appointed reviewer decides, never the business owner or the shopper.
CREATE FUNCTION purchase_void_ruling() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p purchase_confirmations%ROWTYPE; owner uuid;
BEGIN
  SELECT * INTO p FROM purchase_confirmations WHERE id = NEW.confirmation_id FOR UPDATE;
  SELECT sp.owner_id INTO owner FROM sponsor_tasks t JOIN sponsor_profiles sp ON sp.id = t.sponsor_id WHERE t.id = p.task_id;
  IF p.id IS NULL OR NOT EXISTS (SELECT 1 FROM purchase_void_disputes d WHERE d.confirmation_id = p.id)
    OR NOT staff_reviewer_active(NEW.reviewer_id)
    OR NEW.reviewer_id = owner OR NEW.reviewer_id = p.account_id
    OR length(btrim(NEW.reason)) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'Ruling unavailable' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER purchase_void_ruling BEFORE INSERT ON purchase_void_rulings FOR EACH ROW EXECUTE FUNCTION purchase_void_ruling();
--> statement-breakpoint
-- A reversed void pays the shopper from the campaign's locked money at once.
CREATE FUNCTION purchase_void_reversal_credit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p purchase_confirmations%ROWTYPE; t sponsor_tasks%ROWTYPE; wallet uuid;
BEGIN
  IF NEW.decision <> 'reversed' THEN RETURN NEW; END IF;
  SELECT * INTO p FROM purchase_confirmations WHERE id = NEW.confirmation_id;
  SELECT * INTO t FROM sponsor_tasks WHERE id = p.task_id;
  INSERT INTO funding_accounts(owner_id, bucket) VALUES (p.account_id, 'reward_wallet') ON CONFLICT DO NOTHING;
  SELECT id INTO wallet FROM funding_accounts WHERE owner_id = p.account_id AND bucket = 'reward_wallet';
  INSERT INTO funding_transfers(id, source_id, destination_id, amount_kobo, kind, reference, actor_id, reason)
  VALUES (gen_random_uuid(), t.allocation_account_id, wallet, t.reward_kobo, 'void_reversal',
    'void-reversal:' || p.id::text, NEW.reviewer_id, 'Cash back paid after a disputed void');
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER purchase_void_reversal_credit AFTER INSERT ON purchase_void_rulings FOR EACH ROW EXECUTE FUNCTION purchase_void_reversal_credit();
--> statement-breakpoint
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['purchase_void_disputes','purchase_void_rulings'] LOOP
    EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION funding_reject_mutation()', name);
    EXECUTE format('CREATE TRIGGER no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION funding_reject_mutation()', name);
  END LOOP;
END $$;
