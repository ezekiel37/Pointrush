-- Solo admin mode. While one reviewer is the only active reviewer, the two
-- rules that need a second person accept the same person after 24 hours: the
-- final approval of a campaign of ₦1,000,000 or more, and lifting a freeze
-- they made. As soon as a second reviewer is active, both need two people.
CREATE FUNCTION staff_solo(account uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT staff_reviewer_active(account) AND NOT EXISTS (
    SELECT 1 FROM task_reviewer_grants g JOIN accounts a ON a.id = g.reviewer_id
    WHERE g.reviewer_id <> account AND a.access_state = 'active'
      AND g.revoked_at IS NULL AND g.expires_at > clock_timestamp())
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION apply_task_review() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  task sponsor_tasks%ROWTYPE;
  permission task_reviewer_grants%ROWTYPE;
  sponsor_owner uuid;
  backing numeric;
BEGIN
  PERFORM id FROM accounts WHERE id = NEW.reviewer_id AND access_state = 'active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reviewer is not active' USING ERRCODE = '23514'; END IF;
  SELECT * INTO permission FROM task_reviewer_grants WHERE id = NEW.grant_id FOR SHARE;
  IF permission.id IS NULL OR permission.reviewer_id <> NEW.reviewer_id OR permission.revoked_at IS NOT NULL
    OR permission.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'Task review permission required' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO task FROM sponsor_tasks WHERE id = NEW.task_id FOR UPDATE;
  IF task.id IS NULL OR task.terms_version <> NEW.terms_version OR task.request_hash <> NEW.terms_hash
    OR task.review_state <> 'pending_review' OR task.lifecycle <> 'not_live' THEN
    RAISE EXCEPTION 'Task review is stale' USING ERRCODE = '23514';
  END IF;
  SELECT owner_id INTO sponsor_owner FROM sponsor_profiles WHERE id = task.sponsor_id;
  IF sponsor_owner = NEW.reviewer_id THEN
    RAISE EXCEPTION 'Self-review is forbidden' USING ERRCODE = '23514';
  END IF;
  -- Campaigns of ₦1,000,000 or more need a first approval by another reviewer,
  -- or, while only one reviewer exists, their own first approval 24 hours old.
  IF NEW.decision = 'approved' AND task.budget_kobo >= 100000000 AND NOT EXISTS (
      SELECT 1 FROM campaign_first_approvals f WHERE f.task_id = task.id
        AND f.terms_version = NEW.terms_version AND (f.reviewer_id <> NEW.reviewer_id
          OR (staff_solo(NEW.reviewer_id) AND f.created_at <= clock_timestamp() - interval '24 hours'))) THEN
    RAISE EXCEPTION 'A second reviewer must approve' USING ERRCODE = '23514';
  END IF;
  IF NEW.decision = 'approved' THEN
    PERFORM id FROM funding_accounts WHERE id = task.allocation_account_id FOR UPDATE;
    SELECT coalesce(sum(CASE WHEN destination_id = task.allocation_account_id THEN amount_kobo ELSE -amount_kobo END), 0)
      INTO backing FROM funding_transfers WHERE source_id = task.allocation_account_id OR destination_id = task.allocation_account_id;
    IF backing <> task.budget_kobo THEN
      RAISE EXCEPTION 'Task backing does not match approved budget' USING ERRCODE = '23514';
    END IF;
  END IF;
  UPDATE sponsor_tasks SET review_state = NEW.decision WHERE id = task.id;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION account_access_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current text; froze_by uuid; froze_at timestamptz;
BEGIN
  SELECT access_state INTO current FROM accounts WHERE id = NEW.account_id FOR UPDATE;
  -- Reviewers freeze or restore others' accounts, never their own, never closed ones.
  IF current IS NULL OR current = 'closed' OR NEW.account_id = NEW.actor_id
    OR NOT staff_reviewer_active(NEW.actor_id)
    OR NEW.to_state NOT IN ('active', 'suspended') OR NEW.to_state = current
    OR length(btrim(NEW.reason)) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'Access change unavailable' USING ERRCODE = '23514';
  END IF;
  -- Lifting a freeze needs a different reviewer from the one who froze it,
  -- or, while only one reviewer exists, 24 hours since the freeze.
  IF NEW.to_state = 'active' THEN
    SELECT actor_id, created_at INTO froze_by, froze_at FROM account_access_changes
      WHERE account_id = NEW.account_id AND to_state = 'suspended'
      ORDER BY created_at DESC LIMIT 1;
    IF NEW.actor_id = froze_by THEN
      IF NOT staff_solo(NEW.actor_id) THEN
        RAISE EXCEPTION 'A second reviewer must unfreeze' USING ERRCODE = '23514';
      END IF;
      IF froze_at > clock_timestamp() - interval '24 hours' THEN
        RAISE EXCEPTION 'Solo unfreeze waits 24 hours' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  NEW.from_state := current;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
