CREATE TABLE "account_profiles" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"display_name" varchar(80) NOT NULL,
	"username_changed_at" timestamp with time zone,
	CONSTRAINT "account_profiles_display_name_check" CHECK (char_length("account_profiles"."display_name") between 1 and 80 and "account_profiles"."display_name" = btrim("account_profiles"."display_name") and "account_profiles"."display_name" !~ '[[:cntrl:]]')
);
--> statement-breakpoint
ALTER TABLE "account_profiles" ADD CONSTRAINT "account_profiles_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;