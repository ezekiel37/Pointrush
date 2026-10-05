CREATE TABLE "notification_reads" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"seen_until" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;