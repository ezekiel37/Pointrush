CREATE TABLE "bill_outcomes" (
	"bill_id" uuid PRIMARY KEY NOT NULL,
	"outcome" text NOT NULL,
	"provider_ref" varchar(120),
	"token" varchar(120),
	"reason" varchar(300) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bill_outcome_kind" CHECK ("bill_outcomes"."outcome" in ('delivered', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "bill_purchases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"kind" text NOT NULL,
	"biller" varchar(40) NOT NULL,
	"customer_ref" varchar(20) NOT NULL,
	"plan_code" varchar(60),
	"amount_kobo" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bill_kind" CHECK ("bill_purchases"."kind" in ('airtime', 'data', 'electricity', 'tv')),
	CONSTRAINT "bill_amount" CHECK ("bill_purchases"."amount_kobo" between 5000 and 5000000),
	CONSTRAINT "bill_customer_ref" CHECK ("bill_purchases"."customer_ref" ~ '^[0-9]{10,13}$'),
	CONSTRAINT "bill_plan" CHECK (("bill_purchases"."kind" in ('data', 'tv')) = ("bill_purchases"."plan_code" is not null))
);
--> statement-breakpoint
ALTER TABLE "funding_transfers" DROP CONSTRAINT "funding_transfer_kind";--> statement-breakpoint
ALTER TABLE "bill_outcomes" ADD CONSTRAINT "bill_outcomes_bill_id_bill_purchases_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill_purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_purchases" ADD CONSTRAINT "bill_purchases_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bill_account" ON "bill_purchases" USING btree ("account_id","created_at");--> statement-breakpoint
ALTER TABLE "funding_transfers" ADD CONSTRAINT "funding_transfer_kind" CHECK ("funding_transfers"."kind" in ('funding_confirmed', 'task_lock', 'task_reward', 'purchase_cashback', 'prize_claim', 'payout_hold', 'payout_paid', 'payout_returned', 'campaign_return', 'prize_handover', 'prize_cash_value', 'void_reversal', 'bill_hold', 'bill_paid', 'bill_returned'));
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
  ELSIF NEW.kind = 'bill_hold' THEN
    IF source_row.bucket <> 'reward_wallet' OR destination_row.bucket <> 'payout_hold'
      OR source_row.owner_id IS DISTINCT FROM destination_row.owner_id
      OR NEW.actor_id IS DISTINCT FROM source_row.owner_id
      OR NOT EXISTS (SELECT 1 FROM bill_purchases b WHERE NEW.reference = 'bill:' || b.id::text
        AND b.account_id = source_row.owner_id AND b.amount_kobo = NEW.amount_kobo)
    THEN RAISE EXCEPTION 'Invalid bill hold' USING ERRCODE = '23514'; END IF;
  ELSIF NEW.kind IN ('bill_paid', 'bill_returned') THEN
    IF source_row.bucket <> 'payout_hold'
      OR (NEW.kind = 'bill_paid' AND destination_row.bucket <> 'clearing')
      OR (NEW.kind = 'bill_returned' AND (destination_row.bucket <> 'reward_wallet'
        OR destination_row.owner_id IS DISTINCT FROM source_row.owner_id))
      OR NOT EXISTS (SELECT 1 FROM bill_purchases b JOIN bill_outcomes o ON o.bill_id = b.id
        WHERE b.account_id = source_row.owner_id AND b.amount_kobo = NEW.amount_kobo
          AND NEW.actor_id = b.account_id
          AND ((NEW.kind = 'bill_paid' AND o.outcome = 'delivered' AND NEW.reference = 'bill-paid:' || b.id::text)
            OR (NEW.kind = 'bill_returned' AND o.outcome = 'failed' AND NEW.reference = 'bill-returned:' || b.id::text)))
    THEN RAISE EXCEPTION 'Invalid bill settlement' USING ERRCODE = '23514'; END IF;
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
CREATE FUNCTION bill_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- One person's wallet spending is serialized; the ledger checks the balance.
  PERFORM pg_advisory_xact_lock(hashtextextended('withdrawal:' || NEW.account_id::text, 0));
  -- Spending leaves Acticlaim like a withdrawal: an active account with a
  -- verified phone, and never while the person has locked their money.
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND access_state = 'active')
    OR NOT EXISTS (SELECT 1 FROM verified_phones WHERE account_id = NEW.account_id) THEN
    RAISE EXCEPTION 'Bill payment unavailable' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM withdrawal_locks l WHERE l.account_id = NEW.account_id
      AND NOT EXISTS (SELECT 1 FROM withdrawal_unlocks u WHERE u.lock_id = l.id)) THEN
    RAISE EXCEPTION 'Withdrawals are locked' USING ERRCODE = '23514';
  END IF;
  -- At most 10 purchases and ₦50,000 in any 24 hours.
  IF (SELECT count(*) FROM bill_purchases WHERE account_id = NEW.account_id
      AND created_at > clock_timestamp() - interval '24 hours') >= 10
    OR (SELECT coalesce(sum(amount_kobo), 0) FROM bill_purchases b WHERE b.account_id = NEW.account_id
      AND b.created_at > clock_timestamp() - interval '24 hours'
      AND NOT EXISTS (SELECT 1 FROM bill_outcomes o WHERE o.bill_id = b.id AND o.outcome = 'failed'))
      + NEW.amount_kobo > 5000000 THEN
    RAISE EXCEPTION 'Daily bill payment limit reached' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER bill_request BEFORE INSERT ON bill_purchases FOR EACH ROW EXECUTE FUNCTION bill_request();
