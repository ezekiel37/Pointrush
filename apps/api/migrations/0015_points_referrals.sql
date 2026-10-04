CREATE TABLE "points_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reference" varchar(200) NOT NULL,
	"business_id" uuid,
	"points" bigint NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "points_entry_kind" CHECK ("points_entries"."kind" in ('purchase', 'job', 'referral_referrer', 'referral_referee')),
	CONSTRAINT "points_entry_positive" CHECK ("points_entries"."points" > 0)
);
--> statement-breakpoint
CREATE TABLE "points_pools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"points" bigint NOT NULL,
	"actor_id" uuid NOT NULL,
	"reason" varchar(500) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "points_pool_positive" CHECK ("points_pools"."points" > 0)
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"referee_id" uuid PRIMARY KEY NOT NULL,
	"referrer_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_not_self" CHECK ("referrals"."referee_id" <> "referrals"."referrer_id")
);
--> statement-breakpoint
ALTER TABLE "points_entries" ADD CONSTRAINT "points_entries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_entries" ADD CONSTRAINT "points_entries_business_id_sponsor_profiles_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."sponsor_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_pools" ADD CONSTRAINT "points_pools_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referee_id_accounts_id_fk" FOREIGN KEY ("referee_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_id_accounts_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "points_entry_reference" ON "points_entries" USING btree ("kind","reference");--> statement-breakpoint
CREATE UNIQUE INDEX "points_once_per_business" ON "points_entries" USING btree ("account_id","kind","business_id") WHERE "points_entries"."kind" in ('purchase', 'job');--> statement-breakpoint
CREATE INDEX "points_entry_account" ON "points_entries" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "referral_referrer" ON "referrals" USING btree ("referrer_id","created_at");--> statement-breakpoint
-- Settled activity: a released purchase or a paid job, optionally excluding one business owner.
CREATE FUNCTION points_settled_with(account uuid, excluded_owner uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM purchase_confirmations p
    JOIN purchase_releases r ON r.confirmation_id = p.id
    JOIN sponsor_tasks t ON t.id = p.task_id JOIN sponsor_profiles sp ON sp.id = t.sponsor_id
    WHERE p.account_id = account AND sp.owner_id IS DISTINCT FROM excluded_owner
  ) OR EXISTS (
    SELECT 1 FROM task_claims c
    JOIN funding_transfers f ON f.kind = 'task_reward' AND f.reference = 'claim:' || c.id::text
    JOIN sponsor_tasks t ON t.id = c.task_id JOIN sponsor_profiles sp ON sp.id = t.sponsor_id
    WHERE c.account_id = account AND sp.owner_id IS DISTINCT FROM excluded_owner
  )
$$;
--> statement-breakpoint
-- A referee qualifies with a verified phone and settled activity at a business the referrer does not own.
CREATE FUNCTION points_referral_qualified(referee uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM referrals r
    WHERE r.referee_id = referee
      AND EXISTS (SELECT 1 FROM verified_phones WHERE account_id = referee)
      AND points_settled_with(referee, r.referrer_id)
  )
