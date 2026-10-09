CREATE TABLE "business_handles" (
	"handle" varchar(30) PRIMARY KEY NOT NULL,
	"sponsor_id" uuid NOT NULL,
	"seq" bigserial NOT NULL,
	"actor_id" uuid NOT NULL,
	"reason" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_handles_seq_unique" UNIQUE("seq"),
	CONSTRAINT "business_handle_format" CHECK ("business_handles"."handle" collate "C" ~ '^[a-z][a-z0-9_]{1,28}[a-z0-9]$' and position('__' in "business_handles"."handle") = 0)
);
--> statement-breakpoint
CREATE TABLE "business_profile_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sponsor_id" uuid NOT NULL,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"needs_review" boolean DEFAULT false NOT NULL,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_profile_change_field" CHECK ("business_profile_changes"."field" in ('name', 'contact_email', 'description'))
);
--> statement-breakpoint
CREATE TABLE "business_profile_decisions" (
	"change_id" uuid PRIMARY KEY NOT NULL,
	"decision" text NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"reason" varchar(500) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_profile_decision" CHECK ("business_profile_decisions"."decision" in ('applied', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "display_name_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"old_value" varchar(80) NOT NULL,
	"new_value" varchar(80) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sponsor_profiles" ADD COLUMN "description" varchar(500);--> statement-breakpoint
ALTER TABLE "business_handles" ADD CONSTRAINT "business_handles_sponsor_id_sponsor_profiles_id_fk" FOREIGN KEY ("sponsor_id") REFERENCES "public"."sponsor_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_handles" ADD CONSTRAINT "business_handles_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_profile_changes" ADD CONSTRAINT "business_profile_changes_sponsor_id_sponsor_profiles_id_fk" FOREIGN KEY ("sponsor_id") REFERENCES "public"."sponsor_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_profile_changes" ADD CONSTRAINT "business_profile_changes_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_profile_decisions" ADD CONSTRAINT "business_profile_decisions_change_id_business_profile_changes_id_fk" FOREIGN KEY ("change_id") REFERENCES "public"."business_profile_changes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_profile_decisions" ADD CONSTRAINT "business_profile_decisions_reviewer_id_accounts_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "display_name_changes" ADD CONSTRAINT "display_name_changes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "business_handle_sponsor" ON "business_handles" USING btree ("sponsor_id","seq");--> statement-breakpoint
CREATE INDEX "business_profile_change_sponsor" ON "business_profile_changes" USING btree ("sponsor_id","created_at");--> statement-breakpoint
CREATE INDEX "display_name_change_account" ON "display_name_changes" USING btree ("account_id","created_at");--> statement-breakpoint
-- Handles nobody may take: built-in words plus the admin's list.
CREATE FUNCTION handle_reserved(candidate text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT candidate = ANY (ARRAY['admin', 'administrator', 'acticlaim', 'pointrush', 'support', 'help',
      'official', 'staff', 'team', 'security', 'billing', 'payments', 'wallet', 'settings', 'system',
      'root', 'api', 'auth', 'login', 'signup', 'review', 'reviewer', 'business', 'offers', 'invite',
      'join', 'claim', 'terms', 'privacy', 'news', 'info'])
    OR coalesce(platform_settings_current() -> 'handles' -> 'reserved', '[]'::jsonb) ? candidate
$$;
--> statement-breakpoint
-- Whether a business has a campaign a reviewer approved (or that went live).
CREATE FUNCTION business_has_approved_campaign(sponsor uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM sponsor_tasks t WHERE t.sponsor_id = sponsor
    AND (t.review_state = 'approved' OR EXISTS (SELECT 1 FROM task_publications p WHERE p.task_id = t.id)))
$$;
--> statement-breakpoint
-- Handles and usernames share one namespace, checked under one lock.
CREATE FUNCTION handle_taken(candidate text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM usernames WHERE username = candidate)
    OR EXISTS (SELECT 1 FROM business_handles WHERE handle = candidate)
$$;
--> statement-breakpoint
CREATE FUNCTION business_handle_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  owner uuid;
  changes int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('handle:' || NEW.handle, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('business-handle:' || NEW.sponsor_id::text, 0));
  IF handle_taken(NEW.handle) OR handle_reserved(NEW.handle) THEN
    RAISE EXCEPTION 'Handle unavailable' USING ERRCODE = '23514';
  END IF;
  SELECT owner_id INTO owner FROM sponsor_profiles WHERE id = NEW.sponsor_id;
  SELECT count(*) INTO changes FROM business_handles WHERE sponsor_id = NEW.sponsor_id;
  -- The first handle is the owner's choice. The owner may change it once,
  -- until the business's first campaign is approved. After that only a
  -- reviewer can, with a reason.
  IF NEW.actor_id = owner AND (changes = 0
      OR (changes = 1 AND NOT business_has_approved_campaign(NEW.sponsor_id))) THEN
    NULL;
  ELSIF changes > 0 AND staff_reviewer_active(NEW.actor_id) AND NEW.actor_id <> owner
      AND length(btrim(coalesce(NEW.reason, ''))) >= 3 THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'Handle locked' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER business_handle_guard BEFORE INSERT ON business_handles
  FOR EACH ROW EXECUTE FUNCTION business_handle_guard();
--> statement-breakpoint
-- A new username cannot take a business handle.
CREATE FUNCTION username_not_handle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('handle:' || NEW.username, 0));
  IF EXISTS (SELECT 1 FROM business_handles WHERE handle = NEW.username) THEN
    RAISE EXCEPTION 'Username unavailable' USING ERRCODE = '23505', CONSTRAINT = 'usernames_pkey';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER username_not_handle BEFORE INSERT ON usernames
  FOR EACH ROW EXECUTE FUNCTION username_not_handle();
--> statement-breakpoint
-- A free handle made from a business name: mama_put_kitchen, then
-- mama_put_kitchen_2 and so on.
CREATE FUNCTION handle_suggest(business_name text) RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE
  base text;
  candidate text;
  n int := 1;
BEGIN
  base := trim(both '_' from regexp_replace(lower(coalesce(business_name, '')), '[^a-z0-9]+', '_', 'g'));
  IF base !~ '^[a-z]' THEN base := 'b_' || base; END IF;
  base := trim(both '_' from left(base, 24));
  IF length(base) < 3 THEN base := 'business'; END IF;
  candidate := base;
  WHILE handle_taken(candidate) OR handle_reserved(candidate) LOOP
    n := n + 1;
    candidate := base || '_' || n;
  END LOOP;
  RETURN candidate;
END $$;
--> statement-breakpoint
-- Existing businesses get a handle from their name. Their owners can still
-- change it once.
DO $$
DECLARE b record;
BEGIN
  FOR b IN SELECT id, owner_id, name FROM sponsor_profiles ORDER BY terms_accepted_at, id LOOP
    INSERT INTO business_handles (handle, sponsor_id, actor_id)
      VALUES (handle_suggest(b.name), b.id, b.owner_id);
  END LOOP;
END $$;
--> statement-breakpoint
-- A change must match the current value; a name change after an approved
-- campaign waits for a reviewer, one at a time.
CREATE FUNCTION business_profile_change_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
    WHEN 'contact_email' THEN profile.contact_email ELSE profile.description END;
  IF NEW.old_value IS DISTINCT FROM current_value OR NEW.new_value IS NOT DISTINCT FROM current_value
    OR (NEW.field <> 'description' AND (NEW.new_value IS NULL OR length(btrim(NEW.new_value)) = 0)) THEN
    RAISE EXCEPTION 'Profile change unavailable' USING ERRCODE = '23514';
  END IF;
  -- One rename waits for review at a time; other details still change.
  IF NEW.field = 'name' AND EXISTS (SELECT 1 FROM business_profile_changes c WHERE c.sponsor_id = NEW.sponsor_id
      AND c.needs_review AND NOT EXISTS (SELECT 1 FROM business_profile_decisions d WHERE d.change_id = c.id)) THEN
    RAISE EXCEPTION 'Profile change pending' USING ERRCODE = '23514';
  END IF;
  NEW.needs_review := NEW.field = 'name' AND business_has_approved_campaign(NEW.sponsor_id);
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER business_profile_change_guard BEFORE INSERT ON business_profile_changes
  FOR EACH ROW EXECUTE FUNCTION business_profile_change_guard();
--> statement-breakpoint
CREATE FUNCTION business_profile_decision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  change business_profile_changes%ROWTYPE;
BEGIN
  SELECT * INTO change FROM business_profile_changes WHERE id = NEW.change_id;
  IF change.id IS NULL OR NOT change.needs_review OR NOT staff_reviewer_active(NEW.reviewer_id)
    OR NEW.reviewer_id = (SELECT owner_id FROM sponsor_profiles WHERE id = change.sponsor_id) THEN
    RAISE EXCEPTION 'Profile decision unavailable' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER business_profile_decision_guard BEFORE INSERT ON business_profile_decisions
  FOR EACH ROW EXECUTE FUNCTION business_profile_decision_guard();
--> statement-breakpoint
-- The profile row may change only to apply a recorded change, named in
-- this transaction. Everything else about it stays fixed.
DROP TRIGGER sponsor_profiles_immutable ON sponsor_profiles;
--> statement-breakpoint
CREATE FUNCTION sponsor_profile_update_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
    OR (CASE change.field WHEN 'name' THEN NEW.name WHEN 'contact_email' THEN NEW.contact_email
        ELSE NEW.description END) IS DISTINCT FROM change.new_value
    OR (change.needs_review AND NOT EXISTS (SELECT 1 FROM business_profile_decisions d
        WHERE d.change_id = change.id AND d.decision = 'applied')) THEN
    RAISE EXCEPTION 'Business profile is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER sponsor_profile_update_guard BEFORE UPDATE OR DELETE ON sponsor_profiles
  FOR EACH ROW EXECUTE FUNCTION sponsor_profile_update_guard();
--> statement-breakpoint
-- Display names: once every 7 days, with history.
CREATE FUNCTION display_name_change_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('display-name:' || NEW.account_id::text, 0));
  IF NEW.old_value IS DISTINCT FROM (SELECT display_name FROM account_profiles WHERE account_id = NEW.account_id)
    OR NEW.new_value = NEW.old_value
    OR NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND access_state = 'active') THEN
    RAISE EXCEPTION 'Display name change unavailable' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM display_name_changes WHERE account_id = NEW.account_id
      AND created_at > clock_timestamp() - interval '7 days') THEN
    RAISE EXCEPTION 'Display name changed recently' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER display_name_change_guard BEFORE INSERT ON display_name_changes
  FOR EACH ROW EXECUTE FUNCTION display_name_change_guard();
--> statement-breakpoint
CREATE FUNCTION account_profile_update_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.display_name IS DISTINCT FROM OLD.display_name AND NOT EXISTS (
      SELECT 1 FROM display_name_changes c
      WHERE c.id = nullif(current_setting('acticlaim.display_name_change', true), '')::uuid
        AND c.account_id = OLD.account_id AND c.new_value = NEW.display_name) THEN
    RAISE EXCEPTION 'Display name change unavailable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER account_profile_update_guard BEFORE UPDATE ON account_profiles
  FOR EACH ROW EXECUTE FUNCTION account_profile_update_guard();
--> statement-breakpoint
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['business_handles', 'business_profile_changes',
      'business_profile_decisions', 'display_name_changes'] LOOP
    EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION funding_reject_mutation()', name);
    EXECUTE format('CREATE TRIGGER no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION funding_reject_mutation()', name);
  END LOOP;
END $$;
