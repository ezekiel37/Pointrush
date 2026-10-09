CREATE TABLE "platform_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" bigserial NOT NULL,
	"settings" jsonb NOT NULL,
	"actor_id" uuid,
	"reason" varchar(500) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_settings_version_unique" UNIQUE("version"),
	CONSTRAINT "platform_settings_reason" CHECK (length(btrim("platform_settings"."reason")) > 0)
);
--> statement-breakpoint
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_event_kind";--> statement-breakpoint
ALTER TABLE "funding_intents" DROP CONSTRAINT "funding_intent_amount";--> statement-breakpoint
ALTER TABLE "withdrawals" DROP CONSTRAINT "withdrawal_amount";--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_event_kind" CHECK ("audit_events"."kind" in ('sign_in', 'money_password_failed', 'sessions_revoked', 'session_revoked', 'admin_account_viewed', 'admin_payments_viewed', 'admin_disputes_viewed', 'admin_settings_changed', 'admin_search', 'referral_pool_funded'));--> statement-breakpoint
ALTER TABLE "funding_intents" ADD CONSTRAINT "funding_intent_amount" CHECK ("funding_intents"."amount_kobo" between 10000 and 10000000000);--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawal_amount" CHECK ("withdrawals"."amount_kobo" between 10000 and 500000000);--> statement-breakpoint
-- Settings history is kept: a change is a new row, never an edit.
CREATE FUNCTION platform_settings_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Settings history cannot be changed' USING ERRCODE = '23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER platform_settings_immutable BEFORE UPDATE OR DELETE ON platform_settings
  FOR EACH ROW EXECUTE FUNCTION platform_settings_immutable();
--> statement-breakpoint
-- The settings in force, for rules enforced inside the database.
CREATE FUNCTION platform_settings_current() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT settings FROM platform_settings ORDER BY version DESC LIMIT 1
$$;
--> statement-breakpoint
-- One number from the settings, or the fallback when it is missing.
CREATE FUNCTION platform_setting(path text[], fallback bigint) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT coalesce((platform_settings_current() #>> path)::bigint, fallback)
$$;
--> statement-breakpoint
INSERT INTO platform_settings (settings, reason) VALUES ('{"funding":{"minKobo":100000,"maxKobo":10000000000},"campaigns":{"minCashbackKobo":10000,"minPrizeKobo":10000,"minJobRewardKobo":10000,"minBudgetKobo":500000,"maxRewardKobo":100000000,"maxBudgetKobo":5000000000},"newBusinesses":{"days":14,"maxFundingKobo":50000000,"maxBudgetKobo":50000000},"withdrawals":{"minKobo":100000,"maxKobo":100000000,"dailyKobo":100000000,"dailyCount":3},"newAccounts":{"days":7,"dailyWithdrawalKobo":5000000},"handles":{"reserved":["shoprite","dangote","mtn","airtel","glo","gtbank","access_bank","zenith_bank","first_bank","opay","palmpay","moniepoint","kuda","jumia","konga","chicken_republic","dominos","kfc","coca_cola","pepsi"]},"referrals":{"enabled":true,"friend":{"enabled":true,"rewardKobo":20000,"maxPercent":50,"minQualifyingKobo":20000},"business":{"enabled":true,"rewardKobo":200000,"maxPercent":10,"minFundingKobo":2000000,"minPaidOutKobo":1000000,"minCustomers":5},"monthlyCount":10,"monthlyKobo":1000000}}'::jsonb, 'Defaults installed');
--> statement-breakpoint
-- Withdrawal limits now come from the admin settings, with a lower daily
-- total while an account is new. Fallbacks are the limits used until now.
CREATE OR REPLACE FUNCTION withdrawal_request() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  per_day bigint;
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
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
