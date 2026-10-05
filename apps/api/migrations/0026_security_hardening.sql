CREATE TABLE "business_staff_acceptances" (
	"staff_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_first_approvals" (
	"task_id" uuid NOT NULL,
	"terms_version" integer NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"reason" varchar(1000) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_first_approvals_task_id_terms_version_pk" PRIMARY KEY("task_id","terms_version")
);
--> statement-breakpoint
CREATE TABLE "withdrawal_locks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"reason" varchar(300) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "withdrawal_unlocks" (
	"lock_id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "withdrawals" DROP CONSTRAINT "withdrawal_amount";--> statement-breakpoint
ALTER TABLE "business_staff_acceptances" ADD CONSTRAINT "business_staff_acceptances_staff_id_business_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."business_staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_first_approvals" ADD CONSTRAINT "campaign_first_approvals_task_id_sponsor_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."sponsor_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_first_approvals" ADD CONSTRAINT "campaign_first_approvals_reviewer_id_accounts_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_locks" ADD CONSTRAINT "withdrawal_locks_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_unlocks" ADD CONSTRAINT "withdrawal_unlocks_lock_id_withdrawal_locks_id_fk" FOREIGN KEY ("lock_id") REFERENCES "public"."withdrawal_locks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_unlocks" ADD CONSTRAINT "withdrawal_unlocks_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "withdrawal_lock_account" ON "withdrawal_locks" USING btree ("account_id");--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawal_amount" CHECK ("withdrawals"."amount_kobo" between 100000 and 500000000) NOT VALID;
-- NOT VALID: older small withdrawals stay; every new one must be at least ₦1,000.
--> statement-breakpoint
CREATE OR REPLACE FUNCTION business_staff_active(sponsor uuid, account uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM business_staff s WHERE s.sponsor_id = sponsor AND s.account_id = account
    AND EXISTS (SELECT 1 FROM business_staff_acceptances a WHERE a.staff_id = s.id)
    AND NOT EXISTS (SELECT 1 FROM business_staff_removals r WHERE r.staff_id = s.id))
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
  SELECT count(*) INTO used FROM purchase_confirmations p WHERE p.task_id = t.id
    AND NOT EXISTS (SELECT 1 FROM purchase_voids v WHERE v.confirmation_id = p.id);
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
--> statement-breakpoint
CREATE OR REPLACE FUNCTION withdrawal_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Serialize one account's withdrawals; the ledger checks the balance.
  PERFORM pg_advisory_xact_lock(hashtextextended('withdrawal:' || NEW.account_id::text, 0));
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND access_state = 'active')
    OR NOT EXISTS (SELECT 1 FROM verified_phones WHERE account_id = NEW.account_id) THEN
    RAISE EXCEPTION 'Withdrawal unavailable' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM withdrawal_locks l WHERE l.account_id = NEW.account_id
      AND NOT EXISTS (SELECT 1 FROM withdrawal_unlocks u WHERE u.lock_id = l.id)) THEN
    RAISE EXCEPTION 'Withdrawals are locked' USING ERRCODE = '23514';
  END IF;
  -- Money goes only to the person's current bank account. A changed account
  -- waits 24 hours: the usual path for emptying a taken-over account.
  IF NEW.destination_id IS NULL OR NEW.destination_id IS DISTINCT FROM (
      SELECT id FROM payout_destinations WHERE account_id = NEW.account_id
      ORDER BY created_at DESC, id DESC LIMIT 1) THEN
    RAISE EXCEPTION 'Withdrawal unavailable' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM payout_destinations d WHERE d.account_id = NEW.account_id
      AND d.id <> NEW.destination_id)
    AND (SELECT created_at FROM payout_destinations WHERE id = NEW.destination_id)
      > clock_timestamp() - interval '24 hours' THEN
    RAISE EXCEPTION 'New bank account is not usable yet' USING ERRCODE = '23514';
  END IF;
  IF (SELECT count(*) FROM withdrawals WHERE account_id = NEW.account_id
      AND created_at > clock_timestamp() - interval '24 hours') >= 3 THEN
    RAISE EXCEPTION 'Daily withdrawal limit reached' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION account_access_change() RETURNS trigger LANGUAGE plpgsql AS $$
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
  -- Lifting a freeze needs a different reviewer from the one who froze it.
  IF NEW.to_state = 'active' AND NEW.actor_id = (SELECT actor_id FROM account_access_changes
      WHERE account_id = NEW.account_id AND to_state = 'suspended'
      ORDER BY created_at DESC LIMIT 1) THEN
    RAISE EXCEPTION 'Access change unavailable' USING ERRCODE = '23514';
  END IF;
  NEW.from_state := current;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION apply_task_review() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  task sponsor_tasks%ROWTYPE;
  permission task_reviewer_grants%ROWTYPE;
  sponsor_owner uuid;
  backing numeric;
