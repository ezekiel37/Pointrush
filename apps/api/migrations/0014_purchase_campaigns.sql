CREATE TABLE "purchase_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"code" varchar(10) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_code_format" CHECK ("purchase_codes"."code" ~ '^[A-HJKMNP-Z2-9]{10}$')
);
--> statement-breakpoint
CREATE TABLE "purchase_confirmations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"release_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_confirmations_code_id_unique" UNIQUE("code_id"),
	CONSTRAINT "purchase_amount_positive" CHECK ("purchase_confirmations"."amount_kobo" > 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_releases" (
	"confirmation_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_voids" (
	"confirmation_id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"reason" varchar(500) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "funding_transfers" DROP CONSTRAINT "funding_transfer_kind";--> statement-breakpoint
ALTER TABLE "sponsor_tasks" DROP CONSTRAINT "sponsor_task_model";--> statement-breakpoint
ALTER TABLE "sponsor_tasks" ADD COLUMN "campaign_terms" jsonb;--> statement-breakpoint
ALTER TABLE "purchase_codes" ADD CONSTRAINT "purchase_codes_task_id_sponsor_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."sponsor_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_codes" ADD CONSTRAINT "purchase_codes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_confirmations" ADD CONSTRAINT "purchase_confirmations_code_id_purchase_codes_id_fk" FOREIGN KEY ("code_id") REFERENCES "public"."purchase_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_confirmations" ADD CONSTRAINT "purchase_confirmations_task_id_sponsor_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."sponsor_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_confirmations" ADD CONSTRAINT "purchase_confirmations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_confirmations" ADD CONSTRAINT "purchase_confirmations_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_releases" ADD CONSTRAINT "purchase_releases_confirmation_id_purchase_confirmations_id_fk" FOREIGN KEY ("confirmation_id") REFERENCES "public"."purchase_confirmations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_voids" ADD CONSTRAINT "purchase_voids_confirmation_id_purchase_confirmations_id_fk" FOREIGN KEY ("confirmation_id") REFERENCES "public"."purchase_confirmations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_voids" ADD CONSTRAINT "purchase_voids_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_code_unique" ON "purchase_codes" USING btree ("code");--> statement-breakpoint
CREATE INDEX "purchase_code_owner" ON "purchase_codes" USING btree ("account_id","task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_once_per_campaign" ON "purchase_confirmations" USING btree ("task_id","account_id");--> statement-breakpoint
CREATE INDEX "purchase_shopper_recent" ON "purchase_confirmations" USING btree ("account_id","created_at");--> statement-breakpoint
ALTER TABLE "funding_transfers" ADD CONSTRAINT "funding_transfer_kind" CHECK ("funding_transfers"."kind" in ('funding_confirmed', 'task_lock', 'task_reward', 'purchase_cashback'));--> statement-breakpoint
ALTER TABLE "sponsor_tasks" ADD CONSTRAINT "sponsor_task_campaign_terms" CHECK (("sponsor_tasks"."model" = 'purchase_cashback') = ("sponsor_tasks"."campaign_terms" is not null) and ("sponsor_tasks"."model" <> 'purchase_cashback' or "sponsor_tasks"."work_terms" is null));--> statement-breakpoint
ALTER TABLE "sponsor_tasks" ADD CONSTRAINT "sponsor_task_model" CHECK ("sponsor_tasks"."model" in ('capped_fixed', 'selected_assignment', 'purchase_cashback'));
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
-- Live purchase campaign owned by an active business, offered to a different active shopper.
CREATE FUNCTION purchase_campaign_live(t sponsor_tasks, shopper uuid) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE owner uuid;
BEGIN
  SELECT owner_id INTO owner FROM sponsor_profiles WHERE id = t.sponsor_id;
  RETURN t.id IS NOT NULL AND t.model = 'purchase_cashback' AND t.lifecycle = 'published'
    AND t.review_state = 'approved' AND clock_timestamp() >= t.starts_at AND clock_timestamp() < t.ends_at
    AND owner IS DISTINCT FROM shopper
    AND EXISTS (SELECT 1 FROM accounts WHERE id = owner AND access_state = 'active')
    AND EXISTS (SELECT 1 FROM accounts WHERE id = shopper AND access_state = 'active');
END $$;
--> statement-breakpoint
CREATE FUNCTION purchase_code_issue() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t sponsor_tasks%ROWTYPE;
BEGIN
  SELECT * INTO t FROM sponsor_tasks WHERE id = NEW.task_id FOR SHARE;
  IF NOT purchase_campaign_live(t, NEW.account_id)
    OR EXISTS (SELECT 1 FROM purchase_confirmations WHERE task_id = NEW.task_id AND account_id = NEW.account_id) THEN
    RAISE EXCEPTION 'Offer unavailable' USING ERRCODE = '23514';
  END IF;
  IF (SELECT count(*) FROM purchase_codes WHERE task_id = NEW.task_id AND account_id = NEW.account_id
      AND created_at > clock_timestamp() - interval '1 hour') >= 10 THEN
    RAISE EXCEPTION 'Too many purchase codes requested' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  NEW.expires_at := NEW.created_at + interval '15 minutes';
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER purchase_code_issue BEFORE INSERT ON purchase_codes FOR EACH ROW EXECUTE FUNCTION purchase_code_issue();
--> statement-breakpoint
CREATE FUNCTION purchase_confirm() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c purchase_codes%ROWTYPE; t sponsor_tasks%ROWTYPE; owner uuid; used bigint;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'READ COMMITTED required' USING ERRCODE='23514'; END IF;
  SELECT * INTO c FROM purchase_codes WHERE id = NEW.code_id;
  -- Capacity is serialized per campaign; the daily limit per shopper across campaigns.
  SELECT * INTO t FROM sponsor_tasks WHERE id = c.task_id FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtextextended('purchase-shopper:' || c.account_id::text, 0));
  SELECT owner_id INTO owner FROM sponsor_profiles WHERE id = t.sponsor_id;
  IF c.id IS NULL OR c.task_id <> NEW.task_id OR c.account_id <> NEW.account_id
    OR c.expires_at <= clock_timestamp() OR owner IS DISTINCT FROM NEW.actor_id
    OR NOT purchase_campaign_live(t, NEW.account_id)
    OR NEW.amount_kobo < (t.campaign_terms->>'minSpendKobo')::bigint THEN
    RAISE EXCEPTION 'Purchase cannot be confirmed' USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO used FROM purchase_confirmations p WHERE p.task_id = t.id
    AND NOT EXISTS (SELECT 1 FROM purchase_voids v WHERE v.confirmation_id = p.id);
  IF used >= t.capacity THEN RAISE EXCEPTION 'Campaign is full' USING ERRCODE = '23514'; END IF;
  IF (SELECT count(*) FROM purchase_confirmations WHERE account_id = NEW.account_id
      AND created_at > clock_timestamp() - interval '24 hours') >= 5 THEN
    RAISE EXCEPTION 'Shopper daily purchase limit reached' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  NEW.release_at := NEW.created_at + (t.campaign_terms->>'holdHours')::integer * interval '1 hour';
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER purchase_confirm BEFORE INSERT ON purchase_confirmations FOR EACH ROW EXECUTE FUNCTION purchase_confirm();
--> statement-breakpoint
CREATE FUNCTION purchase_void() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p purchase_confirmations%ROWTYPE; owner uuid;
BEGIN
  SELECT * INTO p FROM purchase_confirmations WHERE id = NEW.confirmation_id FOR UPDATE;
  SELECT sp.owner_id INTO owner FROM sponsor_tasks t JOIN sponsor_profiles sp ON sp.id = t.sponsor_id WHERE t.id = p.task_id;
  IF p.id IS NULL OR owner IS DISTINCT FROM NEW.actor_id OR clock_timestamp() >= p.release_at
    OR NOT EXISTS (SELECT 1 FROM accounts WHERE id = owner AND access_state = 'active')
    OR EXISTS (SELECT 1 FROM purchase_releases WHERE confirmation_id = p.id)
    OR length(btrim(NEW.reason)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Purchase cannot be voided' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER purchase_void BEFORE INSERT ON purchase_voids FOR EACH ROW EXECUTE FUNCTION purchase_void();
--> statement-breakpoint
CREATE FUNCTION purchase_release() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p purchase_confirmations%ROWTYPE;
BEGIN
  SELECT * INTO p FROM purchase_confirmations WHERE id = NEW.confirmation_id FOR UPDATE;
  IF p.id IS NULL OR clock_timestamp() < p.release_at
    OR EXISTS (SELECT 1 FROM purchase_voids WHERE confirmation_id = p.id)
    OR NOT EXISTS (SELECT 1 FROM accounts WHERE id = p.account_id AND access_state = 'active') THEN
    RAISE EXCEPTION 'Cash back is not releasable' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER purchase_release BEFORE INSERT ON purchase_releases FOR EACH ROW EXECUTE FUNCTION purchase_release();
--> statement-breakpoint
CREATE FUNCTION purchase_release_credit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p purchase_confirmations%ROWTYPE; t sponsor_tasks%ROWTYPE; wallet uuid;
BEGIN
  SELECT * INTO p FROM purchase_confirmations WHERE id = NEW.confirmation_id;
  SELECT * INTO t FROM sponsor_tasks WHERE id = p.task_id;
  INSERT INTO funding_accounts(owner_id, bucket) VALUES (p.account_id, 'reward_wallet') ON CONFLICT DO NOTHING;
  SELECT id INTO wallet FROM funding_accounts WHERE owner_id = p.account_id AND bucket = 'reward_wallet';
  INSERT INTO funding_transfers(id, source_id, destination_id, amount_kobo, kind, reference, actor_id, reason)
  VALUES (gen_random_uuid(), t.allocation_account_id, wallet, t.reward_kobo, 'purchase_cashback',
    'purchase:' || p.id::text, p.account_id, 'Released purchase cash back');
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER purchase_release_credit AFTER INSERT ON purchase_releases FOR EACH ROW EXECUTE FUNCTION purchase_release_credit();
--> statement-breakpoint
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['purchase_codes','purchase_confirmations','purchase_voids','purchase_releases'] LOOP
    EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION funding_reject_mutation()', name);
    EXECUTE format('CREATE TRIGGER no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION funding_reject_mutation()', name);
  END LOOP;
END $$;
