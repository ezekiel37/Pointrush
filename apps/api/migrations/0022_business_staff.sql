CREATE TABLE "business_staff" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sponsor_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"added_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_staff_removals" (
	"staff_id" uuid PRIMARY KEY NOT NULL,
	"removed_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business_staff" ADD CONSTRAINT "business_staff_sponsor_id_sponsor_profiles_id_fk" FOREIGN KEY ("sponsor_id") REFERENCES "public"."sponsor_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_staff" ADD CONSTRAINT "business_staff_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_staff" ADD CONSTRAINT "business_staff_added_by_accounts_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_staff_removals" ADD CONSTRAINT "business_staff_removals_staff_id_business_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."business_staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_staff_removals" ADD CONSTRAINT "business_staff_removals_removed_by_accounts_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "business_staff_sponsor" ON "business_staff" USING btree ("sponsor_id");--> statement-breakpoint
CREATE INDEX "business_staff_account" ON "business_staff" USING btree ("account_id");
--> statement-breakpoint
CREATE FUNCTION business_staff_active(sponsor uuid, account uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM business_staff s WHERE s.sponsor_id = sponsor AND s.account_id = account
    AND NOT EXISTS (SELECT 1 FROM business_staff_removals r WHERE r.staff_id = s.id))
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION purchase_campaign_live(t sponsor_tasks, shopper uuid) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE owner uuid;
BEGIN
  SELECT owner_id INTO owner FROM sponsor_profiles WHERE id = t.sponsor_id;
  RETURN t.id IS NOT NULL AND t.model = 'purchase_cashback' AND t.lifecycle = 'published'
    AND t.review_state = 'approved' AND clock_timestamp() >= t.starts_at AND clock_timestamp() < t.ends_at
    AND owner IS DISTINCT FROM shopper
    -- Staff cannot earn cash back at the business they work for.
    AND NOT business_staff_active(t.sponsor_id, shopper)
    AND EXISTS (SELECT 1 FROM accounts WHERE id = owner AND access_state = 'active')
    AND EXISTS (SELECT 1 FROM accounts WHERE id = shopper AND access_state = 'active');
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION purchase_confirm() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c purchase_codes%ROWTYPE; t sponsor_tasks%ROWTYPE; owner uuid; used bigint;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'READ COMMITTED required' USING ERRCODE='23514'; END IF;
  SELECT * INTO c FROM purchase_codes WHERE id = NEW.code_id;
  -- Capacity is serialized per campaign; the daily limit per shopper across campaigns.
  SELECT * INTO t FROM sponsor_tasks WHERE id = c.task_id FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtextextended('purchase-shopper:' || c.account_id::text, 0));
  SELECT owner_id INTO owner FROM sponsor_profiles WHERE id = t.sponsor_id;
  IF c.id IS NULL OR c.task_id <> NEW.task_id OR c.account_id <> NEW.account_id
    OR c.expires_at <= clock_timestamp()
    -- The owner, or active staff with an active account, confirm at the till.
    OR (owner IS DISTINCT FROM NEW.actor_id AND NOT (business_staff_active(t.sponsor_id, NEW.actor_id)
      AND EXISTS (SELECT 1 FROM accounts WHERE id = NEW.actor_id AND access_state = 'active')))
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
CREATE OR REPLACE FUNCTION claim_redeem() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c claim_codes%ROWTYPE; t sponsor_tasks%ROWTYPE; owner uuid;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'READ COMMITTED required' USING ERRCODE='23514'; END IF;
  SELECT * INTO c FROM claim_codes WHERE id = NEW.code_id;
  -- Serializes the per-person limit for this promotion.
  SELECT * INTO t FROM sponsor_tasks WHERE id = c.task_id FOR UPDATE;
  SELECT owner_id INTO owner FROM sponsor_profiles WHERE id = t.sponsor_id;
  IF c.id IS NULL OR NEW.task_id <> c.task_id OR t.model <> 'claim_code'
    OR t.lifecycle <> 'published' OR t.review_state <> 'approved'
    OR clock_timestamp() < t.starts_at OR clock_timestamp() >= t.ends_at
    OR NOT EXISTS (SELECT 1 FROM claim_batch_activations WHERE batch_id = c.batch_id)
    OR EXISTS (SELECT 1 FROM claim_batch_revocations WHERE batch_id = c.batch_id)
    OR owner IS NOT DISTINCT FROM NEW.account_id
    OR business_staff_active(t.sponsor_id, NEW.account_id)
    OR NOT EXISTS (SELECT 1 FROM accounts WHERE id = owner AND access_state = 'active')
    OR NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND access_state = 'active')
    OR NOT EXISTS (SELECT 1 FROM verified_phones WHERE account_id = NEW.account_id) THEN
    RAISE EXCEPTION 'Code cannot be claimed' USING ERRCODE = '23514';
  END IF;
  IF (SELECT count(*) FROM claim_redemptions WHERE task_id = t.id AND account_id = NEW.account_id)
      >= (t.promotion_terms->>'claimLimitPerPerson')::integer THEN
    RAISE EXCEPTION 'Claim limit reached for this promotion' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION business_staff_add() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('business-staff:' || NEW.sponsor_id::text, 0));
  SELECT owner_id INTO owner FROM sponsor_profiles WHERE id = NEW.sponsor_id;
  IF owner IS DISTINCT FROM NEW.added_by OR owner = NEW.account_id
    OR NOT EXISTS (SELECT 1 FROM accounts WHERE id = owner AND access_state = 'active')
    OR NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND access_state = 'active')
    OR business_staff_active(NEW.sponsor_id, NEW.account_id)
    OR (SELECT count(*) FROM business_staff s WHERE s.sponsor_id = NEW.sponsor_id
      AND NOT EXISTS (SELECT 1 FROM business_staff_removals r WHERE r.staff_id = s.id)) >= 20 THEN
    RAISE EXCEPTION 'Staff member cannot be added' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER business_staff_add BEFORE INSERT ON business_staff FOR EACH ROW EXECUTE FUNCTION business_staff_add();
--> statement-breakpoint
CREATE FUNCTION business_staff_remove() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM business_staff s JOIN sponsor_profiles sp ON sp.id = s.sponsor_id
      WHERE s.id = NEW.staff_id AND sp.owner_id = NEW.removed_by) THEN
    RAISE EXCEPTION 'Staff member cannot be removed' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER business_staff_remove BEFORE INSERT ON business_staff_removals FOR EACH ROW EXECUTE FUNCTION business_staff_remove();
--> statement-breakpoint
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['business_staff','business_staff_removals'] LOOP
    EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION funding_reject_mutation()', name);
    EXECUTE format('CREATE TRIGGER no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION funding_reject_mutation()', name);
  END LOOP;
END $$;