--> statement-breakpoint
CREATE FUNCTION bill_hold() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE wallet uuid; hold uuid;
BEGIN
  SELECT id INTO wallet FROM funding_accounts WHERE owner_id = NEW.account_id AND bucket = 'reward_wallet';
  IF wallet IS NULL THEN RAISE EXCEPTION 'Insufficient wallet balance' USING ERRCODE = '23514'; END IF;
  INSERT INTO funding_accounts(owner_id, bucket) VALUES (NEW.account_id, 'payout_hold') ON CONFLICT DO NOTHING;
  SELECT id INTO hold FROM funding_accounts WHERE owner_id = NEW.account_id AND bucket = 'payout_hold';
  INSERT INTO funding_transfers(id, source_id, destination_id, amount_kobo, kind, reference, actor_id, reason)
  VALUES (gen_random_uuid(), wallet, hold, NEW.amount_kobo, 'bill_hold', 'bill:' || NEW.id::text,
    NEW.account_id, 'Bill payment requested');
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER bill_hold AFTER INSERT ON bill_purchases FOR EACH ROW EXECUTE FUNCTION bill_hold();
--> statement-breakpoint
CREATE FUNCTION bill_outcome() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM bill_purchases WHERE id = NEW.bill_id FOR UPDATE;
  IF NOT FOUND OR EXISTS (SELECT 1 FROM bill_outcomes WHERE bill_id = NEW.bill_id) THEN
    RAISE EXCEPTION 'Bill payment already settled' USING ERRCODE = '23514';
  END IF;
  IF length(btrim(NEW.reason)) NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'Bill outcome needs a reason' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER bill_outcome BEFORE INSERT ON bill_outcomes FOR EACH ROW EXECUTE FUNCTION bill_outcome();
--> statement-breakpoint
CREATE FUNCTION bill_settle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b bill_purchases%ROWTYPE; hold uuid; wallet uuid; clearing uuid;
BEGIN
  SELECT * INTO b FROM bill_purchases WHERE id = NEW.bill_id;
  SELECT id INTO hold FROM funding_accounts WHERE owner_id = b.account_id AND bucket = 'payout_hold';
  IF NEW.outcome = 'delivered' THEN
    SELECT id INTO clearing FROM funding_accounts WHERE bucket = 'clearing';
    INSERT INTO funding_transfers(id, source_id, destination_id, amount_kobo, kind, reference, actor_id, reason)
    VALUES (gen_random_uuid(), hold, clearing, b.amount_kobo, 'bill_paid', 'bill-paid:' || b.id::text,
      b.account_id, 'Bill payment delivered');
  ELSE
    SELECT id INTO wallet FROM funding_accounts WHERE owner_id = b.account_id AND bucket = 'reward_wallet';
    INSERT INTO funding_transfers(id, source_id, destination_id, amount_kobo, kind, reference, actor_id, reason)
    VALUES (gen_random_uuid(), hold, wallet, b.amount_kobo, 'bill_returned', 'bill-returned:' || b.id::text,
      b.account_id, 'Bill payment failed; returned to wallet');
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER bill_settle AFTER INSERT ON bill_outcomes FOR EACH ROW EXECUTE FUNCTION bill_settle();
--> statement-breakpoint
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['bill_purchases','bill_outcomes'] LOOP
    EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION funding_reject_mutation()', name);
    EXECUTE format('CREATE TRIGGER no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION funding_reject_mutation()', name);
  END LOOP;
END $$;
