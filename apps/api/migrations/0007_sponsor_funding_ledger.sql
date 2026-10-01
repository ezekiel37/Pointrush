CREATE TABLE "funding_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid,
	"bucket" text NOT NULL,
	"allocation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "funding_account_shape" CHECK (("funding_accounts"."bucket" = 'clearing' and "funding_accounts"."owner_id" is null and "funding_accounts"."allocation_id" is null) or ("funding_accounts"."bucket" = 'available' and "funding_accounts"."owner_id" is not null and "funding_accounts"."allocation_id" is null) or ("funding_accounts"."bucket" = 'task_locked' and "funding_accounts"."owner_id" is not null and "funding_accounts"."allocation_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "funding_transfers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_id" uuid NOT NULL,
	"destination_id" uuid NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"kind" text NOT NULL,
	"reference" varchar(200) NOT NULL,
	"actor_id" uuid NOT NULL,
	"reason" varchar(500) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "funding_amount_positive" CHECK ("funding_transfers"."amount_kobo" > 0),
	CONSTRAINT "funding_currency_ngn" CHECK ("funding_transfers"."currency" = 'NGN'),
	CONSTRAINT "funding_distinct_accounts" CHECK ("funding_transfers"."source_id" <> "funding_transfers"."destination_id"),
	CONSTRAINT "funding_transfer_kind" CHECK ("funding_transfers"."kind" in ('funding_confirmed', 'task_lock')),
	CONSTRAINT "funding_reference_present" CHECK (length(btrim("funding_transfers"."reference")) > 0),
	CONSTRAINT "funding_reason_present" CHECK (length(btrim("funding_transfers"."reason")) > 0)
);
--> statement-breakpoint
ALTER TABLE "funding_accounts" ADD CONSTRAINT "funding_accounts_owner_id_accounts_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_transfers" ADD CONSTRAINT "funding_transfers_source_id_funding_accounts_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."funding_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_transfers" ADD CONSTRAINT "funding_transfers_destination_id_funding_accounts_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."funding_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_transfers" ADD CONSTRAINT "funding_transfers_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "funding_clearing_unique" ON "funding_accounts" USING btree ("bucket") WHERE "funding_accounts"."bucket" = 'clearing';--> statement-breakpoint
CREATE UNIQUE INDEX "funding_available_unique" ON "funding_accounts" USING btree ("owner_id") WHERE "funding_accounts"."bucket" = 'available';--> statement-breakpoint
CREATE UNIQUE INDEX "funding_allocation_unique" ON "funding_accounts" USING btree ("allocation_id") WHERE "funding_accounts"."bucket" = 'task_locked';--> statement-breakpoint
CREATE UNIQUE INDEX "funding_reference_unique" ON "funding_transfers" USING btree ("kind","reference");--> statement-breakpoint
CREATE INDEX "funding_source_index" ON "funding_transfers" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "funding_destination_index" ON "funding_transfers" USING btree ("destination_id");
--> statement-breakpoint
CREATE FUNCTION funding_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Funding records are immutable' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER funding_transfers_immutable BEFORE UPDATE OR DELETE ON funding_transfers
FOR EACH ROW EXECUTE FUNCTION funding_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER funding_accounts_immutable BEFORE UPDATE OR DELETE ON funding_accounts
FOR EACH ROW EXECUTE FUNCTION funding_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER funding_transfers_no_truncate BEFORE TRUNCATE ON funding_transfers
FOR EACH STATEMENT EXECUTE FUNCTION funding_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER funding_accounts_no_truncate BEFORE TRUNCATE ON funding_accounts
FOR EACH STATEMENT EXECUTE FUNCTION funding_reject_mutation();
--> statement-breakpoint
CREATE FUNCTION funding_validate_transfer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  source_row funding_accounts%ROWTYPE;
  destination_row funding_accounts%ROWTYPE;
  available numeric;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Funding writes require READ COMMITTED isolation' USING ERRCODE = '23514';
  END IF;
  -- Every writer serializes against the same account rows, in UUID order.
  -- There are no provider calls or long-running work inside this transaction.
  PERFORM id FROM funding_accounts WHERE id IN (NEW.source_id, NEW.destination_id) ORDER BY id FOR UPDATE;
  SELECT * INTO source_row FROM funding_accounts WHERE id = NEW.source_id;
  SELECT * INTO destination_row FROM funding_accounts WHERE id = NEW.destination_id;
  IF source_row.id IS NULL OR destination_row.id IS NULL THEN
    RAISE EXCEPTION 'Funding account not found' USING ERRCODE = '23503';
  END IF;
  IF NEW.kind = 'funding_confirmed' THEN
    IF source_row.bucket <> 'clearing' OR destination_row.bucket <> 'available' THEN
      RAISE EXCEPTION 'Invalid funding path' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.kind = 'task_lock' THEN
    IF source_row.bucket <> 'available' OR destination_row.bucket <> 'task_locked'
      OR source_row.owner_id IS DISTINCT FROM destination_row.owner_id
      OR NEW.actor_id IS DISTINCT FROM source_row.owner_id THEN
      RAISE EXCEPTION 'Invalid allocation path' USING ERRCODE = '23514';
    END IF;
    PERFORM id FROM accounts WHERE id = source_row.owner_id AND access_state = 'active' FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Sponsor access is not active' USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported funding operation' USING ERRCODE = '23514';
  END IF;
  IF source_row.bucket <> 'clearing' THEN
    SELECT coalesce(sum(CASE WHEN destination_id = NEW.source_id THEN amount_kobo ELSE -amount_kobo END), 0)
      INTO available FROM funding_transfers WHERE source_id = NEW.source_id OR destination_id = NEW.source_id;
    IF available < NEW.amount_kobo THEN
      RAISE EXCEPTION 'Insufficient available sponsor funds' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER funding_transfer_validate BEFORE INSERT ON funding_transfers
FOR EACH ROW EXECUTE FUNCTION funding_validate_transfer();
