CREATE TABLE "task_reviewer_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"granted_by" uuid NOT NULL,
	"reason" varchar(1000) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"revocation_reason" varchar(1000),
	CONSTRAINT "task_review_grant_duration" CHECK ("task_reviewer_grants"."expires_at" > "task_reviewer_grants"."created_at"),
	CONSTRAINT "task_review_grant_reason" CHECK (length(btrim("task_reviewer_grants"."reason")) > 0),
	CONSTRAINT "task_review_revocation" CHECK (("task_reviewer_grants"."revoked_at" is null and "task_reviewer_grants"."revoked_by" is null and "task_reviewer_grants"."revocation_reason" is null) or ("task_reviewer_grants"."revoked_at" is not null and "task_reviewer_grants"."revoked_by" is not null and "task_reviewer_grants"."revocation_reason" is not null and length(btrim("task_reviewer_grants"."revocation_reason")) > 0 and "task_reviewer_grants"."revoked_at" >= "task_reviewer_grants"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "task_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"terms_version" integer NOT NULL,
	"terms_hash" varchar(64) NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"grant_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"decision" text NOT NULL,
	"checklist" jsonb NOT NULL,
	"reason" varchar(2000) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_review_version_positive" CHECK ("task_reviews"."terms_version" > 0),
	CONSTRAINT "task_review_decision" CHECK ("task_reviews"."decision" in ('approved', 'changes_required', 'rejected')),
	CONSTRAINT "task_review_reason" CHECK (length(btrim("task_reviews"."reason")) > 0),
	CONSTRAINT "task_review_checklist" CHECK (jsonb_typeof("task_reviews"."checklist") = 'object' and ("task_reviews"."checklist" - array['permittedObjective', 'clearInstructions', 'feasibleProof', 'fairRewardTerms', 'safeDestinations']) = '{}'::jsonb and "task_reviews"."checklist" ?& array['permittedObjective', 'clearInstructions', 'feasibleProof', 'fairRewardTerms', 'safeDestinations'] and jsonb_typeof("task_reviews"."checklist"->'permittedObjective') = 'boolean' and jsonb_typeof("task_reviews"."checklist"->'clearInstructions') = 'boolean' and jsonb_typeof("task_reviews"."checklist"->'feasibleProof') = 'boolean' and jsonb_typeof("task_reviews"."checklist"->'fairRewardTerms') = 'boolean' and jsonb_typeof("task_reviews"."checklist"->'safeDestinations') = 'boolean'),
	CONSTRAINT "task_review_approval_complete" CHECK ("task_reviews"."decision" <> 'approved' or "task_reviews"."checklist" = '{"permittedObjective":true,"clearInstructions":true,"feasibleProof":true,"fairRewardTerms":true,"safeDestinations":true}'::jsonb)
);
--> statement-breakpoint
ALTER TABLE "sponsor_tasks" DROP CONSTRAINT "sponsor_task_review_gate";--> statement-breakpoint
ALTER TABLE "sponsor_tasks" ADD COLUMN "terms_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "task_reviewer_grants" ADD CONSTRAINT "task_reviewer_grants_reviewer_id_accounts_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_reviewer_grants" ADD CONSTRAINT "task_reviewer_grants_granted_by_accounts_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_reviewer_grants" ADD CONSTRAINT "task_reviewer_grants_revoked_by_accounts_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_reviews" ADD CONSTRAINT "task_reviews_task_id_sponsor_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."sponsor_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_reviews" ADD CONSTRAINT "task_reviews_reviewer_id_accounts_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_reviews" ADD CONSTRAINT "task_reviews_grant_id_task_reviewer_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."task_reviewer_grants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "one_unrevoked_task_review_grant" ON "task_reviewer_grants" USING btree ("reviewer_id") WHERE "task_reviewer_grants"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "task_review_request_unique" ON "task_reviews" USING btree ("reviewer_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_review_version_unique" ON "task_reviews" USING btree ("task_id","terms_version");--> statement-breakpoint
ALTER TABLE "sponsor_tasks" ADD CONSTRAINT "sponsor_task_review_gate" CHECK ("sponsor_tasks"."review_state" in ('pending_review', 'approved', 'changes_required', 'rejected') and "sponsor_tasks"."lifecycle" = 'not_live' and "sponsor_tasks"."terms_version" > 0);
--> statement-breakpoint
CREATE FUNCTION task_review_grant_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Review grants retain their audit history' USING ERRCODE = '23514';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['revoked_at','revoked_by','revocation_reason']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['revoked_at','revoked_by','revocation_reason'])
    OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL OR NEW.revoked_by IS NULL
    OR NEW.revocation_reason IS NULL OR length(btrim(NEW.revocation_reason)) = 0 THEN
    RAISE EXCEPTION 'Only an audited one-way revocation is permitted' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER task_review_grants_guard BEFORE UPDATE OR DELETE ON task_reviewer_grants
FOR EACH ROW EXECUTE FUNCTION task_review_grant_guard();
--> statement-breakpoint
CREATE TRIGGER task_review_grants_no_truncate BEFORE TRUNCATE ON task_reviewer_grants
FOR EACH STATEMENT EXECUTE FUNCTION funding_reject_mutation();
--> statement-breakpoint
DROP TRIGGER sponsor_tasks_immutable ON sponsor_tasks;
--> statement-breakpoint
CREATE FUNCTION sponsor_task_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Task history is immutable' USING ERRCODE = '23514';
  ELSIF TG_OP = 'INSERT' THEN
    IF NEW.review_state <> 'pending_review' OR NEW.terms_version <> 1 THEN
      RAISE EXCEPTION 'New tasks require review' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'review_state') IS DISTINCT FROM (to_jsonb(OLD) - 'review_state')
    OR OLD.review_state <> 'pending_review' OR NEW.review_state = 'pending_review'
    OR NOT EXISTS (SELECT 1 FROM task_reviews WHERE task_id = OLD.id AND terms_version = OLD.terms_version
      AND terms_hash = OLD.request_hash AND decision = NEW.review_state) THEN
    RAISE EXCEPTION 'Task changes require an audited review transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sponsor_task_review_guard BEFORE INSERT OR UPDATE OR DELETE ON sponsor_tasks
FOR EACH ROW EXECUTE FUNCTION sponsor_task_review_guard();
--> statement-breakpoint
CREATE FUNCTION apply_task_review() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  task sponsor_tasks%ROWTYPE;
  permission task_reviewer_grants%ROWTYPE;
  sponsor_owner uuid;
  backing numeric;
BEGIN
  PERFORM id FROM accounts WHERE id = NEW.reviewer_id AND access_state = 'active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reviewer is not active' USING ERRCODE = '23514'; END IF;
  SELECT * INTO permission FROM task_reviewer_grants WHERE id = NEW.grant_id FOR SHARE;
  IF permission.id IS NULL OR permission.reviewer_id <> NEW.reviewer_id OR permission.revoked_at IS NOT NULL
    OR permission.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'Task review permission required' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO task FROM sponsor_tasks WHERE id = NEW.task_id FOR UPDATE;
  IF task.id IS NULL OR task.terms_version <> NEW.terms_version OR task.request_hash <> NEW.terms_hash
    OR task.review_state <> 'pending_review' OR task.lifecycle <> 'not_live' THEN
    RAISE EXCEPTION 'Task review is stale' USING ERRCODE = '23514';
  END IF;
  SELECT owner_id INTO sponsor_owner FROM sponsor_profiles WHERE id = task.sponsor_id;
  IF sponsor_owner = NEW.reviewer_id THEN
    RAISE EXCEPTION 'Self-review is forbidden' USING ERRCODE = '23514';
  END IF;
  IF NEW.decision = 'approved' THEN
    PERFORM id FROM funding_accounts WHERE id = task.allocation_account_id FOR UPDATE;
    SELECT coalesce(sum(CASE WHEN destination_id = task.allocation_account_id THEN amount_kobo ELSE -amount_kobo END), 0)
      INTO backing FROM funding_transfers WHERE source_id = task.allocation_account_id OR destination_id = task.allocation_account_id;
    IF backing <> task.budget_kobo THEN
      RAISE EXCEPTION 'Task backing does not match approved budget' USING ERRCODE = '23514';
    END IF;
  END IF;
  UPDATE sponsor_tasks SET review_state = NEW.decision WHERE id = task.id;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER apply_task_review AFTER INSERT ON task_reviews
FOR EACH ROW EXECUTE FUNCTION apply_task_review();
--> statement-breakpoint
CREATE TRIGGER task_reviews_immutable BEFORE UPDATE OR DELETE ON task_reviews
FOR EACH ROW EXECUTE FUNCTION funding_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER task_reviews_no_truncate BEFORE TRUNCATE ON task_reviews
FOR EACH STATEMENT EXECUTE FUNCTION funding_reject_mutation();
