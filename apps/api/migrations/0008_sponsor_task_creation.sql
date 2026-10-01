CREATE TABLE "sponsor_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"contact_email" varchar(320) NOT NULL,
	"terms_version" varchar(80) NOT NULL,
	"terms_accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sponsor_name_present" CHECK (length(btrim("sponsor_profiles"."name")) > 0),
	CONSTRAINT "sponsor_terms_present" CHECK (length(btrim("sponsor_profiles"."terms_version")) > 0)
);
--> statement-breakpoint
CREATE TABLE "sponsor_tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sponsor_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"allocation_account_id" uuid NOT NULL,
	"title" varchar(160) NOT NULL,
	"instructions" text NOT NULL,
	"proof_requirements" text NOT NULL,
	"rejection_criteria" text NOT NULL,
	"model" text NOT NULL,
	"capacity" integer NOT NULL,
	"reward_kobo" bigint NOT NULL,
	"budget_kobo" bigint NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"review_state" text DEFAULT 'pending_review' NOT NULL,
	"lifecycle" text DEFAULT 'not_live' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sponsor_task_model" CHECK ("sponsor_tasks"."model" in ('capped_fixed', 'selected_assignment')),
	CONSTRAINT "sponsor_task_budget" CHECK ("sponsor_tasks"."capacity" > 0 and "sponsor_tasks"."reward_kobo" > 0 and "sponsor_tasks"."budget_kobo" = "sponsor_tasks"."reward_kobo"::numeric * "sponsor_tasks"."capacity"),
	CONSTRAINT "sponsor_task_dates" CHECK ("sponsor_tasks"."ends_at" > "sponsor_tasks"."starts_at"),
	CONSTRAINT "sponsor_task_review_gate" CHECK ("sponsor_tasks"."review_state" = 'pending_review' and "sponsor_tasks"."lifecycle" = 'not_live')
);
--> statement-breakpoint
ALTER TABLE "sponsor_profiles" ADD CONSTRAINT "sponsor_profiles_owner_id_accounts_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsor_tasks" ADD CONSTRAINT "sponsor_tasks_sponsor_id_sponsor_profiles_id_fk" FOREIGN KEY ("sponsor_id") REFERENCES "public"."sponsor_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsor_tasks" ADD CONSTRAINT "sponsor_tasks_allocation_account_id_funding_accounts_id_fk" FOREIGN KEY ("allocation_account_id") REFERENCES "public"."funding_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sponsor_owner_unique" ON "sponsor_profiles" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sponsor_task_request_unique" ON "sponsor_tasks" USING btree ("sponsor_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sponsor_task_allocation_unique" ON "sponsor_tasks" USING btree ("allocation_account_id");
--> statement-breakpoint
CREATE FUNCTION sponsor_task_validate_funding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  owner uuid;
  allocation funding_accounts%ROWTYPE;
  backing numeric;
BEGIN
  SELECT owner_id INTO owner FROM sponsor_profiles WHERE id = NEW.sponsor_id;
  SELECT * INTO allocation FROM funding_accounts WHERE id = NEW.allocation_account_id FOR UPDATE;
  IF owner IS NULL OR allocation.id IS NULL OR allocation.bucket <> 'task_locked'
    OR allocation.owner_id IS DISTINCT FROM owner OR allocation.allocation_id IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'Task allocation ownership mismatch' USING ERRCODE = '23514';
  END IF;
  SELECT coalesce(sum(CASE WHEN destination_id = allocation.id THEN amount_kobo ELSE -amount_kobo END), 0)
    INTO backing FROM funding_transfers WHERE source_id = allocation.id OR destination_id = allocation.id;
  IF backing <> NEW.budget_kobo THEN
    RAISE EXCEPTION 'Task budget must be fully locked at creation' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sponsor_task_funding BEFORE INSERT ON sponsor_tasks
FOR EACH ROW EXECUTE FUNCTION sponsor_task_validate_funding();
--> statement-breakpoint
-- These initial records cannot be edited until versioned amendments and review
-- transitions are implemented in a subsequent migration.
CREATE TRIGGER sponsor_tasks_immutable BEFORE UPDATE OR DELETE ON sponsor_tasks
FOR EACH ROW EXECUTE FUNCTION funding_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER sponsor_profiles_immutable BEFORE UPDATE OR DELETE ON sponsor_profiles
FOR EACH ROW EXECUTE FUNCTION funding_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER sponsor_tasks_no_truncate BEFORE TRUNCATE ON sponsor_tasks
FOR EACH STATEMENT EXECUTE FUNCTION funding_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER sponsor_profiles_no_truncate BEFORE TRUNCATE ON sponsor_profiles
FOR EACH STATEMENT EXECUTE FUNCTION funding_reject_mutation();
