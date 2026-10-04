CREATE TABLE "claim_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"succeeded" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_batch_activations" (
	"batch_id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_batch_revocations" (
	"batch_id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"reason" varchar(500) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_code_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"size" integer NOT NULL,
	"label" varchar(80) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_batch_size" CHECK ("claim_code_batches"."size" between 1 and 5000)
);
--> statement-breakpoint
CREATE TABLE "claim_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	CONSTRAINT "claim_code_hash_format" CHECK ("claim_codes"."code_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "claim_redemptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_redemptions_code_id_unique" UNIQUE("code_id")
);
--> statement-breakpoint
ALTER TABLE "funding_transfers" DROP CONSTRAINT "funding_transfer_kind";--> statement-breakpoint
ALTER TABLE "sponsor_tasks" DROP CONSTRAINT "sponsor_task_model";--> statement-breakpoint
ALTER TABLE "sponsor_tasks" ADD COLUMN "promotion_terms" jsonb;--> statement-breakpoint
ALTER TABLE "claim_attempts" ADD CONSTRAINT "claim_attempts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_batch_activations" ADD CONSTRAINT "claim_batch_activations_batch_id_claim_code_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."claim_code_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_batch_activations" ADD CONSTRAINT "claim_batch_activations_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_batch_revocations" ADD CONSTRAINT "claim_batch_revocations_batch_id_claim_code_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."claim_code_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_batch_revocations" ADD CONSTRAINT "claim_batch_revocations_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_code_batches" ADD CONSTRAINT "claim_code_batches_task_id_sponsor_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."sponsor_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_code_batches" ADD CONSTRAINT "claim_code_batches_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_codes" ADD CONSTRAINT "claim_codes_batch_id_claim_code_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."claim_code_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_codes" ADD CONSTRAINT "claim_codes_task_id_sponsor_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."sponsor_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_redemptions" ADD CONSTRAINT "claim_redemptions_code_id_claim_codes_id_fk" FOREIGN KEY ("code_id") REFERENCES "public"."claim_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_redemptions" ADD CONSTRAINT "claim_redemptions_task_id_sponsor_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."sponsor_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_redemptions" ADD CONSTRAINT "claim_redemptions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claim_attempt_recent" ON "claim_attempts" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "claim_batch_task" ON "claim_code_batches" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "claim_code_hash" ON "claim_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "claim_code_batch" ON "claim_codes" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "claim_redemption_person" ON "claim_redemptions" USING btree ("task_id","account_id");--> statement-breakpoint
ALTER TABLE "funding_transfers" ADD CONSTRAINT "funding_transfer_kind" CHECK ("funding_transfers"."kind" in ('funding_confirmed', 'task_lock', 'task_reward', 'purchase_cashback', 'prize_claim'));--> statement-breakpoint
ALTER TABLE "sponsor_tasks" ADD CONSTRAINT "sponsor_task_promotion_terms" CHECK (("sponsor_tasks"."model" = 'claim_code') = ("sponsor_tasks"."promotion_terms" is not null) and ("sponsor_tasks"."model" <> 'claim_code' or "sponsor_tasks"."work_terms" is null));--> statement-breakpoint
ALTER TABLE "sponsor_tasks" ADD CONSTRAINT "sponsor_task_model" CHECK ("sponsor_tasks"."model" in ('capped_fixed', 'selected_assignment', 'purchase_cashback', 'claim_code'));
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
CREATE OR REPLACE FUNCTION task_work_publish() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t sponsor_tasks%ROWTYPE; owner uuid; backing numeric;
BEGIN
  SELECT * INTO t FROM sponsor_tasks WHERE id = NEW.task_id FOR UPDATE;
  SELECT owner_id INTO owner FROM sponsor_profiles WHERE id = t.sponsor_id;
  IF owner IS DISTINCT FROM NEW.actor_id OR NOT EXISTS (SELECT 1 FROM accounts WHERE id = owner AND access_state = 'active')
    OR t.review_state <> 'approved' OR t.lifecycle <> 'not_live' OR t.ends_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'Task is not eligible for publication' USING ERRCODE = '23514';
  END IF;
  IF t.model = 'capped_fixed' THEN
    IF t.work_terms IS NULL
      OR (jsonb_typeof(t.work_terms) = 'object'
        AND jsonb_typeof(t.work_terms->'reviewHours') = 'number'
        AND jsonb_typeof(t.work_terms->'correctionHours') = 'number'
        AND jsonb_typeof(t.work_terms->'appealHours') = 'number'
        AND jsonb_typeof(t.work_terms->'settlement') = 'string') IS DISTINCT FROM true
      OR NOT (t.work_terms ?& ARRAY['reviewHours','correctionHours','appealHours','settlement'])
      OR (t.work_terms->>'reviewHours')::integer NOT BETWEEN 1 AND 720
      OR (t.work_terms->>'correctionHours')::integer NOT BETWEEN 1 AND 720
      OR (t.work_terms->>'appealHours')::integer NOT BETWEEN 1 AND 2160
      OR t.work_terms->>'settlement' <> 'approved_reward_backing' THEN
      RAISE EXCEPTION 'Task is not eligible for publication' USING ERRCODE = '23514';
    END IF;
  ELSIF t.model = 'purchase_cashback' THEN
    IF (jsonb_typeof(t.campaign_terms) = 'object'
        AND jsonb_typeof(t.campaign_terms->'minSpendKobo') = 'string'
        AND jsonb_typeof(t.campaign_terms->'holdHours') = 'number'
        AND jsonb_typeof(t.campaign_terms->'placeName') = 'string'
        AND jsonb_typeof(t.campaign_terms->'placeAddress') = 'string') IS DISTINCT FROM true
      OR t.campaign_terms->>'minSpendKobo' !~ '^(0|[1-9][0-9]{0,14})$'
      OR (t.campaign_terms->>'holdHours')::numeric NOT BETWEEN 24 AND 720
      OR (t.campaign_terms->>'holdHours')::numeric <> trunc((t.campaign_terms->>'holdHours')::numeric)
      OR length(btrim(t.campaign_terms->>'placeName')) NOT BETWEEN 1 AND 160
      OR length(btrim(t.campaign_terms->>'placeAddress')) NOT BETWEEN 1 AND 300 THEN
      RAISE EXCEPTION 'Campaign terms are incomplete' USING ERRCODE = '23514';
    END IF;
  ELSIF t.model = 'claim_code' THEN
    IF (jsonb_typeof(t.promotion_terms) = 'object'
        AND jsonb_typeof(t.promotion_terms->'mode') = 'string'
        AND jsonb_typeof(t.promotion_terms->'claimLimitPerPerson') = 'number'
        AND jsonb_typeof(t.promotion_terms->'howToGetCodes') = 'string'
        AND jsonb_typeof(t.promotion_terms->'permit') IN ('null', 'object')) IS DISTINCT FROM true
      OR t.promotion_terms->>'mode' NOT IN ('every_code_wins', 'chance')
      OR (t.promotion_terms->>'claimLimitPerPerson')::numeric NOT BETWEEN 1 AND 20
      OR length(btrim(t.promotion_terms->>'howToGetCodes')) NOT BETWEEN 1 AND 300
      -- A chance-based promotion must carry the business's own state permit.
      OR (t.promotion_terms->>'mode' = 'chance') <> (jsonb_typeof(t.promotion_terms->'permit') = 'object')
      OR (jsonb_typeof(t.promotion_terms->'permit') = 'object' AND (
        length(btrim(coalesce(t.promotion_terms->'permit'->>'authority', ''))) NOT BETWEEN 1 AND 160
        OR length(btrim(coalesce(t.promotion_terms->'permit'->>'number', ''))) NOT BETWEEN 1 AND 160)) THEN
      RAISE EXCEPTION 'Promotion terms are incomplete' USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'Task model cannot be published' USING ERRCODE = '23514';
  END IF;
  PERFORM id FROM funding_accounts WHERE id = t.allocation_account_id FOR UPDATE;
  SELECT coalesce(sum(CASE WHEN destination_id = t.allocation_account_id THEN amount_kobo ELSE -amount_kobo END),0)
    INTO backing FROM funding_transfers WHERE source_id = t.allocation_account_id OR destination_id = t.allocation_account_id;
  IF backing <> t.budget_kobo THEN RAISE EXCEPTION 'Full backing required' USING ERRCODE = '23514'; END IF;
  UPDATE sponsor_tasks SET lifecycle = 'published' WHERE id = t.id;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Codes issued (live batches plus prizes already claimed from withdrawn batches)
