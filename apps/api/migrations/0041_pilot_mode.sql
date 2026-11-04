CREATE TABLE "withdrawal_approvals" (
	"withdrawal_id" uuid PRIMARY KEY NOT NULL,
	"decision" text NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"reason" varchar(300) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "withdrawal_approval_decision" CHECK ("withdrawal_approvals"."decision" in ('approved', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "withdrawals" ADD COLUMN "needs_approval" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "withdrawal_approvals" ADD CONSTRAINT "withdrawal_approvals_withdrawal_id_withdrawals_id_fk" FOREIGN KEY ("withdrawal_id") REFERENCES "public"."withdrawals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_approvals" ADD CONSTRAINT "withdrawal_approvals_reviewer_id_accounts_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Pilot mode. Phone verification can be turned off in the admin settings
-- (phone.required) while there is no SMS provider. Every rule that needed a
-- verified phone then accepts any active account, and every withdrawal waits
-- for a reviewer's approval instead (withdrawals.manualApproval is forced on).
CREATE FUNCTION phone_required() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce((platform_settings_current() #>> '{phone,required}')::boolean, true)
$$;
--> statement-breakpoint
CREATE FUNCTION phone_ok(account uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT NOT phone_required() OR EXISTS (SELECT 1 FROM verified_phones WHERE account_id = account)
$$;
--> statement-breakpoint
CREATE FUNCTION withdrawal_approval_required() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT NOT phone_required()
    OR coalesce((platform_settings_current() #>> '{withdrawals,manualApproval}')::boolean, false)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION withdrawal_request() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  per_day bigint;
BEGIN
  -- Serialize one account's withdrawals; the ledger checks the balance.
  PERFORM pg_advisory_xact_lock(hashtextextended('withdrawal:' || NEW.account_id::text, 0));
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND access_state = 'active')
    OR NOT phone_ok(NEW.account_id) THEN
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
  IF NEW.amount_kobo < platform_setting(ARRAY['withdrawals', 'minKobo'], 100000)
    OR NEW.amount_kobo > platform_setting(ARRAY['withdrawals', 'maxKobo'], 100000000) THEN
    RAISE EXCEPTION 'Withdrawal amount out of range' USING ERRCODE = '23514';
  END IF;
  IF (SELECT count(*) FROM withdrawals WHERE account_id = NEW.account_id
      AND created_at > clock_timestamp() - interval '24 hours')
      >= platform_setting(ARRAY['withdrawals', 'dailyCount'], 3) THEN
    RAISE EXCEPTION 'Daily withdrawal limit reached' USING ERRCODE = '23514';
  END IF;
  per_day := platform_setting(ARRAY['withdrawals', 'dailyKobo'], 100000000);
  IF (SELECT created_at FROM accounts WHERE id = NEW.account_id)
      > clock_timestamp() - make_interval(days => platform_setting(ARRAY['newAccounts', 'days'], 0)::int) THEN
    per_day := least(per_day, platform_setting(ARRAY['newAccounts', 'dailyWithdrawalKobo'], per_day));
  END IF;
  -- Withdrawals the bank refused (money returned to the wallet) do not count.
  IF (SELECT coalesce(sum(w.amount_kobo), 0) FROM withdrawals w WHERE w.account_id = NEW.account_id
      AND w.created_at > clock_timestamp() - interval '24 hours'
      AND NOT EXISTS (SELECT 1 FROM withdrawal_outcomes o WHERE o.withdrawal_id = w.id AND o.outcome = 'failed'))
      + NEW.amount_kobo > per_day THEN
    RAISE EXCEPTION 'Daily withdrawal limit reached' USING ERRCODE = '23514';
  END IF;
  -- Decided now, from the settings in force: a reviewer must approve it.
  NEW.needs_approval := withdrawal_approval_required();
  NEW.created_at := clock_timestamp();
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
    OR NOT phone_ok(NEW.account_id) THEN
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
CREATE OR REPLACE FUNCTION bill_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- One person's wallet spending is serialized; the ledger checks the balance.
  PERFORM pg_advisory_xact_lock(hashtextextended('withdrawal:' || NEW.account_id::text, 0));
  -- Spending leaves Acticlaim like a withdrawal: an active account with a
  -- verified phone, and never while the person has locked their money.
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND access_state = 'active')
    OR NOT phone_ok(NEW.account_id) THEN
    RAISE EXCEPTION 'Bill payment unavailable' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM withdrawal_locks l WHERE l.account_id = NEW.account_id
      AND NOT EXISTS (SELECT 1 FROM withdrawal_unlocks u WHERE u.lock_id = l.id)) THEN
    RAISE EXCEPTION 'Withdrawals are locked' USING ERRCODE = '23514';
  END IF;
  -- At most 10 purchases and ₦50,000 in any 24 hours.
  IF (SELECT count(*) FROM bill_purchases WHERE account_id = NEW.account_id
      AND created_at > clock_timestamp() - interval '24 hours') >= 10
    OR (SELECT coalesce(sum(amount_kobo), 0) FROM bill_purchases b WHERE b.account_id = NEW.account_id
      AND b.created_at > clock_timestamp() - interval '24 hours'
      AND NOT EXISTS (SELECT 1 FROM bill_outcomes o WHERE o.bill_id = b.id AND o.outcome = 'failed'))
      + NEW.amount_kobo > 5000000 THEN
    RAISE EXCEPTION 'Daily bill payment limit reached' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION referral_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('referrer:' || NEW.referrer_id::text, 0));
  IF NEW.referee_id = NEW.referrer_id
    OR NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.referee_id AND access_state = 'active'
      AND created_at > clock_timestamp() - interval '7 days')
    OR NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.referrer_id AND access_state = 'active')
    OR NOT phone_ok(NEW.referrer_id)
    OR EXISTS (SELECT 1 FROM referrals WHERE referee_id = NEW.referrer_id AND referrer_id = NEW.referee_id)
    OR points_settled_with(NEW.referee_id, NULL)
    OR (SELECT count(*) FROM referrals WHERE referrer_id = NEW.referrer_id
        AND created_at > clock_timestamp() - interval '30 days') >= 20 THEN
    RAISE EXCEPTION 'Referral unavailable' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION referral_reward_quote(referee uuid, reward_kind text,
  OUT referrer uuid, OUT amount bigint, OUT basis bigint) LANGUAGE plpgsql STABLE AS $$
DECLARE
  cfg jsonb := platform_settings_current() -> 'referrals';
  k jsonb;
  r referrals%ROWTYPE;
  customers int;
  used_count int;
  used_kobo bigint;
  month_start timestamptz;
BEGIN
  IF cfg IS NULL OR NOT coalesce((cfg ->> 'enabled')::boolean, false) THEN RETURN; END IF;
  k := cfg -> reward_kind;
  IF k IS NULL OR NOT coalesce((k ->> 'enabled')::boolean, false) THEN RETURN; END IF;
  SELECT * INTO r FROM referrals WHERE referee_id = referee;
  IF r.referee_id IS NULL
    OR EXISTS (SELECT 1 FROM referral_rewards WHERE referee_id = referee AND kind = reward_kind)
    OR NOT EXISTS (SELECT 1 FROM accounts WHERE id = r.referrer_id AND access_state = 'active')
    OR NOT EXISTS (SELECT 1 FROM accounts WHERE id = referee AND access_state = 'active')
    OR NOT phone_ok(r.referrer_id)
    OR NOT phone_ok(referee) THEN
    RETURN;
  END IF;
  IF reward_kind = 'friend' THEN
    SELECT max(f.amount_kobo) INTO basis FROM funding_transfers f
      JOIN funding_accounts d ON d.id = f.destination_id
      JOIN funding_accounts src ON src.id = f.source_id
      WHERE d.owner_id = referee AND d.bucket = 'reward_wallet'
        AND f.kind IN ('purchase_cashback', 'task_reward', 'prize_claim', 'prize_cash_value', 'void_reversal')
        AND src.owner_id <> r.referrer_id
        AND NOT referral_staff_link(src.owner_id, r.referrer_id);
    IF basis IS NULL OR basis < (k ->> 'minQualifyingKobo')::bigint THEN basis := NULL; RETURN; END IF;
  ELSIF reward_kind = 'business' THEN
    IF NOT EXISTS (SELECT 1 FROM sponsor_profiles WHERE owner_id = referee)
      OR referral_staff_link(referee, r.referrer_id)
      OR coalesce((SELECT sum(f.amount_kobo) FROM funding_transfers f
          JOIN funding_accounts d ON d.id = f.destination_id
          WHERE d.owner_id = referee AND d.bucket = 'available' AND f.kind = 'funding_confirmed'), 0)
        < (k ->> 'minFundingKobo')::bigint THEN
      RETURN;
    END IF;
    SELECT coalesce(sum(f.amount_kobo), 0), count(DISTINCT d.owner_id) INTO basis, customers
      FROM funding_transfers f
      JOIN funding_accounts src ON src.id = f.source_id
      JOIN funding_accounts d ON d.id = f.destination_id
      WHERE src.owner_id = referee AND src.bucket = 'task_locked'
        AND f.kind IN ('purchase_cashback', 'task_reward', 'prize_claim', 'prize_cash_value', 'void_reversal')
        AND d.owner_id <> r.referrer_id AND d.owner_id <> referee;
    IF basis < (k ->> 'minPaidOutKobo')::bigint OR customers < (k ->> 'minCustomers')::int THEN
      basis := NULL; RETURN;
    END IF;
  ELSE
    RETURN;
  END IF;
  amount := least((k ->> 'rewardKobo')::bigint, basis * (k ->> 'maxPercent')::bigint / 100);
  month_start := date_trunc('month', clock_timestamp() AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos';
  SELECT count(*), coalesce(sum(amount_kobo), 0) INTO used_count, used_kobo FROM referral_rewards
    WHERE referrer_id = r.referrer_id AND created_at >= month_start;
  IF used_count >= (cfg ->> 'monthlyCount')::int THEN amount := NULL; basis := NULL; RETURN; END IF;
  amount := least(amount, (cfg ->> 'monthlyKobo')::bigint - used_kobo);
  IF amount IS NULL OR amount <= 0 THEN amount := NULL; basis := NULL; RETURN; END IF;
  referrer := r.referrer_id;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION business_rating_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
      OR NOT phone_ok(NEW.account_id)
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
-- Approvals: by an active reviewer, never on their own withdrawal, once, and
-- only while the withdrawal is still held (not sent, not settled).
CREATE FUNCTION withdrawal_approval_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE w withdrawals%ROWTYPE;
BEGIN
  SELECT * INTO w FROM withdrawals WHERE id = NEW.withdrawal_id FOR UPDATE;
  IF w.id IS NULL OR NOT w.needs_approval OR w.account_id = NEW.reviewer_id
    OR NOT staff_reviewer_active(NEW.reviewer_id)
    OR EXISTS (SELECT 1 FROM withdrawal_submissions WHERE withdrawal_id = w.id)
    OR EXISTS (SELECT 1 FROM withdrawal_outcomes WHERE withdrawal_id = w.id)
    OR length(btrim(NEW.reason)) NOT BETWEEN 3 AND 300 THEN
    RAISE EXCEPTION 'Withdrawal approval unavailable' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER withdrawal_approval_guard BEFORE INSERT ON withdrawal_approvals
  FOR EACH ROW EXECUTE FUNCTION withdrawal_approval_guard();
--> statement-breakpoint
-- A rejection settles the withdrawal as failed, which returns the money.
CREATE FUNCTION withdrawal_approval_settle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.decision = 'rejected' THEN
    INSERT INTO withdrawal_outcomes (withdrawal_id, outcome, reason)
      VALUES (NEW.withdrawal_id, 'failed', left('Not approved: ' || NEW.reason, 300));
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER withdrawal_approval_settle AFTER INSERT ON withdrawal_approvals
  FOR EACH ROW EXECUTE FUNCTION withdrawal_approval_settle();
--> statement-breakpoint
-- Nothing that needed approval is recorded as sent without it.
CREATE FUNCTION withdrawal_submission_approved() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM withdrawals w WHERE w.id = NEW.withdrawal_id AND w.needs_approval)
    AND NOT EXISTS (SELECT 1 FROM withdrawal_approvals a
      WHERE a.withdrawal_id = NEW.withdrawal_id AND a.decision = 'approved') THEN
    RAISE EXCEPTION 'Withdrawal approval unavailable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER withdrawal_submission_approved BEFORE INSERT ON withdrawal_submissions
  FOR EACH ROW EXECUTE FUNCTION withdrawal_submission_approved();
--> statement-breakpoint
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON withdrawal_approvals
  FOR EACH ROW EXECUTE FUNCTION funding_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER no_truncate BEFORE TRUNCATE ON withdrawal_approvals
  FOR EACH STATEMENT EXECUTE FUNCTION funding_reject_mutation();
