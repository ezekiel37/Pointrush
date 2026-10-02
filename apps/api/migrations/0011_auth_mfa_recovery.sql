CREATE TABLE "auth_mfa_recovery_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"operator_account_id" uuid NOT NULL,
	"target_auth_user_id" text NOT NULL,
	"previous_factor_id" text,
	"reason" text NOT NULL,
	"evidence_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_mfa_recovery_events_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
ALTER TABLE "auth_mfa_recovery_events" ADD CONSTRAINT "auth_mfa_recovery_events_operator_account_id_accounts_id_fk" FOREIGN KEY ("operator_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "auth_mfa_recovery_events" ADD CONSTRAINT "auth_mfa_recovery_events_target_auth_user_id_auth_users_id_fk" FOREIGN KEY ("target_auth_user_id") REFERENCES "public"."auth_users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "auth_mfa_recovery_target_idx" ON "auth_mfa_recovery_events" USING btree ("target_auth_user_id");
--> statement-breakpoint
CREATE INDEX "auth_mfa_recovery_operator_idx" ON "auth_mfa_recovery_events" USING btree ("operator_account_id");
--> statement-breakpoint
CREATE FUNCTION prevent_auth_mfa_recovery_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'auth MFA recovery audit records are immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER auth_mfa_recovery_events_immutable
BEFORE UPDATE OR DELETE ON "auth_mfa_recovery_events"
FOR EACH ROW EXECUTE FUNCTION prevent_auth_mfa_recovery_mutation();
