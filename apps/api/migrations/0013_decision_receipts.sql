CREATE TABLE "proof_decision_receipts" (
	"proof_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "proof_decision_receipts" ADD CONSTRAINT "proof_decision_receipts_proof_id_task_proofs_id_fk" FOREIGN KEY ("proof_id") REFERENCES "public"."task_proofs"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION task_work_proof() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c task_claims%ROWTYPE; t sponsor_tasks%ROWTYPE; d proof_decisions%ROWTYPE;
BEGIN
  SELECT * INTO c FROM task_claims WHERE id = NEW.claim_id FOR UPDATE;
  SELECT * INTO t FROM sponsor_tasks WHERE id = c.task_id;
  IF c.id IS NULL OR length(btrim(NEW.evidence)) NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'Invalid evidence' USING ERRCODE='23514'; END IF;
  IF NEW.revision = 1 THEN
    IF clock_timestamp() >= t.ends_at THEN RAISE EXCEPTION 'Submission deadline passed' USING ERRCODE='23514'; END IF;
  ELSE
    SELECT pd.* INTO d FROM proof_decisions pd JOIN task_proofs p ON p.id = pd.proof_id WHERE p.claim_id = c.id AND p.revision = 1;
    IF d.id IS NULL OR d.decision <> 'changes_required' OR clock_timestamp() >= coalesce((SELECT created_at FROM proof_decision_receipts WHERE proof_id=d.proof_id),clock_timestamp()) + (t.work_terms->>'correctionHours')::integer * interval '1 hour' THEN
      RAISE EXCEPTION 'Correction unavailable' USING ERRCODE='23514'; END IF;
  END IF;
  NEW.created_at := clock_timestamp(); RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION task_work_appeal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d proof_decisions%ROWTYPE; t sponsor_tasks%ROWTYPE;
BEGIN
  SELECT * INTO d FROM proof_decisions WHERE proof_id = NEW.proof_id;
  SELECT st.* INTO t FROM sponsor_tasks st JOIN task_claims c ON c.task_id=st.id JOIN task_proofs p ON p.claim_id=c.id WHERE p.id=NEW.proof_id;
  IF d.id IS NULL OR d.decision <> 'rejected' OR clock_timestamp() >= coalesce((SELECT created_at FROM proof_decision_receipts WHERE proof_id=d.proof_id),clock_timestamp()) + (t.work_terms->>'appealHours')::integer * interval '1 hour'
     OR length(btrim(NEW.reason)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'Appeal unavailable' USING ERRCODE='23514'; END IF;
  NEW.created_at := clock_timestamp(); RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION proof_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM proof_decisions WHERE proof_id=NEW.proof_id) THEN
    RAISE EXCEPTION 'Decision must exist before receipt' USING ERRCODE='23514'; END IF;
  NEW.created_at:=clock_timestamp(); RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER proof_receipt_guard BEFORE INSERT ON proof_decision_receipts FOR EACH ROW EXECUTE FUNCTION proof_receipt_guard();
--> statement-breakpoint
CREATE TRIGGER proof_receipt_immutable BEFORE UPDATE OR DELETE ON proof_decision_receipts FOR EACH ROW EXECUTE FUNCTION funding_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER proof_receipt_no_truncate BEFORE TRUNCATE ON proof_decision_receipts FOR EACH STATEMENT EXECUTE FUNCTION funding_reject_mutation();
