CREATE TABLE "appeal_resolutions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"appeal_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"grant_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appeal_resolutions_appeal_id_unique" UNIQUE("appeal_id"),
	CONSTRAINT "appeal_resolution_state" CHECK ("appeal_resolutions"."decision" in ('approved','upheld'))
);
--> statement-breakpoint

CREATE TABLE "appeal_reviewer_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"granted_by" uuid NOT NULL,
	"reason" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE "proof_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"proof_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proof_decisions_proof_id_unique" UNIQUE("proof_id"),
	CONSTRAINT "proof_decision_state" CHECK ("proof_decisions"."decision" in ('approved','changes_required','rejected'))
);
--> statement-breakpoint

CREATE TABLE "task_appeals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"proof_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_appeals_proof_id_unique" UNIQUE("proof_id")
);
--> statement-breakpoint

CREATE TABLE "task_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE "task_proofs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"evidence" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_proof_revision_range" CHECK ("task_proofs"."revision" in (1,2))
);
--> statement-breakpoint

CREATE TABLE "task_publications" (
	"task_id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "funding_accounts" DROP CONSTRAINT "funding_account_shape";--> statement-breakpoint

ALTER TABLE "funding_transfers" DROP CONSTRAINT "funding_transfer_kind";--> statement-breakpoint

ALTER TABLE "sponsor_tasks" DROP CONSTRAINT "sponsor_task_review_gate";--> statement-breakpoint

ALTER TABLE "sponsor_tasks" ADD COLUMN "work_terms" jsonb;--> statement-breakpoint

ALTER TABLE "appeal_resolutions" ADD CONSTRAINT "appeal_resolutions_appeal_id_task_appeals_id_fk" FOREIGN KEY ("appeal_id") REFERENCES "public"."task_appeals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "appeal_resolutions" ADD CONSTRAINT "appeal_resolutions_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "appeal_resolutions" ADD CONSTRAINT "appeal_resolutions_grant_id_appeal_reviewer_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."appeal_reviewer_grants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "appeal_reviewer_grants" ADD CONSTRAINT "appeal_reviewer_grants_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "appeal_reviewer_grants" ADD CONSTRAINT "appeal_reviewer_grants_granted_by_accounts_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "proof_decisions" ADD CONSTRAINT "proof_decisions_proof_id_task_proofs_id_fk" FOREIGN KEY ("proof_id") REFERENCES "public"."task_proofs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "proof_decisions" ADD CONSTRAINT "proof_decisions_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "task_appeals" ADD CONSTRAINT "task_appeals_proof_id_task_proofs_id_fk" FOREIGN KEY ("proof_id") REFERENCES "public"."task_proofs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "task_claims" ADD CONSTRAINT "task_claims_task_id_sponsor_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."sponsor_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "task_claims" ADD CONSTRAINT "task_claims_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "task_proofs" ADD CONSTRAINT "task_proofs_claim_id_task_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."task_claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "task_publications" ADD CONSTRAINT "task_publications_task_id_sponsor_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."sponsor_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "task_publications" ADD CONSTRAINT "task_publications_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "task_claim_once" ON "task_claims" USING btree ("task_id","account_id");--> statement-breakpoint

CREATE UNIQUE INDEX "task_proof_revision" ON "task_proofs" USING btree ("claim_id","revision");--> statement-breakpoint

CREATE UNIQUE INDEX "funding_reward_wallet_unique" ON "funding_accounts" USING btree ("owner_id") WHERE "funding_accounts"."bucket" = 'reward_wallet';--> statement-breakpoint

ALTER TABLE "funding_accounts" ADD CONSTRAINT "funding_account_shape" CHECK (("funding_accounts"."bucket" = 'clearing' and "funding_accounts"."owner_id" is null and "funding_accounts"."allocation_id" is null) or ("funding_accounts"."bucket" in ('available', 'reward_wallet') and "funding_accounts"."owner_id" is not null and "funding_accounts"."allocation_id" is null) or ("funding_accounts"."bucket" = 'task_locked' and "funding_accounts"."owner_id" is not null and "funding_accounts"."allocation_id" is not null));--> statement-breakpoint

ALTER TABLE "funding_transfers" ADD CONSTRAINT "funding_transfer_kind" CHECK ("funding_transfers"."kind" in ('funding_confirmed', 'task_lock', 'task_reward'));--> statement-breakpoint

ALTER TABLE "sponsor_tasks" ADD CONSTRAINT "sponsor_task_review_gate" CHECK ("sponsor_tasks"."review_state" in ('pending_review', 'approved', 'changes_required', 'rejected') and "sponsor_tasks"."lifecycle" in ('not_live', 'published') and "sponsor_tasks"."terms_version" > 0);--> statement-breakpoint
-- All workflow history is append-only. A future amendment needs new reviewed terms.
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['task_publications','task_claims','task_proofs','proof_decisions','task_appeals','appeal_resolutions'] LOOP
    EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION funding_reject_mutation()', name);
    EXECUTE format('CREATE TRIGGER no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION funding_reject_mutation()', name);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sponsor_task_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Task history is immutable' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.review_state <> 'pending_review' OR NEW.terms_version <> 1 OR NEW.lifecycle <> 'not_live' THEN
      RAISE EXCEPTION 'New tasks require review' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'lifecycle') = (to_jsonb(OLD) - 'lifecycle')
     AND OLD.lifecycle = 'not_live' AND NEW.lifecycle = 'published'
     AND EXISTS (SELECT 1 FROM task_publications WHERE task_id = OLD.id) THEN RETURN NEW; END IF;
  IF (to_jsonb(NEW) - 'review_state') IS DISTINCT FROM (to_jsonb(OLD) - 'review_state')
    OR OLD.review_state <> 'pending_review' OR NEW.review_state = 'pending_review'
    OR NOT EXISTS (SELECT 1 FROM task_reviews WHERE task_id = OLD.id AND terms_version = OLD.terms_version
      AND terms_hash = OLD.request_hash AND decision = NEW.review_state) THEN
    RAISE EXCEPTION 'Task changes require an audited review transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION task_work_publish() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t sponsor_tasks%ROWTYPE; owner uuid; backing numeric;
