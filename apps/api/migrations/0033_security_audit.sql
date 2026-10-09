CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"actor" text,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_event_kind" CHECK ("audit_events"."kind" in ('sign_in', 'money_password_failed', 'sessions_revoked', 'session_revoked', 'admin_account_viewed', 'admin_payments_viewed', 'admin_disputes_viewed'))
);
--> statement-breakpoint
CREATE INDEX "audit_subject_recent" ON "audit_events" USING btree ("subject","kind","created_at");
--> statement-breakpoint
CREATE FUNCTION audit_event_stamp() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_event_stamp BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION audit_event_stamp();
--> statement-breakpoint
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION funding_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER no_truncate BEFORE TRUNCATE ON audit_events FOR EACH STATEMENT EXECUTE FUNCTION funding_reject_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION purchase_invite_valid(t sponsor_tasks, shopper uuid, inviter uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT inviter IS NOT NULL AND inviter <> shopper
    -- Staff cannot invite to the business they work for (they confirm sales).
    AND NOT business_staff_active(t.sponsor_id, inviter)
    AND EXISTS (SELECT 1 FROM accounts WHERE id = inviter AND access_state = 'active')
    AND EXISTS (SELECT 1 FROM purchase_confirmations p JOIN sponsor_tasks st ON st.id = p.task_id
      WHERE st.sponsor_id = t.sponsor_id AND p.account_id = inviter
        AND (NOT EXISTS (SELECT 1 FROM purchase_voids v WHERE v.confirmation_id = p.id)
          OR EXISTS (SELECT 1 FROM purchase_void_rulings r WHERE r.confirmation_id = p.id AND r.decision = 'reversed')))
    AND NOT EXISTS (SELECT 1 FROM purchase_confirmations p JOIN sponsor_tasks st ON st.id = p.task_id
      WHERE st.sponsor_id = t.sponsor_id AND p.account_id = shopper)
    AND (SELECT count(*) FROM purchase_confirmations p WHERE p.task_id = t.id AND p.referrer_id = inviter
      AND purchase_holds_place(p.id)) < 10
$$;
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
  NEW.referrer_id := c.referrer_id;
  IF (t.campaign_terms ? 'referral') <> (c.referrer_id IS NOT NULL)
    OR (t.campaign_terms ? 'referral' AND NOT purchase_invite_valid(t, NEW.account_id, c.referrer_id))
    -- Nobody confirms a purchase by a friend they invited.
    OR NEW.actor_id IS NOT DISTINCT FROM c.referrer_id THEN
    RAISE EXCEPTION 'Invite unavailable' USING ERRCODE = '23514';
  END IF;
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