$$;
--> statement-breakpoint
CREATE FUNCTION points_entry_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ref uuid; business uuid; amount bigint; expected bigint; r referrals%ROWTYPE; room bigint;
BEGIN
  -- All issuance is serialized so the pool and per-referrer caps cannot be raced.
  PERFORM pg_advisory_xact_lock(hashtextextended('points-pool', 0));
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND access_state = 'active')
    OR NOT EXISTS (SELECT 1 FROM verified_phones WHERE account_id = NEW.account_id)
    OR NEW.reference !~ '^(purchase|claim|referral):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Points are not available for this activity' USING ERRCODE = '23514';
  END IF;
  ref := split_part(NEW.reference, ':', 2)::uuid;
  IF NEW.kind = 'purchase' THEN
    SELECT sp.id, t.reward_kobo INTO business, amount FROM purchase_confirmations p
      JOIN purchase_releases rl ON rl.confirmation_id = p.id
      JOIN sponsor_tasks t ON t.id = p.task_id JOIN sponsor_profiles sp ON sp.id = t.sponsor_id
      WHERE p.id = ref AND p.account_id = NEW.account_id AND NEW.reference = 'purchase:' || p.id::text;
    -- Worth at most a fifth of the cash back (1 point = 10 kobo), capped.
    expected := least(50, amount / 50);
  ELSIF NEW.kind = 'job' THEN
    SELECT sp.id, f.amount_kobo INTO business, amount FROM task_claims c
      JOIN funding_transfers f ON f.kind = 'task_reward' AND f.reference = 'claim:' || c.id::text
      JOIN sponsor_tasks t ON t.id = c.task_id JOIN sponsor_profiles sp ON sp.id = t.sponsor_id
      WHERE c.id = ref AND c.account_id = NEW.account_id AND NEW.reference = 'claim:' || c.id::text;
    expected := least(300, amount / 50);
  ELSIF NEW.kind IN ('referral_referee', 'referral_referrer') AND NEW.reference = 'referral:' || ref::text THEN
    SELECT * INTO r FROM referrals WHERE referee_id = ref;
    IF r.referee_id IS NULL OR NOT points_referral_qualified(ref)
      OR (NEW.kind = 'referral_referee' AND NEW.account_id <> r.referee_id)
      OR (NEW.kind = 'referral_referrer' AND (NEW.account_id <> r.referrer_id
        OR (SELECT count(*) FROM points_entries WHERE account_id = NEW.account_id AND kind = 'referral_referrer'
            AND created_at > clock_timestamp() - interval '30 days') >= 5)) THEN
      RAISE EXCEPTION 'Points are not available for this activity' USING ERRCODE = '23514';
    END IF;
    expected := CASE NEW.kind WHEN 'referral_referee' THEN 200 ELSE 500 END;
  END IF;
  IF expected IS NULL OR expected < 1 OR (NEW.kind IN ('purchase', 'job') AND business IS NULL)
    OR (NEW.points IS NOT NULL AND NEW.points <> expected)
    OR (NEW.business_id IS NOT NULL AND NEW.business_id IS DISTINCT FROM business) THEN
    RAISE EXCEPTION 'Points are not available for this activity' USING ERRCODE = '23514';
  END IF;
  room := coalesce((SELECT sum(points) FROM points_pools), 0) - coalesce((SELECT sum(points) FROM points_entries), 0);
  IF room < expected THEN RAISE EXCEPTION 'Points pool exhausted' USING ERRCODE = '23514'; END IF;
  NEW.points := expected;
  NEW.business_id := business;
  NEW.created_at := clock_timestamp();
  NEW.available_at := NEW.created_at + interval '72 hours';
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER points_entry_guard BEFORE INSERT ON points_entries FOR EACH ROW EXECUTE FUNCTION points_entry_guard();
--> statement-breakpoint
-- Awards never block the settlement that triggered them: ineligible, duplicate or
-- unfunded awards are skipped.
CREATE FUNCTION points_try(account uuid, entry_kind text, entry_reference text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    INSERT INTO points_entries(account_id, kind, reference, points, available_at)
      VALUES (account, entry_kind, entry_reference, NULL, clock_timestamp()) ON CONFLICT DO NOTHING;
  EXCEPTION WHEN check_violation OR unique_violation OR not_null_violation THEN NULL;
  END;
END $$;
--> statement-breakpoint
CREATE FUNCTION points_award_referral(referee uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r referrals%ROWTYPE;
BEGIN
  SELECT * INTO r FROM referrals WHERE referee_id = referee;
  IF r.referee_id IS NULL OR NOT points_referral_qualified(referee) THEN RETURN; END IF;
  PERFORM points_try(referee, 'referral_referee', 'referral:' || referee::text);
  PERFORM points_try(r.referrer_id, 'referral_referrer', 'referral:' || referee::text);
END $$;
--> statement-breakpoint
CREATE FUNCTION points_after_release() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE shopper uuid;
BEGIN
  SELECT account_id INTO shopper FROM purchase_confirmations WHERE id = NEW.confirmation_id;
  PERFORM points_try(shopper, 'purchase', 'purchase:' || NEW.confirmation_id::text);
  PERFORM points_award_referral(shopper);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER points_after_release AFTER INSERT ON purchase_releases FOR EACH ROW EXECUTE FUNCTION points_after_release();
--> statement-breakpoint
CREATE FUNCTION points_after_job_reward() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE worker uuid;
BEGIN
  SELECT owner_id INTO worker FROM funding_accounts WHERE id = NEW.destination_id;
  PERFORM points_try(worker, 'job', NEW.reference);
  PERFORM points_award_referral(worker);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER points_after_job_reward AFTER INSERT ON funding_transfers FOR EACH ROW
  WHEN (NEW.kind = 'task_reward') EXECUTE FUNCTION points_after_job_reward();
--> statement-breakpoint
CREATE FUNCTION points_after_phone() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM points_award_referral(NEW.account_id);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER points_after_phone AFTER INSERT ON verified_phones FOR EACH ROW EXECUTE FUNCTION points_after_phone();
--> statement-breakpoint
CREATE FUNCTION referral_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('referrer:' || NEW.referrer_id::text, 0));
  IF NEW.referee_id = NEW.referrer_id
    OR NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.referee_id AND access_state = 'active'
      AND created_at > clock_timestamp() - interval '7 days')
    OR NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.referrer_id AND access_state = 'active')
    -- Circular referral: the referee already referred the referrer.
    OR EXISTS (SELECT 1 FROM referrals WHERE referee_id = NEW.referrer_id AND referrer_id = NEW.referee_id)
    -- Attribution only for genuinely new activity, from a referrer with real activity.
    OR points_settled_with(NEW.referee_id, NULL)
    OR NOT points_settled_with(NEW.referrer_id, NULL)
    OR (SELECT count(*) FROM referrals WHERE referrer_id = NEW.referrer_id
        AND created_at > clock_timestamp() - interval '30 days') >= 20 THEN
    RAISE EXCEPTION 'Referral unavailable' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER referral_guard BEFORE INSERT ON referrals FOR EACH ROW EXECUTE FUNCTION referral_guard();
--> statement-breakpoint
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['points_pools','points_entries','referrals'] LOOP
    EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION funding_reject_mutation()', name);
    EXECUTE format('CREATE TRIGGER no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION funding_reject_mutation()', name);
  END LOOP;
END $$;
