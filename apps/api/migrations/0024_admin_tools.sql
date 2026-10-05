CREATE TABLE "account_access_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"from_state" varchar(20) DEFAULT '' NOT NULL,
	"to_state" varchar(20) NOT NULL,
	"reason" varchar(500) NOT NULL,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_event_reviews" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"note" varchar(1000) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_access_changes" ADD CONSTRAINT "account_access_changes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_access_changes" ADD CONSTRAINT "account_access_changes_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_event_reviews" ADD CONSTRAINT "payment_event_reviews_event_id_payment_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."payment_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_event_reviews" ADD CONSTRAINT "payment_event_reviews_reviewer_id_accounts_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_access_change_account" ON "account_access_changes" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE FUNCTION staff_reviewer_active(account uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM task_reviewer_grants g JOIN accounts a ON a.id = g.reviewer_id
    WHERE g.reviewer_id = account AND a.access_state = 'active'
      AND g.revoked_at IS NULL AND g.expires_at > clock_timestamp())
$$;
--> statement-breakpoint
CREATE FUNCTION account_access_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current text;
BEGIN
  SELECT access_state INTO current FROM accounts WHERE id = NEW.account_id FOR UPDATE;
  -- Reviewers freeze or restore others' accounts, never their own, never closed ones.
  IF current IS NULL OR current = 'closed' OR NEW.account_id = NEW.actor_id
    OR NOT staff_reviewer_active(NEW.actor_id)
    OR NEW.to_state NOT IN ('active', 'suspended') OR NEW.to_state = current
    OR length(btrim(NEW.reason)) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'Access change unavailable' USING ERRCODE = '23514';
  END IF;
  NEW.from_state := current;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER account_access_change BEFORE INSERT ON account_access_changes FOR EACH ROW EXECUTE FUNCTION account_access_change();
--> statement-breakpoint
CREATE FUNCTION account_access_apply() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE accounts SET access_state = NEW.to_state WHERE id = NEW.account_id;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER account_access_apply AFTER INSERT ON account_access_changes FOR EACH ROW EXECUTE FUNCTION account_access_apply();
--> statement-breakpoint
CREATE FUNCTION payment_event_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT staff_reviewer_active(NEW.reviewer_id)
    OR NOT EXISTS (SELECT 1 FROM payment_events WHERE id = NEW.event_id
      AND outcome IN ('mismatch', 'unknown_reference'))
    OR EXISTS (SELECT 1 FROM payment_event_reviews WHERE event_id = NEW.event_id)
    OR length(btrim(NEW.note)) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'Payment review unavailable' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER payment_event_review BEFORE INSERT ON payment_event_reviews FOR EACH ROW EXECUTE FUNCTION payment_event_review();
--> statement-breakpoint
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['account_access_changes','payment_event_reviews'] LOOP
    EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION funding_reject_mutation()', name);
    EXECUTE format('CREATE TRIGGER no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION funding_reject_mutation()', name);
  END LOOP;
END $$;
