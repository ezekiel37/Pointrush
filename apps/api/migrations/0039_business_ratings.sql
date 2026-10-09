CREATE TABLE "business_rating_removals" (
	"rating_id" uuid PRIMARY KEY NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"reason" varchar(500) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_rating_replies" (
	"rating_id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"body" varchar(500) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_ratings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sponsor_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"stars" smallint NOT NULL,
	"comment" varchar(500),
	"business_name" varchar(120) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	CONSTRAINT "business_rating_stars" CHECK ("business_ratings"."stars" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "business_rating_removals" ADD CONSTRAINT "business_rating_removals_rating_id_business_ratings_id_fk" FOREIGN KEY ("rating_id") REFERENCES "public"."business_ratings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_rating_removals" ADD CONSTRAINT "business_rating_removals_reviewer_id_accounts_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_rating_replies" ADD CONSTRAINT "business_rating_replies_rating_id_business_ratings_id_fk" FOREIGN KEY ("rating_id") REFERENCES "public"."business_ratings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_rating_replies" ADD CONSTRAINT "business_rating_replies_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_ratings" ADD CONSTRAINT "business_ratings_sponsor_id_sponsor_profiles_id_fk" FOREIGN KEY ("sponsor_id") REFERENCES "public"."sponsor_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_ratings" ADD CONSTRAINT "business_ratings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "business_rating_once" ON "business_ratings" USING btree ("sponsor_id","account_id");--> statement-breakpoint
CREATE INDEX "business_rating_recent" ON "business_ratings" USING btree ("sponsor_id","created_at");--> statement-breakpoint
-- Whether a person was really served by a business: a purchase it
-- confirmed (not voided, or a void reversed), a prize claimed, or a job
-- paid.
CREATE FUNCTION business_served(sponsor uuid, customer uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM purchase_confirmations p JOIN sponsor_tasks t ON t.id = p.task_id
      WHERE t.sponsor_id = sponsor AND p.account_id = customer
        AND (NOT EXISTS (SELECT 1 FROM purchase_voids v WHERE v.confirmation_id = p.id)
          OR EXISTS (SELECT 1 FROM purchase_void_rulings r WHERE r.confirmation_id = p.id AND r.decision = 'reversed')))
    OR EXISTS (SELECT 1 FROM claim_redemptions r JOIN sponsor_tasks t ON t.id = r.task_id
      WHERE t.sponsor_id = sponsor AND r.account_id = customer)
    OR EXISTS (SELECT 1 FROM task_claims c JOIN sponsor_tasks t ON t.id = c.task_id
      JOIN funding_transfers f ON f.kind = 'task_reward' AND f.reference = 'claim:' || c.id::text
      WHERE t.sponsor_id = sponsor AND c.account_id = customer)
$$;
--> statement-breakpoint
CREATE FUNCTION business_rating_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE profile sponsor_profiles%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Ratings cannot be deleted' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO profile FROM sponsor_profiles WHERE id = NEW.sponsor_id;
  IF TG_OP = 'INSERT' THEN
    IF profile.id IS NULL OR NEW.account_id = profile.owner_id
      OR EXISTS (SELECT 1 FROM business_staff s WHERE s.sponsor_id = profile.id AND s.account_id = NEW.account_id)
      OR NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND access_state = 'active')
      OR NOT EXISTS (SELECT 1 FROM verified_phones WHERE account_id = NEW.account_id)
      OR NOT business_served(NEW.sponsor_id, NEW.account_id) THEN
      RAISE EXCEPTION 'Rating unavailable' USING ERRCODE = '23514';
    END IF;
    NEW.business_name := profile.name;
    NEW.created_at := clock_timestamp();
    NEW.edited_at := NULL;
    RETURN NEW;
  END IF;
  -- Edits: only stars and comment, by the same person, within 48 hours,
  -- and not once a reviewer removed it.
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.sponsor_id IS DISTINCT FROM OLD.sponsor_id
    OR NEW.account_id IS DISTINCT FROM OLD.account_id
    OR NEW.business_name IS DISTINCT FROM OLD.business_name
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR clock_timestamp() > OLD.created_at + interval '48 hours'
    OR EXISTS (SELECT 1 FROM business_rating_removals r WHERE r.rating_id = OLD.id) THEN
    RAISE EXCEPTION 'Rating locked' USING ERRCODE = '23514';
  END IF;
  NEW.edited_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER business_rating_guard BEFORE INSERT OR UPDATE OR DELETE ON business_ratings
  FOR EACH ROW EXECUTE FUNCTION business_rating_guard();
--> statement-breakpoint
CREATE FUNCTION business_rating_reply_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM business_ratings r JOIN sponsor_profiles sp ON sp.id = r.sponsor_id
      WHERE r.id = NEW.rating_id AND sp.owner_id = NEW.actor_id)
    OR length(btrim(NEW.body)) = 0 THEN
    RAISE EXCEPTION 'Reply unavailable' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER business_rating_reply_guard BEFORE INSERT ON business_rating_replies
  FOR EACH ROW EXECUTE FUNCTION business_rating_reply_guard();
--> statement-breakpoint
CREATE FUNCTION business_rating_removal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT staff_reviewer_active(NEW.reviewer_id) OR length(btrim(NEW.reason)) < 3
    OR NEW.reviewer_id = (SELECT sp.owner_id FROM business_ratings r JOIN sponsor_profiles sp
      ON sp.id = r.sponsor_id WHERE r.id = NEW.rating_id) THEN
    RAISE EXCEPTION 'Removal unavailable' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER business_rating_removal_guard BEFORE INSERT ON business_rating_removals
  FOR EACH ROW EXECUTE FUNCTION business_rating_removal_guard();
--> statement-breakpoint
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['business_rating_replies', 'business_rating_removals'] LOOP
    EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION funding_reject_mutation()', name);
    EXECUTE format('CREATE TRIGGER no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION funding_reject_mutation()', name);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE TRIGGER no_truncate BEFORE TRUNCATE ON business_ratings
  FOR EACH STATEMENT EXECUTE FUNCTION funding_reject_mutation();
