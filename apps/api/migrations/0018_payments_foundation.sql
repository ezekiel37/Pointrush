CREATE TABLE "funding_intents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"provider_session_id" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "funding_intent_amount" CHECK ("funding_intents"."amount_kobo" between 100000 and 10000000000),
	CONSTRAINT "funding_intent_currency" CHECK ("funding_intents"."currency" = 'NGN')
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_id" varchar(200) NOT NULL,
	"type" varchar(80) NOT NULL,
	"reference" uuid,
	"amount_kobo" bigint,
	"currency" text,
	"outcome" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_event_outcome" CHECK ("payment_events"."outcome" in ('credited', 'payout_paid', 'payout_failed', 'mismatch', 'unknown_reference', 'ignored'))
);
--> statement-breakpoint
CREATE TABLE "withdrawal_outcomes" (
	"withdrawal_id" uuid PRIMARY KEY NOT NULL,
	"outcome" text NOT NULL,
	"reason" varchar(300) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "withdrawal_outcome_kind" CHECK ("withdrawal_outcomes"."outcome" in ('paid', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "withdrawal_submissions" (
	"withdrawal_id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_payout_id" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "withdrawals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "withdrawal_amount" CHECK ("withdrawals"."amount_kobo" between 50000 and 500000000)
);
--> statement-breakpoint
ALTER TABLE "funding_accounts" DROP CONSTRAINT "funding_account_shape";--> statement-breakpoint
ALTER TABLE "funding_transfers" DROP CONSTRAINT "funding_transfer_kind";--> statement-breakpoint
ALTER TABLE "funding_intents" ADD CONSTRAINT "funding_intents_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_outcomes" ADD CONSTRAINT "withdrawal_outcomes_withdrawal_id_withdrawals_id_fk" FOREIGN KEY ("withdrawal_id") REFERENCES "public"."withdrawals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_submissions" ADD CONSTRAINT "withdrawal_submissions_withdrawal_id_withdrawals_id_fk" FOREIGN KEY ("withdrawal_id") REFERENCES "public"."withdrawals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "funding_intent_account" ON "funding_intents" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_event_once" ON "payment_events" USING btree ("provider","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "withdrawal_provider_payout" ON "withdrawal_submissions" USING btree ("provider","provider_payout_id");--> statement-breakpoint
CREATE INDEX "withdrawal_account" ON "withdrawals" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "funding_payout_hold_unique" ON "funding_accounts" USING btree ("owner_id") WHERE "funding_accounts"."bucket" = 'payout_hold';--> statement-breakpoint
ALTER TABLE "funding_accounts" ADD CONSTRAINT "funding_account_shape" CHECK (("funding_accounts"."bucket" = 'clearing' and "funding_accounts"."owner_id" is null and "funding_accounts"."allocation_id" is null) or ("funding_accounts"."bucket" in ('available', 'reward_wallet', 'payout_hold') and "funding_accounts"."owner_id" is not null and "funding_accounts"."allocation_id" is null) or ("funding_accounts"."bucket" = 'task_locked' and "funding_accounts"."owner_id" is not null and "funding_accounts"."allocation_id" is not null));--> statement-breakpoint
ALTER TABLE "funding_transfers" ADD CONSTRAINT "funding_transfer_kind" CHECK ("funding_transfers"."kind" in ('funding_confirmed', 'task_lock', 'task_reward', 'purchase_cashback', 'prize_claim', 'payout_hold', 'payout_paid', 'payout_returned'));
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
CREATE FUNCTION funding_intent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND access_state = 'active')
      OR NOT EXISTS (SELECT 1 FROM funding_accounts WHERE owner_id = NEW.account_id AND bucket = 'available')
      OR NEW.provider_session_id IS NOT NULL THEN
      RAISE EXCEPTION 'Funding unavailable' USING ERRCODE = '23514';
    END IF;
    NEW.created_at := clock_timestamp();
    RETURN NEW;
  END IF;
  -- The only change ever allowed: recording the provider session, once.
  IF TG_OP <> 'UPDATE' OR OLD.provider_session_id IS NOT NULL OR NEW.provider_session_id IS NULL
    OR (to_jsonb(NEW) - 'provider_session_id') IS DISTINCT FROM (to_jsonb(OLD) - 'provider_session_id') THEN
    RAISE EXCEPTION 'Funding intents are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER funding_intent_guard BEFORE INSERT OR UPDATE OR DELETE ON funding_intents FOR EACH ROW EXECUTE FUNCTION funding_intent_guard();
--> statement-breakpoint
CREATE TRIGGER no_truncate BEFORE TRUNCATE ON funding_intents FOR EACH STATEMENT EXECUTE FUNCTION funding_reject_mutation();
--> statement-breakpoint
CREATE FUNCTION withdrawal_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Serialize one account's withdrawals; the ledger checks the balance.
  PERFORM pg_advisory_xact_lock(hashtextextended('withdrawal:' || NEW.account_id::text, 0));
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND access_state = 'active')
    OR NOT EXISTS (SELECT 1 FROM verified_phones WHERE account_id = NEW.account_id) THEN
    RAISE EXCEPTION 'Withdrawal unavailable' USING ERRCODE = '23514';
  END IF;
  IF (SELECT count(*) FROM withdrawals WHERE account_id = NEW.account_id
      AND created_at > clock_timestamp() - interval '24 hours') >= 3 THEN
    RAISE EXCEPTION 'Daily withdrawal limit reached' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER withdrawal_request BEFORE INSERT ON withdrawals FOR EACH ROW EXECUTE FUNCTION withdrawal_request();
--> statement-breakpoint
CREATE FUNCTION withdrawal_hold() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE wallet uuid; hold uuid;
BEGIN
  SELECT id INTO wallet FROM funding_accounts WHERE owner_id = NEW.account_id AND bucket = 'reward_wallet';
  IF wallet IS NULL THEN RAISE EXCEPTION 'Insufficient wallet balance' USING ERRCODE = '23514'; END IF;
  INSERT INTO funding_accounts(owner_id, bucket) VALUES (NEW.account_id, 'payout_hold') ON CONFLICT DO NOTHING;
  SELECT id INTO hold FROM funding_accounts WHERE owner_id = NEW.account_id AND bucket = 'payout_hold';
  INSERT INTO funding_transfers(id, source_id, destination_id, amount_kobo, kind, reference, actor_id, reason)
  VALUES (gen_random_uuid(), wallet, hold, NEW.amount_kobo, 'payout_hold', 'withdrawal:' || NEW.id::text,
    NEW.account_id, 'Withdrawal requested');
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER withdrawal_hold AFTER INSERT ON withdrawals FOR EACH ROW EXECUTE FUNCTION withdrawal_hold();
--> statement-breakpoint
CREATE FUNCTION withdrawal_step() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM withdrawals WHERE id = NEW.withdrawal_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM withdrawal_outcomes WHERE withdrawal_id = NEW.withdrawal_id) THEN
    RAISE EXCEPTION 'Withdrawal already settled' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'withdrawal_outcomes' THEN
    IF length(btrim(NEW.reason)) NOT BETWEEN 1 AND 300 THEN
      RAISE EXCEPTION 'Withdrawal outcome needs a reason' USING ERRCODE = '23514';
    END IF;
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER withdrawal_submission BEFORE INSERT ON withdrawal_submissions FOR EACH ROW EXECUTE FUNCTION withdrawal_step();
--> statement-breakpoint
CREATE TRIGGER withdrawal_outcome BEFORE INSERT ON withdrawal_outcomes FOR EACH ROW EXECUTE FUNCTION withdrawal_step();
--> statement-breakpoint
CREATE FUNCTION withdrawal_settle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE w withdrawals%ROWTYPE; hold uuid; wallet uuid; clearing uuid;
BEGIN
  SELECT * INTO w FROM withdrawals WHERE id = NEW.withdrawal_id;
  SELECT id INTO hold FROM funding_accounts WHERE owner_id = w.account_id AND bucket = 'payout_hold';
  IF NEW.outcome = 'paid' THEN
    SELECT id INTO clearing FROM funding_accounts WHERE bucket = 'clearing';
    INSERT INTO funding_transfers(id, source_id, destination_id, amount_kobo, kind, reference, actor_id, reason)
    VALUES (gen_random_uuid(), hold, clearing, w.amount_kobo, 'payout_paid', 'withdrawal-paid:' || w.id::text,
      w.account_id, 'Withdrawal paid out');
  ELSE
    SELECT id INTO wallet FROM funding_accounts WHERE owner_id = w.account_id AND bucket = 'reward_wallet';
    INSERT INTO funding_transfers(id, source_id, destination_id, amount_kobo, kind, reference, actor_id, reason)
    VALUES (gen_random_uuid(), hold, wallet, w.amount_kobo, 'payout_returned', 'withdrawal-returned:' || w.id::text,
      w.account_id, 'Withdrawal failed; returned to wallet');
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER withdrawal_settle AFTER INSERT ON withdrawal_outcomes FOR EACH ROW EXECUTE FUNCTION withdrawal_settle();
--> statement-breakpoint
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['payment_events','withdrawals','withdrawal_submissions','withdrawal_outcomes'] LOOP
    EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION funding_reject_mutation()', name);
    EXECUTE format('CREATE TRIGGER no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION funding_reject_mutation()', name);
  END LOOP;
END $$;
