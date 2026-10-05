ALTER TABLE "withdrawals" DROP CONSTRAINT "withdrawal_amount";--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawal_amount" CHECK ("withdrawals"."amount_kobo" between 100000 and 100000000) NOT VALID;
-- NOT VALID: older withdrawals above N1,000,000 stay; every new one is capped.
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
  -- At most N1,000,000 a day in total. Withdrawals the bank refused (money
  -- returned to the wallet) do not count.
  IF (SELECT coalesce(sum(w.amount_kobo), 0) FROM withdrawals w WHERE w.account_id = NEW.account_id
      AND w.created_at > clock_timestamp() - interval '24 hours'
      AND NOT EXISTS (SELECT 1 FROM withdrawal_outcomes o WHERE o.withdrawal_id = w.id AND o.outcome = 'failed'))
      + NEW.amount_kobo > 100000000 THEN
    RAISE EXCEPTION 'Daily withdrawal limit reached' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