-- can never exceed the number of funded prizes.
CREATE FUNCTION claim_batch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t sponsor_tasks%ROWTYPE; owner uuid; issued bigint;
BEGIN
  SELECT * INTO t FROM sponsor_tasks WHERE id = NEW.task_id FOR UPDATE;
  SELECT owner_id INTO owner FROM sponsor_profiles WHERE id = t.sponsor_id;
  IF t.id IS NULL OR t.model <> 'claim_code' OR t.review_state <> 'approved'
    OR t.ends_at <= clock_timestamp() OR owner IS DISTINCT FROM NEW.actor_id
    OR NOT EXISTS (SELECT 1 FROM accounts WHERE id = owner AND access_state = 'active')
    OR length(btrim(NEW.label)) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'Codes cannot be issued for this promotion' USING ERRCODE = '23514';
  END IF;
  SELECT coalesce((SELECT sum(b.size) FROM claim_code_batches b WHERE b.task_id = t.id
      AND NOT EXISTS (SELECT 1 FROM claim_batch_revocations v WHERE v.batch_id = b.id)), 0)
    + (SELECT count(*) FROM claim_redemptions r JOIN claim_codes c ON c.id = r.code_id
       JOIN claim_batch_revocations v ON v.batch_id = c.batch_id WHERE r.task_id = t.id)
    INTO issued;
  IF issued + NEW.size > t.capacity THEN
    RAISE EXCEPTION 'More codes than funded prizes' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER claim_batch_guard BEFORE INSERT ON claim_code_batches FOR EACH ROW EXECUTE FUNCTION claim_batch_guard();