BEGIN
  PERFORM id FROM accounts WHERE id = NEW.reviewer_id AND access_state = 'active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reviewer is not active' USING ERRCODE = '23514'; END IF;
  SELECT * INTO permission FROM task_reviewer_grants WHERE id = NEW.grant_id FOR SHARE;
  IF permission.id IS NULL OR permission.reviewer_id <> NEW.reviewer_id OR permission.revoked_at IS NOT NULL
    OR permission.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'Task review permission required' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO task FROM sponsor_tasks WHERE id = NEW.task_id FOR UPDATE;
  IF task.id IS NULL OR task.terms_version <> NEW.terms_version OR task.request_hash <> NEW.terms_hash
    OR task.review_state <> 'pending_review' OR task.lifecycle <> 'not_live' THEN
    RAISE EXCEPTION 'Task review is stale' USING ERRCODE = '23514';
  END IF;
  SELECT owner_id INTO sponsor_owner FROM sponsor_profiles WHERE id = task.sponsor_id;
  IF sponsor_owner = NEW.reviewer_id THEN
    RAISE EXCEPTION 'Self-review is forbidden' USING ERRCODE = '23514';
  END IF;
  -- Campaigns of ₦1,000,000 or more need a first approval by another reviewer.
  IF NEW.decision = 'approved' AND task.budget_kobo >= 100000000 AND NOT EXISTS (
      SELECT 1 FROM campaign_first_approvals f WHERE f.task_id = task.id
        AND f.terms_version = NEW.terms_version AND f.reviewer_id <> NEW.reviewer_id) THEN
    RAISE EXCEPTION 'A second reviewer must approve' USING ERRCODE = '23514';
  END IF;
  IF NEW.decision = 'approved' THEN
    PERFORM id FROM funding_accounts WHERE id = task.allocation_account_id FOR UPDATE;
    SELECT coalesce(sum(CASE WHEN destination_id = task.allocation_account_id THEN amount_kobo ELSE -amount_kobo END), 0)
      INTO backing FROM funding_transfers WHERE source_id = task.allocation_account_id OR destination_id = task.allocation_account_id;
    IF backing <> task.budget_kobo THEN
      RAISE EXCEPTION 'Task backing does not match approved budget' USING ERRCODE = '23514';
    END IF;
  END IF;
  UPDATE sponsor_tasks SET review_state = NEW.decision WHERE id = task.id;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION staff_acceptance_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM business_staff_removals WHERE staff_id = NEW.staff_id) THEN
    RAISE EXCEPTION 'Staff member cannot be added' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER staff_acceptance_guard BEFORE INSERT ON business_staff_acceptances FOR EACH ROW EXECUTE FUNCTION staff_acceptance_guard();
--> statement-breakpoint
CREATE FUNCTION withdrawal_lock_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'withdrawal_locks' THEN
    IF length(btrim(NEW.reason)) NOT BETWEEN 3 AND 300 THEN
      RAISE EXCEPTION 'Lock needs a reason' USING ERRCODE = '23514';
    END IF;
  ELSIF NOT staff_reviewer_active(NEW.actor_id)
    OR NEW.actor_id = (SELECT account_id FROM withdrawal_locks WHERE id = NEW.lock_id) THEN
    -- Only a reviewer, never the account itself, lifts a lock.
    RAISE EXCEPTION 'Unlock unavailable' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER withdrawal_lock_guard BEFORE INSERT ON withdrawal_locks FOR EACH ROW EXECUTE FUNCTION withdrawal_lock_guard();
--> statement-breakpoint
CREATE TRIGGER withdrawal_lock_guard BEFORE INSERT ON withdrawal_unlocks FOR EACH ROW EXECUTE FUNCTION withdrawal_lock_guard();
--> statement-breakpoint
CREATE FUNCTION campaign_first_approval_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE task sponsor_tasks%ROWTYPE;
BEGIN
  SELECT * INTO task FROM sponsor_tasks WHERE id = NEW.task_id FOR UPDATE;
  IF task.id IS NULL OR task.review_state <> 'pending_review' OR task.terms_version <> NEW.terms_version
    OR NOT staff_reviewer_active(NEW.reviewer_id)
    OR NEW.reviewer_id = (SELECT owner_id FROM sponsor_profiles WHERE id = task.sponsor_id)
    OR length(btrim(NEW.reason)) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Task review is stale' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER campaign_first_approval_guard BEFORE INSERT ON campaign_first_approvals FOR EACH ROW EXECUTE FUNCTION campaign_first_approval_guard();
--> statement-breakpoint
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['business_staff_acceptances','campaign_first_approvals','withdrawal_locks','withdrawal_unlocks'] LOOP
    EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION funding_reject_mutation()', name);
    EXECUTE format('CREATE TRIGGER no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION funding_reject_mutation()', name);
  END LOOP;
END $$;
--> statement-breakpoint
-- A pending invitation also blocks a second one for the same person.
CREATE OR REPLACE FUNCTION business_staff_add() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('business-staff:' || NEW.sponsor_id::text, 0));
  SELECT owner_id INTO owner FROM sponsor_profiles WHERE id = NEW.sponsor_id;
  IF owner IS DISTINCT FROM NEW.added_by OR owner = NEW.account_id
    OR NOT EXISTS (SELECT 1 FROM accounts WHERE id = owner AND access_state = 'active')
    OR NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND access_state = 'active')
    OR EXISTS (SELECT 1 FROM business_staff s WHERE s.sponsor_id = NEW.sponsor_id AND s.account_id = NEW.account_id
      AND NOT EXISTS (SELECT 1 FROM business_staff_removals r WHERE r.staff_id = s.id))
    OR (SELECT count(*) FROM business_staff s WHERE s.sponsor_id = NEW.sponsor_id
      AND NOT EXISTS (SELECT 1 FROM business_staff_removals r WHERE r.staff_id = s.id)) >= 20 THEN
    RAISE EXCEPTION 'Staff member cannot be added' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
