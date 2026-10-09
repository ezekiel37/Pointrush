CREATE TABLE "account_avatars" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"file_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_deletions" (
	"file_id" uuid PRIMARY KEY NOT NULL,
	"reason" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_purpose" CHECK ("files"."purpose" in ('avatar', 'logo', 'evidence')),
	CONSTRAINT "file_type" CHECK ("files"."content_type" in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
        and ("files"."purpose" = 'evidence' or "files"."content_type" <> 'application/pdf')),
	CONSTRAINT "file_size" CHECK ("files"."size_bytes" > 0 and "files"."size_bytes" <= case when "files"."purpose" = 'evidence' then 5242880 else 2097152 end)
);
--> statement-breakpoint
CREATE TABLE "task_proof_files" (
	"proof_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "task_proof_files_proof_id_position_pk" PRIMARY KEY("proof_id","position"),
	CONSTRAINT "task_proof_files_file_id_unique" UNIQUE("file_id"),
	CONSTRAINT "task_proof_file_position" CHECK ("task_proof_files"."position" between 1 and 3)
);
--> statement-breakpoint
ALTER TABLE "business_profile_changes" DROP CONSTRAINT "business_profile_change_field";--> statement-breakpoint
ALTER TABLE "sponsor_profiles" ADD COLUMN "logo_file_id" uuid;--> statement-breakpoint
ALTER TABLE "account_avatars" ADD CONSTRAINT "account_avatars_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_avatars" ADD CONSTRAINT "account_avatars_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_deletions" ADD CONSTRAINT "file_deletions_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_owner_id_accounts_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_proof_files" ADD CONSTRAINT "task_proof_files_proof_id_task_proofs_id_fk" FOREIGN KEY ("proof_id") REFERENCES "public"."task_proofs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_proof_files" ADD CONSTRAINT "task_proof_files_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_avatar_latest" ON "account_avatars" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "file_owner" ON "files" USING btree ("owner_id","created_at");--> statement-breakpoint
ALTER TABLE "business_profile_changes" ADD CONSTRAINT "business_profile_change_field" CHECK ("business_profile_changes"."field" in ('name', 'contact_email', 'description', 'logo'));
--> statement-breakpoint
-- At most 50 uploads a day per person, from active accounts only.
CREATE FUNCTION file_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('files:' || NEW.owner_id::text, 0));
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.owner_id AND access_state = 'active')
    OR (SELECT count(*) FROM files WHERE owner_id = NEW.owner_id
        AND created_at > clock_timestamp() - interval '24 hours') >= 50 THEN
    RAISE EXCEPTION 'Upload limit reached' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER file_guard BEFORE INSERT ON files FOR EACH ROW EXECUTE FUNCTION file_guard();
--> statement-breakpoint
CREATE FUNCTION account_avatar_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.file_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM files f WHERE f.id = NEW.file_id
      AND f.owner_id = NEW.account_id AND f.purpose = 'avatar'
      AND NOT EXISTS (SELECT 1 FROM file_deletions d WHERE d.file_id = f.id)) THEN
    RAISE EXCEPTION 'Picture unavailable' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER account_avatar_guard BEFORE INSERT ON account_avatars
  FOR EACH ROW EXECUTE FUNCTION account_avatar_guard();
