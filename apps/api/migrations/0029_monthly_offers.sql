DROP INDEX "purchase_once_per_campaign";--> statement-breakpoint
ALTER TABLE "purchase_confirmations" ADD COLUMN "period" varchar(7) DEFAULT 'once' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_once_per_period" ON "purchase_confirmations" USING btree ("task_id","account_id","period");--> statement-breakpoint
ALTER TABLE "purchase_confirmations" ADD CONSTRAINT "purchase_period_format" CHECK ("purchase_confirmations"."period" = 'once' or "purchase_confirmations"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');--> statement-breakpoint
ALTER TABLE "sponsor_tasks" ADD CONSTRAINT "sponsor_task_campaign_repeat" CHECK ("sponsor_tasks"."campaign_terms" is null or not ("sponsor_tasks"."campaign_terms" ? 'repeat') or "sponsor_tasks"."campaign_terms"->>'repeat' = 'monthly');--> statement-breakpoint
-- The reward period a purchase falls in: 'once' for a one-off offer, the Lagos
-- calendar month for a monthly offer.
CREATE FUNCTION purchase_period(t sponsor_tasks) RETURNS varchar LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN t.campaign_terms->>'repeat' = 'monthly'
    THEN to_char(clock_timestamp() AT TIME ZONE 'Africa/Lagos', 'YYYY-MM')
    ELSE 'once' END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION purchase_code_issue() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t sponsor_tasks%ROWTYPE;
BEGIN
  SELECT * INTO t FROM sponsor_tasks WHERE id = NEW.task_id FOR SHARE;
  IF NOT purchase_campaign_live(t, NEW.account_id)
    OR EXISTS (SELECT 1 FROM purchase_confirmations WHERE task_id = NEW.task_id AND account_id = NEW.account_id
      AND period = purchase_period(t)) THEN
    RAISE EXCEPTION 'Offer unavailable' USING ERRCODE = '23514';
  END IF;
  IF (SELECT count(*) FROM purchase_codes WHERE task_id = NEW.task_id AND account_id = NEW.account_id
      AND created_at > clock_timestamp() - interval '1 hour') >= 10 THEN
    RAISE EXCEPTION 'Too many purchase codes requested' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  NEW.expires_at := NEW.created_at + interval '15 minutes';
  RETURN NEW;
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
  NEW.period := purchase_period(t);
  IF EXISTS (SELECT 1 FROM purchase_confirmations WHERE task_id = t.id AND account_id = NEW.account_id
      AND period = NEW.period) THEN
    RAISE EXCEPTION 'Cash back already given for this period' USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO used FROM purchase_confirmations p WHERE p.task_id = t.id
    AND purchase_holds_place(p.id);
  IF used >= t.capacity THEN RAISE EXCEPTION 'Campaign is full' USING ERRCODE = '23514'; END IF;
  -- A staff member confirms at most 100 purchases a day; the owner is not capped.
  IF owner IS DISTINCT FROM NEW.actor_id AND (SELECT count(*) FROM purchase_confirmations
      WHERE actor_id = NEW.actor_id AND task_id = t.id
        AND created_at > clock_timestamp() - interval '24 hours') >= 100 THEN
    RAISE EXCEPTION 'Staff daily confirmation limit reached' USING ERRCODE = '23514';
  END IF;
  IF (SELECT count(*) FROM purchase_confirmations WHERE account_id = NEW.account_id
      AND created_at > clock_timestamp() - interval '24 hours') >= 5 THEN
    RAISE EXCEPTION 'Shopper daily purchase limit reached' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  NEW.release_at := NEW.created_at + (t.campaign_terms->>'holdHours')::integer * interval '1 hour';
  RETURN NEW;
END $$;
