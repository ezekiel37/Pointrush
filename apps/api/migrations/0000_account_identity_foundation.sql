CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"access_state" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_access_state_check" CHECK ("accounts"."access_state" in ('active', 'restricted', 'suspended', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "usernames" (
	"username" varchar(20) PRIMARY KEY NOT NULL,
	"account_id" uuid,
	"is_current" boolean DEFAULT false NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "usernames_format_check" CHECK ("usernames"."username" collate "C" ~ '^[a-z][a-z0-9_]{1,18}[a-z0-9]$' and position('__' in "usernames"."username") = 0),
	CONSTRAINT "usernames_ownership_check" CHECK ((
    ("usernames"."account_id" is null and not "usernames"."is_current" and "usernames"."retired_at" is null)
    or ("usernames"."account_id" is not null and (
      ("usernames"."is_current" and "usernames"."retired_at" is null)
      or (not "usernames"."is_current" and "usernames"."retired_at" is not null and "usernames"."retired_at" >= "usernames"."claimed_at")
    ))
  ) and (not "usernames"."is_current" or "usernames"."retired_at" is null))
);
--> statement-breakpoint
CREATE TABLE "verified_phones" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"phone_number" varchar(16) NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verified_phones_phone_number_unique" UNIQUE("phone_number"),
	CONSTRAINT "verified_phones_e164_check" CHECK ("verified_phones"."phone_number" collate "C" ~ '^[+][1-9][0-9]{0,14}$')
);
--> statement-breakpoint
ALTER TABLE "usernames" ADD CONSTRAINT "usernames_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verified_phones" ADD CONSTRAINT "verified_phones_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "usernames_one_current_per_account" ON "usernames" USING btree ("account_id") WHERE "usernames"."is_current";