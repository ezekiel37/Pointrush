CREATE TABLE "phone_challenge_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challenge_id" uuid NOT NULL,
	"success" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "phone_challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"phone_number" varchar(16) NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "phone_challenge_e164" CHECK ("phone_challenges"."phone_number" collate "C" ~ '^[+][1-9][0-9]{6,14}$'),
	CONSTRAINT "phone_challenge_hash" CHECK ("phone_challenges"."code_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "phone_challenge_attempts" ADD CONSTRAINT "phone_challenge_attempts_challenge_id_phone_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."phone_challenges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_challenges" ADD CONSTRAINT "phone_challenges_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "phone_attempt_challenge" ON "phone_challenge_attempts" USING btree ("challenge_id");--> statement-breakpoint
CREATE INDEX "phone_challenge_account" ON "phone_challenges" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "phone_challenge_number" ON "phone_challenges" USING btree ("phone_number","created_at");--> statement-breakpoint
CREATE INDEX "phone_challenge_day" ON "phone_challenges" USING btree ("created_at");--> statement-breakpoint
CREATE FUNCTION phone_challenge_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- One account and one number at a time, so limits cannot be raced.
  PERFORM pg_advisory_xact_lock(hashtextextended('phone-account:' || NEW.account_id::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('phone-number:' || NEW.phone_number, 0));
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND access_state = 'active')
    OR EXISTS (SELECT 1 FROM verified_phones WHERE account_id = NEW.account_id)
    OR EXISTS (SELECT 1 FROM verified_phones WHERE phone_number = NEW.phone_number) THEN
    RAISE EXCEPTION 'Phone unavailable' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM phone_challenges WHERE account_id = NEW.account_id
      AND created_at > clock_timestamp() - interval '60 seconds') THEN
    RAISE EXCEPTION 'Phone code cooldown' USING ERRCODE = '23514';
  END IF;
  IF (SELECT count(*) FROM phone_challenges WHERE account_id = NEW.account_id
      AND created_at > clock_timestamp() - interval '24 hours') >= 5
    OR (SELECT count(*) FROM phone_challenges WHERE phone_number = NEW.phone_number
      AND created_at > clock_timestamp() - interval '24 hours') >= 5 THEN
    RAISE EXCEPTION 'Phone code limit' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  NEW.expires_at := NEW.created_at + interval '10 minutes';
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER phone_challenge_request BEFORE INSERT ON phone_challenges FOR EACH ROW EXECUTE FUNCTION phone_challenge_request();
--> statement-breakpoint
CREATE FUNCTION phone_challenge_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c phone_challenges%ROWTYPE;
BEGIN
  SELECT * INTO c FROM phone_challenges WHERE id = NEW.challenge_id FOR UPDATE;
  -- Only the latest, unexpired, unused code with guesses left can be tried.
  IF c.expires_at <= clock_timestamp()
    OR EXISTS (SELECT 1 FROM phone_challenges WHERE account_id = c.account_id AND created_at > c.created_at)
    OR EXISTS (SELECT 1 FROM phone_challenge_attempts WHERE challenge_id = c.id AND success)
    OR (SELECT count(*) FROM phone_challenge_attempts WHERE challenge_id = c.id) >= 5 THEN
    RAISE EXCEPTION 'Phone code expired' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER phone_challenge_attempt BEFORE INSERT ON phone_challenge_attempts FOR EACH ROW EXECUTE FUNCTION phone_challenge_attempt();
--> statement-breakpoint
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['phone_challenges','phone_challenge_attempts'] LOOP
    EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION funding_reject_mutation()', name);
    EXECUTE format('CREATE TRIGGER no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION funding_reject_mutation()', name);
  END LOOP;
END $$;