--> statement-breakpoint
-- Codes join a batch only in the transaction that created it, and never beyond its size.
CREATE FUNCTION claim_code_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b claim_code_batches%ROWTYPE;
BEGIN
  SELECT * INTO b FROM claim_code_batches WHERE id = NEW.batch_id FOR UPDATE;
  IF b.id IS NULL OR b.task_id <> NEW.task_id OR b.created_at <> now()
    OR (SELECT count(*) FROM claim_codes WHERE batch_id = b.id) >= b.size THEN
    RAISE EXCEPTION 'Codes cannot be added to this batch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER claim_code_guard BEFORE INSERT ON claim_codes FOR EACH ROW EXECUTE FUNCTION claim_code_guard();
--> statement-breakpoint
CREATE FUNCTION claim_batch_complete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT count(*) FROM claim_codes WHERE batch_id = NEW.id) <> NEW.size THEN
    RAISE EXCEPTION 'Batch must contain exactly its declared codes' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER claim_batch_complete AFTER INSERT ON claim_code_batches
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION claim_batch_complete();
--> statement-breakpoint
CREATE FUNCTION claim_batch_owner_action() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b claim_code_batches%ROWTYPE; t sponsor_tasks%ROWTYPE; owner uuid;
BEGIN
  SELECT * INTO b FROM claim_code_batches WHERE id = NEW.batch_id FOR UPDATE;
  SELECT * INTO t FROM sponsor_tasks WHERE id = b.task_id;
  SELECT owner_id INTO owner FROM sponsor_profiles WHERE id = t.sponsor_id;
  IF b.id IS NULL OR owner IS DISTINCT FROM NEW.actor_id
    OR NOT EXISTS (SELECT 1 FROM accounts WHERE id = owner AND access_state = 'active') THEN
    RAISE EXCEPTION 'Batch action unavailable' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'claim_batch_activations' AND (t.lifecycle <> 'published'
      OR t.ends_at <= clock_timestamp()
      OR EXISTS (SELECT 1 FROM claim_batch_revocations WHERE batch_id = b.id)) THEN
    RAISE EXCEPTION 'Batch action unavailable' USING ERRCODE = '23514';
  END IF;
  -- Nested so NEW.reason is only read on revocation rows, which have it.
  IF TG_TABLE_NAME = 'claim_batch_revocations' THEN
    IF length(btrim(NEW.reason)) NOT BETWEEN 1 AND 500 THEN
      RAISE EXCEPTION 'Batch action unavailable' USING ERRCODE = '23514';
    END IF;
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER claim_batch_activation BEFORE INSERT ON claim_batch_activations FOR EACH ROW EXECUTE FUNCTION claim_batch_owner_action();
--> statement-breakpoint
CREATE TRIGGER claim_batch_revocation BEFORE INSERT ON claim_batch_revocations FOR EACH ROW EXECUTE FUNCTION claim_batch_owner_action();
--> statement-breakpoint
CREATE FUNCTION claim_redeem() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c claim_codes%ROWTYPE; t sponsor_tasks%ROWTYPE; owner uuid;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'READ COMMITTED required' USING ERRCODE='23514'; END IF;
  SELECT * INTO c FROM claim_codes WHERE id = NEW.code_id;
  -- Serializes the per-person limit for this promotion.
  SELECT * INTO t FROM sponsor_tasks WHERE id = c.task_id FOR UPDATE;
  SELECT owner_id INTO owner FROM sponsor_profiles WHERE id = t.sponsor_id;
  IF c.id IS NULL OR NEW.task_id <> c.task_id OR t.model <> 'claim_code'
    OR t.lifecycle <> 'published' OR t.review_state <> 'approved'
    OR clock_timestamp() < t.starts_at OR clock_timestamp() >= t.ends_at
    OR NOT EXISTS (SELECT 1 FROM claim_batch_activations WHERE batch_id = c.batch_id)
    OR EXISTS (SELECT 1 FROM claim_batch_revocations WHERE batch_id = c.batch_id)
    OR owner IS NOT DISTINCT FROM NEW.account_id
    OR NOT EXISTS (SELECT 1 FROM accounts WHERE id = owner AND access_state = 'active')
    OR NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND access_state = 'active')
    OR NOT EXISTS (SELECT 1 FROM verified_phones WHERE account_id = NEW.account_id) THEN
    RAISE EXCEPTION 'Code cannot be claimed' USING ERRCODE = '23514';
  END IF;
  IF (SELECT count(*) FROM claim_redemptions WHERE task_id = t.id AND account_id = NEW.account_id)
      >= (t.promotion_terms->>'claimLimitPerPerson')::integer THEN
    RAISE EXCEPTION 'Claim limit reached for this promotion' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER claim_redeem BEFORE INSERT ON claim_redemptions FOR EACH ROW EXECUTE FUNCTION claim_redeem();