BEGIN
  SELECT * INTO t FROM sponsor_tasks WHERE id = NEW.task_id FOR UPDATE;
  SELECT owner_id INTO owner FROM sponsor_profiles WHERE id = t.sponsor_id;
  IF owner IS DISTINCT FROM NEW.actor_id OR NOT EXISTS (SELECT 1 FROM accounts WHERE id = owner AND access_state = 'active')
    OR t.review_state <> 'approved' OR t.lifecycle <> 'not_live' OR t.ends_at <= clock_timestamp()
    OR t.model <> 'capped_fixed' OR t.work_terms IS NULL
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
  PERFORM id FROM funding_accounts WHERE id = t.allocation_account_id FOR UPDATE;
  SELECT coalesce(sum(CASE WHEN destination_id = t.allocation_account_id THEN amount_kobo ELSE -amount_kobo END),0)
    INTO backing FROM funding_transfers WHERE source_id = t.allocation_account_id OR destination_id = t.allocation_account_id;
  IF backing <> t.budget_kobo THEN RAISE EXCEPTION 'Full backing required' USING ERRCODE = '23514'; END IF;
  UPDATE sponsor_tasks SET lifecycle = 'published' WHERE id = t.id;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER task_work_publish AFTER INSERT ON task_publications FOR EACH ROW EXECUTE FUNCTION task_work_publish();
