CREATE TABLE "prize_cash_outs" (
	"redemption_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prize_handovers" (
	"redemption_id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prize_vouchers" (
	"redemption_id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"code" varchar(12) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "funding_transfers" DROP CONSTRAINT "funding_transfer_kind";--> statement-breakpoint
ALTER TABLE "prize_cash_outs" ADD CONSTRAINT "prize_cash_outs_redemption_id_prize_vouchers_redemption_id_fk" FOREIGN KEY ("redemption_id") REFERENCES "public"."prize_vouchers"("redemption_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prize_handovers" ADD CONSTRAINT "prize_handovers_redemption_id_prize_vouchers_redemption_id_fk" FOREIGN KEY ("redemption_id") REFERENCES "public"."prize_vouchers"("redemption_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prize_handovers" ADD CONSTRAINT "prize_handovers_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prize_vouchers" ADD CONSTRAINT "prize_vouchers_redemption_id_claim_redemptions_id_fk" FOREIGN KEY ("redemption_id") REFERENCES "public"."claim_redemptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prize_vouchers" ADD CONSTRAINT "prize_vouchers_task_id_sponsor_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."sponsor_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prize_voucher_code" ON "prize_vouchers" USING btree ("task_id","code");--> statement-breakpoint
ALTER TABLE "funding_transfers" ADD CONSTRAINT "funding_transfer_kind" CHECK ("funding_transfers"."kind" in ('funding_confirmed', 'task_lock', 'task_reward', 'purchase_cashback', 'prize_claim', 'payout_hold', 'payout_paid', 'payout_returned', 'campaign_return', 'prize_handover', 'prize_cash_value'));
--> statement-breakpoint
ALTER TABLE "sponsor_tasks" ADD CONSTRAINT "sponsor_task_prize_item" CHECK (
  "promotion_terms" IS NULL OR jsonb_typeof("promotion_terms"->'prize') IS NULL
  OR jsonb_typeof("promotion_terms"->'prize') = 'null'
  OR (jsonb_typeof("promotion_terms"->'prize') = 'object'
    AND jsonb_typeof("promotion_terms"->'prize'->'item') = 'string'
    AND length(btrim("promotion_terms"->'prize'->>'item')) BETWEEN 1 AND 160));
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
    SELECT count(*) * t.reward_kobo INTO owed FROM purchase_confirmations p
      WHERE p.task_id = t.id
        AND NOT EXISTS (SELECT 1 FROM purchase_voids v WHERE v.confirmation_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM purchase_releases r WHERE r.confirmation_id = p.id);
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
-- Cash prizes go straight to the wallet; item prizes get a voucher instead.
CREATE OR REPLACE FUNCTION claim_redeem_credit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t sponsor_tasks%ROWTYPE; wallet uuid;
BEGIN
  SELECT * INTO t FROM sponsor_tasks WHERE id = NEW.task_id;
  IF jsonb_typeof(t.promotion_terms->'prize') = 'object' THEN
    INSERT INTO prize_vouchers(redemption_id, task_id, code)
    VALUES (NEW.id, NEW.task_id, upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)));
    RETURN NEW;
  END IF;
  INSERT INTO funding_accounts(owner_id, bucket) VALUES (NEW.account_id, 'reward_wallet') ON CONFLICT DO NOTHING;
  SELECT id INTO wallet FROM funding_accounts WHERE owner_id = NEW.account_id AND bucket = 'reward_wallet';
  INSERT INTO funding_transfers(id, source_id, destination_id, amount_kobo, kind, reference, actor_id, reason)
  VALUES (gen_random_uuid(), t.allocation_account_id, wallet, t.reward_kobo, 'prize_claim',
    'claim-code:' || NEW.id::text, NEW.account_id, 'Claimed promotion prize');
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION prize_voucher_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Vouchers are created only by the claim itself, for item prizes.
  IF NOT EXISTS (SELECT 1 FROM claim_redemptions r JOIN sponsor_tasks t ON t.id = r.task_id
      WHERE r.id = NEW.redemption_id AND r.task_id = NEW.task_id
        AND jsonb_typeof(t.promotion_terms->'prize') = 'object')
    OR NEW.code !~ '^[0-9A-F]{12}$' THEN
    RAISE EXCEPTION 'Voucher unavailable' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER prize_voucher_guard BEFORE INSERT ON prize_vouchers FOR EACH ROW EXECUTE FUNCTION prize_voucher_guard();
--> statement-breakpoint
CREATE FUNCTION prize_settle_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v prize_vouchers%ROWTYPE; r claim_redemptions%ROWTYPE; owner uuid; sponsor uuid;
BEGIN
  -- One outcome per voucher: handed over, or cashed out. Never both.
  SELECT * INTO v FROM prize_vouchers WHERE redemption_id = NEW.redemption_id FOR UPDATE;
  SELECT * INTO r FROM claim_redemptions WHERE id = NEW.redemption_id;
  SELECT sp.owner_id, sp.id INTO owner, sponsor FROM sponsor_tasks t JOIN sponsor_profiles sp ON sp.id = t.sponsor_id
    WHERE t.id = v.task_id;
  IF v.redemption_id IS NULL
    OR EXISTS (SELECT 1 FROM prize_handovers WHERE redemption_id = NEW.redemption_id)
    OR EXISTS (SELECT 1 FROM prize_cash_outs WHERE redemption_id = NEW.redemption_id) THEN
    RAISE EXCEPTION 'Prize already settled' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'prize_handovers' THEN
    IF NOT (NEW.actor_id = owner OR (business_staff_active(sponsor, NEW.actor_id)
        AND EXISTS (SELECT 1 FROM accounts WHERE id = NEW.actor_id AND access_state = 'active'))) THEN
      RAISE EXCEPTION 'Prize already settled' USING ERRCODE = '23514';
    END IF;
  ELSIF v.created_at > clock_timestamp() - interval '14 days' THEN
    RAISE EXCEPTION 'Prize cash value not available yet' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER prize_settle_guard BEFORE INSERT ON prize_handovers FOR EACH ROW EXECUTE FUNCTION prize_settle_guard();
--> statement-breakpoint
CREATE TRIGGER prize_settle_guard BEFORE INSERT ON prize_cash_outs FOR EACH ROW EXECUTE FUNCTION prize_settle_guard();
--> statement-breakpoint
CREATE FUNCTION prize_settle_transfer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t sponsor_tasks%ROWTYPE; r claim_redemptions%ROWTYPE; owner uuid; target uuid;
BEGIN
  SELECT * INTO r FROM claim_redemptions WHERE id = NEW.redemption_id;
  SELECT * INTO t FROM sponsor_tasks WHERE id = r.task_id;
  SELECT owner_id INTO owner FROM sponsor_profiles WHERE id = t.sponsor_id;
  IF TG_TABLE_NAME = 'prize_handovers' THEN
    SELECT id INTO target FROM funding_accounts WHERE owner_id = owner AND bucket = 'available';
    INSERT INTO funding_transfers(id, source_id, destination_id, amount_kobo, kind, reference, actor_id, reason)
    VALUES (gen_random_uuid(), t.allocation_account_id, target, t.reward_kobo, 'prize_handover',
      'prize-handover:' || NEW.redemption_id::text, NEW.actor_id, 'Prize handed over; deposit returned');
  ELSE
    INSERT INTO funding_accounts(owner_id, bucket) VALUES (r.account_id, 'reward_wallet') ON CONFLICT DO NOTHING;
    SELECT id INTO target FROM funding_accounts WHERE owner_id = r.account_id AND bucket = 'reward_wallet';
    INSERT INTO funding_transfers(id, source_id, destination_id, amount_kobo, kind, reference, actor_id, reason)
    VALUES (gen_random_uuid(), t.allocation_account_id, target, t.reward_kobo, 'prize_cash_value',
      'prize-cash:' || NEW.redemption_id::text, r.account_id, 'Prize not handed over; cash value paid');
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER prize_settle_transfer AFTER INSERT ON prize_handovers FOR EACH ROW EXECUTE FUNCTION prize_settle_transfer();
--> statement-breakpoint
CREATE TRIGGER prize_settle_transfer AFTER INSERT ON prize_cash_outs FOR EACH ROW EXECUTE FUNCTION prize_settle_transfer();
--> statement-breakpoint
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['prize_vouchers','prize_handovers','prize_cash_outs'] LOOP
    EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION funding_reject_mutation()', name);
    EXECUTE format('CREATE TRIGGER no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION funding_reject_mutation()', name);
  END LOOP;
END $$;