--> statement-breakpoint
CREATE FUNCTION claim_redeem_credit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t sponsor_tasks%ROWTYPE; wallet uuid;
BEGIN
  SELECT * INTO t FROM sponsor_tasks WHERE id = NEW.task_id;
  INSERT INTO funding_accounts(owner_id, bucket) VALUES (NEW.account_id, 'reward_wallet') ON CONFLICT DO NOTHING;
  SELECT id INTO wallet FROM funding_accounts WHERE owner_id = NEW.account_id AND bucket = 'reward_wallet';
  INSERT INTO funding_transfers(id, source_id, destination_id, amount_kobo, kind, reference, actor_id, reason)
  VALUES (gen_random_uuid(), t.allocation_account_id, wallet, t.reward_kobo, 'prize_claim',
    'claim-code:' || NEW.id::text, NEW.account_id, 'Claimed promotion prize');
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER claim_redeem_credit AFTER INSERT ON claim_redemptions FOR EACH ROW EXECUTE FUNCTION claim_redeem_credit();
--> statement-breakpoint
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['claim_code_batches','claim_codes','claim_batch_activations','claim_batch_revocations','claim_redemptions','claim_attempts'] LOOP
    EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION funding_reject_mutation()', name);
    EXECUTE format('CREATE TRIGGER no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION funding_reject_mutation()', name);
  END LOOP;
END $$;