--> statement-breakpoint
CREATE FUNCTION task_work_claim() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t sponsor_tasks%ROWTYPE; owner uuid; used bigint;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'READ COMMITTED required' USING ERRCODE='23514'; END IF;
  SELECT * INTO t FROM sponsor_tasks WHERE id = NEW.task_id FOR UPDATE;
  SELECT owner_id INTO owner FROM sponsor_profiles WHERE id = t.sponsor_id;
  IF owner = NEW.account_id OR NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND access_state = 'active')
    OR NOT EXISTS (SELECT 1 FROM accounts WHERE id = owner AND access_state = 'active')
    OR t.lifecycle <> 'published' OR t.review_state <> 'approved' OR t.model <> 'capped_fixed'
    OR clock_timestamp() < t.starts_at OR clock_timestamp() >= t.ends_at THEN
    RAISE EXCEPTION 'Task cannot be joined' USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO used FROM task_claims WHERE task_id = t.id;
  IF used >= t.capacity THEN RAISE EXCEPTION 'Task is full' USING ERRCODE = '23514'; END IF;
  NEW.created_at := clock_timestamp(); RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER task_work_claim BEFORE INSERT ON task_claims FOR EACH ROW EXECUTE FUNCTION task_work_claim();
--> statement-breakpoint
CREATE FUNCTION task_work_proof() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c task_claims%ROWTYPE; t sponsor_tasks%ROWTYPE; d proof_decisions%ROWTYPE;
BEGIN
  SELECT * INTO c FROM task_claims WHERE id = NEW.claim_id FOR UPDATE;
  SELECT * INTO t FROM sponsor_tasks WHERE id = c.task_id;
  IF c.id IS NULL OR length(btrim(NEW.evidence)) NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'Invalid evidence' USING ERRCODE='23514'; END IF;
  IF NEW.revision = 1 THEN
    IF clock_timestamp() >= t.ends_at THEN RAISE EXCEPTION 'Submission deadline passed' USING ERRCODE='23514'; END IF;
  ELSE
    SELECT pd.* INTO d FROM proof_decisions pd JOIN task_proofs p ON p.id = pd.proof_id WHERE p.claim_id = c.id AND p.revision = 1;
    IF d.id IS NULL OR d.decision <> 'changes_required' OR clock_timestamp() >= d.created_at + (t.work_terms->>'correctionHours')::integer * interval '1 hour' THEN
      RAISE EXCEPTION 'Correction unavailable' USING ERRCODE='23514'; END IF;
  END IF;
  NEW.created_at := clock_timestamp(); RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER task_work_proof BEFORE INSERT ON task_proofs FOR EACH ROW EXECUTE FUNCTION task_work_proof();
--> statement-breakpoint
CREATE FUNCTION task_work_decide() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p task_proofs%ROWTYPE; c task_claims%ROWTYPE; owner uuid;
BEGIN
  SELECT * INTO p FROM task_proofs WHERE id = NEW.proof_id;
  SELECT * INTO c FROM task_claims WHERE id = p.claim_id FOR UPDATE;
  SELECT sp.owner_id INTO owner FROM sponsor_profiles sp JOIN sponsor_tasks t ON t.sponsor_id = sp.id WHERE t.id = c.task_id;
  IF owner IS DISTINCT FROM NEW.actor_id OR owner = c.account_id
    OR NOT EXISTS (SELECT 1 FROM accounts WHERE id = owner AND access_state = 'active')
    OR length(btrim(NEW.reason)) NOT BETWEEN 1 AND 2000
    OR (NEW.decision = 'changes_required' AND p.revision <> 1) THEN
    RAISE EXCEPTION 'Invalid proof decision' USING ERRCODE='23514'; END IF;
  NEW.created_at := clock_timestamp(); RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER task_work_decide BEFORE INSERT ON proof_decisions FOR EACH ROW EXECUTE FUNCTION task_work_decide();