--> statement-breakpoint
-- Evidence belongs to the person who did the job, is attached to their
-- latest proof before anyone decides on it, and is then fixed.
CREATE FUNCTION task_proof_file_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE worker uuid;
BEGIN
  SELECT c.account_id INTO worker FROM task_proofs p JOIN task_claims c ON c.id = p.claim_id
    WHERE p.id = NEW.proof_id
      AND p.revision = (SELECT max(p2.revision) FROM task_proofs p2 WHERE p2.claim_id = p.claim_id);
  IF worker IS NULL
    OR EXISTS (SELECT 1 FROM proof_decisions d WHERE d.proof_id = NEW.proof_id)
    OR NOT EXISTS (SELECT 1 FROM files f WHERE f.id = NEW.file_id AND f.owner_id = worker
      AND f.purpose = 'evidence' AND NOT EXISTS (SELECT 1 FROM file_deletions d WHERE d.file_id = f.id)) THEN
    RAISE EXCEPTION 'Evidence unavailable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER task_proof_file_guard BEFORE INSERT ON task_proof_files
  FOR EACH ROW EXECUTE FUNCTION task_proof_file_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION business_profile_change_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  profile sponsor_profiles%ROWTYPE;
  current_value text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('business-profile:' || NEW.sponsor_id::text, 0));
  SELECT * INTO profile FROM sponsor_profiles WHERE id = NEW.sponsor_id;
  IF profile.id IS NULL OR NEW.actor_id <> profile.owner_id
    OR NOT EXISTS (SELECT 1 FROM accounts WHERE id = profile.owner_id AND access_state = 'active') THEN
    RAISE EXCEPTION 'Profile change unavailable' USING ERRCODE = '23514';
  END IF;
  current_value := CASE NEW.field WHEN 'name' THEN profile.name
    WHEN 'contact_email' THEN profile.contact_email WHEN 'logo' THEN profile.logo_file_id::text
    ELSE profile.description END;
  -- A logo must be the owner's own, unused logo upload.
  IF NEW.field = 'logo' AND NEW.new_value IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM files f WHERE f.id::text = NEW.new_value AND f.owner_id = profile.owner_id
        AND f.purpose = 'logo' AND NOT EXISTS (SELECT 1 FROM file_deletions d WHERE d.file_id = f.id)) THEN
    RAISE EXCEPTION 'Profile change unavailable' USING ERRCODE = '23514';
  END IF;
  IF NEW.old_value IS DISTINCT FROM current_value OR NEW.new_value IS NOT DISTINCT FROM current_value
    OR (NEW.field IN ('name', 'contact_email') AND (NEW.new_value IS NULL OR length(btrim(NEW.new_value)) = 0)) THEN
    RAISE EXCEPTION 'Profile change unavailable' USING ERRCODE = '23514';
  END IF;
  -- One rename and one new logo wait for review at a time; other details
  -- still change.
  IF NEW.field IN ('name', 'logo') AND EXISTS (SELECT 1 FROM business_profile_changes c
      WHERE c.sponsor_id = NEW.sponsor_id AND c.field = NEW.field
      AND c.needs_review AND NOT EXISTS (SELECT 1 FROM business_profile_decisions d WHERE d.change_id = c.id)) THEN
    RAISE EXCEPTION 'Profile change pending' USING ERRCODE = '23514';
  END IF;
  -- A reviewer checks every new logo (so nobody shows another brand's), and
  -- renames once a campaign was approved. Removing a logo needs no review.
  NEW.needs_review := (NEW.field = 'logo' AND NEW.new_value IS NOT NULL)
    OR (NEW.field = 'name' AND business_has_approved_campaign(NEW.sponsor_id));
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sponsor_profile_update_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  change business_profile_changes%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Business profiles cannot be deleted' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO change FROM business_profile_changes
    WHERE id = nullif(current_setting('acticlaim.profile_change', true), '')::uuid;
  IF change.id IS NULL OR change.sponsor_id <> OLD.id
    OR NEW.id IS DISTINCT FROM OLD.id OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
    OR NEW.terms_version IS DISTINCT FROM OLD.terms_version
    OR NEW.terms_accepted_at IS DISTINCT FROM OLD.terms_accepted_at
    OR (change.field <> 'name' AND NEW.name IS DISTINCT FROM OLD.name)
    OR (change.field <> 'contact_email' AND NEW.contact_email IS DISTINCT FROM OLD.contact_email)
    OR (change.field <> 'description' AND NEW.description IS DISTINCT FROM OLD.description)
    OR (change.field <> 'logo' AND NEW.logo_file_id IS DISTINCT FROM OLD.logo_file_id)
    OR (CASE change.field WHEN 'name' THEN NEW.name WHEN 'contact_email' THEN NEW.contact_email
        WHEN 'logo' THEN NEW.logo_file_id::text ELSE NEW.description END) IS DISTINCT FROM change.new_value
    OR (change.needs_review AND NOT EXISTS (SELECT 1 FROM business_profile_decisions d
        WHERE d.change_id = change.id AND d.decision = 'applied')) THEN
    RAISE EXCEPTION 'Business profile is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['files', 'file_deletions', 'account_avatars', 'task_proof_files'] LOOP
    EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION funding_reject_mutation()', name);
    EXECUTE format('CREATE TRIGGER no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION funding_reject_mutation()', name);
  END LOOP;
END $$;
