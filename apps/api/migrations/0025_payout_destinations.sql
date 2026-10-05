CREATE TABLE "payout_destinations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_destination_id" varchar(120) NOT NULL,
	"bank_code" varchar(20) NOT NULL,
	"bank_name" varchar(120) NOT NULL,
	"account_name" varchar(160) NOT NULL,
	"account_last4" varchar(4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_destination_last4" CHECK ("payout_destinations"."account_last4" ~ '^[0-9]{4}$')
);
--> statement-breakpoint
ALTER TABLE "withdrawals" ADD COLUMN "destination_id" uuid;--> statement-breakpoint
ALTER TABLE "payout_destinations" ADD CONSTRAINT "payout_destinations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payout_destination_account" ON "payout_destinations" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_destination_provider_id" ON "payout_destinations" USING btree ("provider","provider_destination_id");--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_destination_id_payout_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."payout_destinations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION withdrawal_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Serialize one account's withdrawals; the ledger checks the balance.
  PERFORM pg_advisory_xact_lock(hashtextextended('withdrawal:' || NEW.account_id::text, 0));
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND access_state = 'active')
    OR NOT EXISTS (SELECT 1 FROM verified_phones WHERE account_id = NEW.account_id) THEN
    RAISE EXCEPTION 'Withdrawal unavailable' USING ERRCODE = '23514';
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
CREATE FUNCTION payout_destination_add() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('payout-destination:' || NEW.account_id::text, 0));
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND access_state = 'active')
    OR length(btrim(NEW.account_name)) NOT BETWEEN 1 AND 160
    OR length(btrim(NEW.bank_name)) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'Bank account unavailable' USING ERRCODE = '23514';
  END IF;
  IF (SELECT count(*) FROM payout_destinations WHERE account_id = NEW.account_id
      AND created_at > clock_timestamp() - interval '30 days') >= 3 THEN
    RAISE EXCEPTION 'Too many bank account changes' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER payout_destination_add BEFORE INSERT ON payout_destinations FOR EACH ROW EXECUTE FUNCTION payout_destination_add();
--> statement-breakpoint
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON payout_destinations FOR EACH ROW EXECUTE FUNCTION funding_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER no_truncate BEFORE TRUNCATE ON payout_destinations FOR EACH STATEMENT EXECUTE FUNCTION funding_reject_mutation();