--> statement-breakpoint
CREATE FUNCTION task_work_appeal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d proof_decisions%ROWTYPE; t sponsor_tasks%ROWTYPE;
BEGIN
  SELECT * INTO d FROM proof_decisions WHERE proof_id = NEW.proof_id;
  SELECT st.* INTO t FROM sponsor_tasks st JOIN task_claims c ON c.task_id=st.id JOIN task_proofs p ON p.claim_id=c.id WHERE p.id=NEW.proof_id;
  IF d.id IS NULL OR d.decision <> 'rejected' OR clock_timestamp() >= d.created_at + (t.work_terms->>'appealHours')::integer * interval '1 hour'
     OR length(btrim(NEW.reason)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'Appeal unavailable' USING ERRCODE='23514'; END IF;
  NEW.created_at := clock_timestamp(); RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER task_work_appeal BEFORE INSERT ON task_appeals FOR EACH ROW EXECUTE FUNCTION task_work_appeal();
--> statement-breakpoint
CREATE FUNCTION task_work_resolve() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g appeal_reviewer_grants%ROWTYPE; owner uuid; participant uuid;
BEGIN
  SELECT * INTO g FROM appeal_reviewer_grants WHERE id=NEW.grant_id FOR SHARE;
  SELECT sp.owner_id,c.account_id INTO owner,participant FROM task_appeals a JOIN task_proofs p ON p.id=a.proof_id JOIN task_claims c ON c.id=p.claim_id JOIN sponsor_tasks t ON t.id=c.task_id JOIN sponsor_profiles sp ON sp.id=t.sponsor_id WHERE a.id=NEW.appeal_id;
  IF g.id IS NULL OR g.account_id <> NEW.actor_id OR g.revoked_at IS NOT NULL OR g.expires_at <= clock_timestamp()
    OR NEW.actor_id IN (owner,participant) OR owner IS NULL
    OR NOT EXISTS (SELECT 1 FROM accounts WHERE id=NEW.actor_id AND access_state='active')
    OR length(btrim(NEW.reason)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'Appeal permission or independence missing' USING ERRCODE='23514'; END IF;
  NEW.created_at := clock_timestamp(); RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER task_work_resolve BEFORE INSERT ON appeal_resolutions FOR EACH ROW EXECUTE FUNCTION task_work_resolve();

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
CREATE FUNCTION task_work_credit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE proof uuid; c task_claims%ROWTYPE; t sponsor_tasks%ROWTYPE; wallet uuid;
BEGIN
  IF NEW.decision <> 'approved' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='proof_decisions' THEN proof:=NEW.proof_id;
  ELSE SELECT proof_id INTO proof FROM task_appeals WHERE id=NEW.appeal_id; END IF;
  SELECT tc.* INTO c FROM task_claims tc JOIN task_proofs p ON p.claim_id=tc.id WHERE p.id=proof FOR UPDATE OF tc;
  SELECT * INTO t FROM sponsor_tasks WHERE id=c.task_id;
  INSERT INTO funding_accounts(owner_id,bucket) VALUES(c.account_id,'reward_wallet') ON CONFLICT DO NOTHING;
  SELECT id INTO wallet FROM funding_accounts WHERE owner_id=c.account_id AND bucket='reward_wallet';
  INSERT INTO funding_transfers(id,source_id,destination_id,amount_kobo,kind,reference,actor_id,reason)
  VALUES(gen_random_uuid(),t.allocation_account_id,wallet,t.reward_kobo,'task_reward','claim:'||c.id::text,NEW.actor_id,'Approved task reward backing');
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER task_work_credit AFTER INSERT ON proof_decisions FOR EACH ROW EXECUTE FUNCTION task_work_credit();
--> statement-breakpoint
CREATE TRIGGER task_appeal_credit AFTER INSERT ON appeal_resolutions FOR EACH ROW EXECUTE FUNCTION task_work_credit();
--> statement-breakpoint
CREATE FUNCTION appeal_grant_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR (to_jsonb(NEW)-'revoked_at') IS DISTINCT FROM (to_jsonb(OLD)-'revoked_at')
    OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL THEN
    RAISE EXCEPTION 'Only one-way appeal permission revocation is permitted' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER appeal_grant_guard BEFORE UPDATE OR DELETE ON appeal_reviewer_grants FOR EACH ROW EXECUTE FUNCTION appeal_grant_guard();
--> statement-breakpoint
CREATE TRIGGER appeal_grant_no_truncate BEFORE TRUNCATE ON appeal_reviewer_grants FOR EACH STATEMENT EXECUTE FUNCTION funding_reject_mutation();
