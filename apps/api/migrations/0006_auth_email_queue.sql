CREATE TABLE "auth_email_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"payload" text,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"lease_token" text,
	"lease_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_email_jobs_state_check" CHECK ("auth_email_jobs"."state" in ('pending', 'processing', 'accepted', 'expired', 'dead')),
	CONSTRAINT "auth_email_jobs_attempts_check" CHECK ("auth_email_jobs"."attempts" between 0 and 5)
);
--> statement-breakpoint
CREATE INDEX "auth_email_jobs_ready_idx" ON "auth_email_jobs" USING btree ("state","available_at");