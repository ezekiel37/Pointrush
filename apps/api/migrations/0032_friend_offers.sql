ALTER TABLE "funding_transfers" DROP CONSTRAINT "funding_transfer_kind";--> statement-breakpoint
ALTER TABLE "purchase_codes" ADD COLUMN "referrer_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_confirmations" ADD COLUMN "referrer_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_codes" ADD CONSTRAINT "purchase_codes_referrer_id_accounts_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_confirmations" ADD CONSTRAINT "purchase_confirmations_referrer_id_accounts_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_transfers" ADD CONSTRAINT "funding_transfer_kind" CHECK ("funding_transfers"."kind" in ('funding_confirmed', 'task_lock', 'task_reward', 'purchase_cashback', 'prize_claim', 'payout_hold', 'payout_paid', 'payout_returned', 'campaign_return', 'prize_handover', 'prize_cash_value', 'void_reversal', 'bill_hold', 'bill_paid', 'bill_returned', 'referral_cashback'));--> statement-breakpoint
ALTER TABLE "sponsor_tasks" ADD CONSTRAINT "sponsor_task_campaign_referral" CHECK ("sponsor_tasks"."campaign_terms" is null or not ("sponsor_tasks"."campaign_terms" ? 'referral') or (
        "sponsor_tasks"."campaign_terms"->'referral'->>'referrerKobo' ~ '^[1-9][0-9]{0,14}$'
        and ("sponsor_tasks"."campaign_terms"->'referral'->>'referrerKobo')::numeric < "sponsor_tasks"."reward_kobo"
        and not ("sponsor_tasks"."campaign_terms" ? 'repeat') and not ("sponsor_tasks"."campaign_terms" ? 'group')));
--> statement-breakpoint
CREATE FUNCTION purchase_referrer_payout(confirmation uuid) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN st.campaign_terms ? 'referral' AND p.referrer_id IS NOT NULL
    THEN (st.campaign_terms->'referral'->>'referrerKobo')::bigint ELSE 0 END
  FROM purchase_confirmations p JOIN sponsor_tasks st ON st.id = p.task_id WHERE p.id = confirmation
$$;
--> statement-breakpoint
-- Bring a friend: the inviter is an active customer of this business (a
-- confirmed purchase that was not voided), the shopper is new to it, and one
-- inviter brings at most 10 friends to an offer.
CREATE FUNCTION purchase_invite_valid(t sponsor_tasks, shopper uuid, inviter uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT inviter IS NOT NULL AND inviter <> shopper
    AND EXISTS (SELECT 1 FROM accounts WHERE id = inviter AND access_state = 'active')
    AND EXISTS (SELECT 1 FROM purchase_confirmations p JOIN sponsor_tasks st ON st.id = p.task_id
      WHERE st.sponsor_id = t.sponsor_id AND p.account_id = inviter
        AND (NOT EXISTS (SELECT 1 FROM purchase_voids v WHERE v.confirmation_id = p.id)
          OR EXISTS (SELECT 1 FROM purchase_void_rulings r WHERE r.confirmation_id = p.id AND r.decision = 'reversed')))
    AND NOT EXISTS (SELECT 1 FROM purchase_confirmations p JOIN sponsor_tasks st ON st.id = p.task_id
      WHERE st.sponsor_id = t.sponsor_id AND p.account_id = shopper)
    AND (SELECT count(*) FROM purchase_confirmations p WHERE p.task_id = t.id AND p.referrer_id = inviter
      AND purchase_holds_place(p.id)) < 10
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION purchase_payout(confirmation uuid) RETURNS bigint LANGUAGE plpgsql STABLE AS $$
DECLARE t sponsor_tasks%ROWTYPE;
BEGIN
  SELECT st.* INTO t FROM purchase_confirmations p JOIN sponsor_tasks st ON st.id = p.task_id WHERE p.id = confirmation;
  IF t.id IS NULL THEN RETURN NULL; END IF;
  -- Bring a friend: the friend's part; the inviter's part is paid separately.
  IF t.campaign_terms ? 'referral' THEN
    RETURN t.reward_kobo - (t.campaign_terms->'referral'->>'referrerKobo')::bigint;
  END IF;
  IF NOT (t.campaign_terms ? 'group') THEN RETURN t.reward_kobo; END IF;
  IF EXISTS (SELECT 1 FROM campaign_group_completions c WHERE c.task_id = t.id) THEN RETURN t.reward_kobo; END IF;
  IF clock_timestamp() >= t.ends_at THEN RETURN (t.campaign_terms->'group'->>'baseKobo')::bigint; END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION purchase_code_issue() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t sponsor_tasks%ROWTYPE;
BEGIN
  SELECT * INTO t FROM sponsor_tasks WHERE id = NEW.task_id FOR SHARE;
  IF NOT purchase_campaign_live(t, NEW.account_id)
    OR EXISTS (SELECT 1 FROM purchase_confirmations WHERE task_id = NEW.task_id AND account_id = NEW.account_id
      AND period = purchase_period(t)) THEN
    RAISE EXCEPTION 'Offer unavailable' USING ERRCODE = '23514';
  END IF;
  IF (t.campaign_terms ? 'referral') <> (NEW.referrer_id IS NOT NULL)
    OR (t.campaign_terms ? 'referral' AND NOT purchase_invite_valid(t, NEW.account_id, NEW.referrer_id)) THEN
    RAISE EXCEPTION 'Invite unavailable' USING ERRCODE = '23514';
  END IF;
  IF (SELECT count(*) FROM purchase_codes WHERE task_id = NEW.task_id AND account_id = NEW.account_id
      AND created_at > clock_timestamp() - interval '1 hour') >= 10 THEN
    RAISE EXCEPTION 'Too many purchase codes requested' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  NEW.expires_at := NEW.created_at + interval '15 minutes';
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION purchase_confirm() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c purchase_codes%ROWTYPE; t sponsor_tasks%ROWTYPE; owner uuid; used bigint;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'READ COMMITTED required' USING ERRCODE='23514'; END IF;
  SELECT * INTO c FROM purchase_codes WHERE id = NEW.code_id;
  -- Capacity is serialized per campaign; the daily limit per shopper across campaigns.
  SELECT * INTO t FROM sponsor_tasks WHERE id = c.task_id FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtextextended('purchase-shopper:' || c.account_id::text, 0));
  SELECT owner_id INTO owner FROM sponsor_profiles WHERE id = t.sponsor_id;
  IF c.id IS NULL OR c.task_id <> NEW.task_id OR c.account_id <> NEW.account_id
    OR c.expires_at <= clock_timestamp()
    -- The owner, or active staff with an active account, confirm at the till.
    OR (owner IS DISTINCT FROM NEW.actor_id AND NOT (business_staff_active(t.sponsor_id, NEW.actor_id)
      AND EXISTS (SELECT 1 FROM accounts WHERE id = NEW.actor_id AND access_state = 'active')))
    OR NOT purchase_campaign_live(t, NEW.account_id)
    OR NEW.amount_kobo < (t.campaign_terms->>'minSpendKobo')::bigint THEN
    RAISE EXCEPTION 'Purchase cannot be confirmed' USING ERRCODE = '23514';
  END IF;
  NEW.period := purchase_period(t);
  NEW.referrer_id := c.referrer_id;
  IF (t.campaign_terms ? 'referral') <> (c.referrer_id IS NOT NULL)
    OR (t.campaign_terms ? 'referral' AND NOT purchase_invite_valid(t, NEW.account_id, c.referrer_id)) THEN
    RAISE EXCEPTION 'Invite unavailable' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM purchase_confirmations WHERE task_id = t.id AND account_id = NEW.account_id
      AND period = NEW.period) THEN
    RAISE EXCEPTION 'Cash back already given for this period' USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO used FROM purchase_confirmations p WHERE p.task_id = t.id
    AND purchase_holds_place(p.id);
  IF used >= t.capacity THEN RAISE EXCEPTION 'Campaign is full' USING ERRCODE = '23514'; END IF;
  -- A staff member confirms at most 100 purchases a day; the owner is not capped.
  IF owner IS DISTINCT FROM NEW.actor_id AND (SELECT count(*) FROM purchase_confirmations
      WHERE actor_id = NEW.actor_id AND task_id = t.id
        AND created_at > clock_timestamp() - interval '24 hours') >= 100 THEN
    RAISE EXCEPTION 'Staff daily confirmation limit reached' USING ERRCODE = '23514';
  END IF;
  IF (SELECT count(*) FROM purchase_confirmations WHERE account_id = NEW.account_id
      AND created_at > clock_timestamp() - interval '24 hours') >= 5 THEN
    RAISE EXCEPTION 'Shopper daily purchase limit reached' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  NEW.release_at := NEW.created_at + (t.campaign_terms->>'holdHours')::integer * interval '1 hour';
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION purchase_release_credit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p purchase_confirmations%ROWTYPE; t sponsor_tasks%ROWTYPE; wallet uuid;
BEGIN
  SELECT * INTO p FROM purchase_confirmations WHERE id = NEW.confirmation_id;
  SELECT * INTO t FROM sponsor_tasks WHERE id = p.task_id;
  INSERT INTO funding_accounts(owner_id, bucket) VALUES (p.account_id, 'reward_wallet') ON CONFLICT DO NOTHING;
  SELECT id INTO wallet FROM funding_accounts WHERE owner_id = p.account_id AND bucket = 'reward_wallet';
  INSERT INTO funding_transfers(id, source_id, destination_id, amount_kobo, kind, reference, actor_id, reason)
  VALUES (gen_random_uuid(), t.allocation_account_id, wallet, purchase_payout(p.id), 'purchase_cashback',
    'purchase:' || p.id::text, p.account_id, 'Released purchase cash back');
  -- Bring a friend: the inviter is paid when the friend's cash back is.
  IF purchase_referrer_payout(p.id) > 0 THEN
    INSERT INTO funding_accounts(owner_id, bucket) VALUES (p.referrer_id, 'reward_wallet') ON CONFLICT DO NOTHING;
    SELECT id INTO wallet FROM funding_accounts WHERE owner_id = p.referrer_id AND bucket = 'reward_wallet';
    INSERT INTO funding_transfers(id, source_id, destination_id, amount_kobo, kind, reference, actor_id, reason)
    VALUES (gen_random_uuid(), t.allocation_account_id, wallet, purchase_referrer_payout(p.id), 'referral_cashback',
      'purchase-referral:' || p.id::text, p.account_id, 'A friend you invited bought');
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION purchase_void_reversal_credit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p purchase_confirmations%ROWTYPE; t sponsor_tasks%ROWTYPE; wallet uuid;
BEGIN
  IF NEW.decision <> 'reversed' THEN RETURN NEW; END IF;
  SELECT * INTO p FROM purchase_confirmations WHERE id = NEW.confirmation_id;
  SELECT * INTO t FROM sponsor_tasks WHERE id = p.task_id;
  INSERT INTO funding_accounts(owner_id, bucket) VALUES (p.account_id, 'reward_wallet') ON CONFLICT DO NOTHING;
  SELECT id INTO wallet FROM funding_accounts WHERE owner_id = p.account_id AND bucket = 'reward_wallet';
  INSERT INTO funding_transfers(id, source_id, destination_id, amount_kobo, kind, reference, actor_id, reason)
  VALUES (gen_random_uuid(), t.allocation_account_id, wallet, purchase_payout(p.id), 'void_reversal',
    'void-reversal:' || p.id::text, NEW.reviewer_id, 'Cash back paid after a disputed void');
  IF purchase_referrer_payout(p.id) > 0 THEN
    INSERT INTO funding_accounts(owner_id, bucket) VALUES (p.referrer_id, 'reward_wallet') ON CONFLICT DO NOTHING;
    SELECT id INTO wallet FROM funding_accounts WHERE owner_id = p.referrer_id AND bucket = 'reward_wallet';
    INSERT INTO funding_transfers(id, source_id, destination_id, amount_kobo, kind, reference, actor_id, reason)
    VALUES (gen_random_uuid(), t.allocation_account_id, wallet, purchase_referrer_payout(p.id), 'referral_cashback',
      'purchase-referral:' || p.id::text, NEW.reviewer_id, 'A friend you invited bought');
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION campaign_return_request() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  t sponsor_tasks%ROWTYPE;
  published boolean;
  balance numeric;
  owed numeric := 0;
BEGIN
  SELECT * INTO t FROM sponsor_tasks WHERE id = NEW.task_id FOR UPDATE;
  IF t.id IS NULL OR NOT EXISTS (
      SELECT 1 FROM sponsor_profiles sp JOIN accounts a ON a.id = sp.owner_id
      WHERE sp.id = t.sponsor_id AND sp.owner_id = NEW.actor_id AND a.access_state = 'active') THEN
    RAISE EXCEPTION 'Campaign funds cannot be returned' USING ERRCODE = '23514';
  END IF;
  published := EXISTS (SELECT 1 FROM task_publications WHERE task_id = t.id);
  -- Live campaigns keep their money. Ended cash back and prize promotions can
  -- return it; jobs only before publication (open appeals may still pay).
  IF published AND (t.ends_at > clock_timestamp() OR t.model NOT IN ('purchase_cashback', 'claim_code')) THEN
    RAISE EXCEPTION 'Campaign funds are still in use' USING ERRCODE = '23514';
  END IF;
  -- Serialize with every other movement of this allocation.
  PERFORM id FROM funding_accounts WHERE id = t.allocation_account_id FOR UPDATE;
  SELECT coalesce(sum(CASE WHEN destination_id = t.allocation_account_id THEN amount_kobo ELSE -amount_kobo END), 0)
    INTO balance FROM funding_transfers
    WHERE source_id = t.allocation_account_id OR destination_id = t.allocation_account_id;
  -- Cash back already earned by shoppers stays locked until they release it.
  IF t.model = 'purchase_cashback' THEN
    -- Voided cash back stays locked for 7 days, or until a dispute is decided.
    SELECT coalesce(sum(coalesce(purchase_payout(p.id), t.reward_kobo) + purchase_referrer_payout(p.id)), 0) INTO owed FROM purchase_confirmations p
      WHERE p.task_id = t.id AND (purchase_void_open(p.id) OR (
        NOT EXISTS (SELECT 1 FROM purchase_voids v WHERE v.confirmation_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM purchase_releases r WHERE r.confirmation_id = p.id)));
  END IF;
  -- Item prizes not yet handed over or cashed out stay locked for the winner.
  IF t.model = 'claim_code' THEN
    SELECT count(*) * t.reward_kobo INTO owed FROM prize_vouchers v
      WHERE v.task_id = t.id
        AND NOT EXISTS (SELECT 1 FROM prize_handovers h WHERE h.redemption_id = v.redemption_id)
        AND NOT EXISTS (SELECT 1 FROM prize_cash_outs c WHERE c.redemption_id = v.redemption_id);
  END IF;
  IF balance - owed <= 0 THEN
    RAISE EXCEPTION 'Nothing to return' USING ERRCODE = '23514';
  END IF;
  NEW.amount_kobo := balance - owed;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION funding_validate_transfer() RETURNS trigger LANGUAGE plpgsql AS $$
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
    IF NEW.reference LIKE 'intent:%' AND NOT EXISTS (
      SELECT 1 FROM funding_intents i WHERE NEW.reference = 'intent:' || i.id::text
        AND i.account_id = destination_row.owner_id AND i.amount_kobo = NEW.amount_kobo
    ) THEN RAISE EXCEPTION 'Funding does not match its intent' USING ERRCODE = '23514'; END IF;
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
  ELSIF NEW.kind = 'task_reward' THEN
    IF source_row.bucket <> 'task_locked' OR destination_row.bucket <> 'reward_wallet'
      OR NOT EXISTS (
        SELECT 1 FROM task_claims c JOIN sponsor_tasks t ON t.id=c.task_id
        WHERE NEW.reference = 'claim:' || c.id::text AND t.allocation_account_id=NEW.source_id
          AND c.account_id=destination_row.owner_id AND t.reward_kobo=NEW.amount_kobo
          AND (
            EXISTS (SELECT 1 FROM task_proofs p JOIN proof_decisions d ON d.proof_id=p.id
              WHERE p.claim_id=c.id AND d.decision='approved' AND d.actor_id=NEW.actor_id)
            OR EXISTS (SELECT 1 FROM task_proofs p JOIN task_appeals a ON a.proof_id=p.id
              JOIN appeal_resolutions r ON r.appeal_id=a.id
              WHERE p.claim_id=c.id AND r.decision='approved' AND r.actor_id=NEW.actor_id)
          )
      ) THEN RAISE EXCEPTION 'Invalid reward path' USING ERRCODE='23514'; END IF;
  ELSIF NEW.kind = 'purchase_cashback' THEN
    IF source_row.bucket <> 'task_locked' OR destination_row.bucket <> 'reward_wallet'
      OR NOT EXISTS (
        SELECT 1 FROM purchase_confirmations p JOIN sponsor_tasks t ON t.id=p.task_id
        JOIN purchase_releases r ON r.confirmation_id=p.id
        WHERE NEW.reference = 'purchase:' || p.id::text AND t.allocation_account_id=NEW.source_id
          AND p.account_id=destination_row.owner_id AND NEW.actor_id=p.account_id
          AND purchase_payout(p.id)=NEW.amount_kobo
          AND NOT EXISTS (SELECT 1 FROM purchase_voids v WHERE v.confirmation_id=p.id)
      ) THEN RAISE EXCEPTION 'Invalid cash back path' USING ERRCODE='23514'; END IF;
  ELSIF NEW.kind = 'prize_claim' THEN
    IF source_row.bucket <> 'task_locked' OR destination_row.bucket <> 'reward_wallet'
      OR NOT EXISTS (
        SELECT 1 FROM claim_redemptions r JOIN sponsor_tasks t ON t.id = r.task_id
        WHERE NEW.reference = 'claim-code:' || r.id::text AND t.allocation_account_id = NEW.source_id
          AND r.account_id = destination_row.owner_id AND NEW.actor_id = r.account_id
          AND t.reward_kobo = NEW.amount_kobo
      ) THEN RAISE EXCEPTION 'Invalid prize path' USING ERRCODE='23514'; END IF;
  ELSIF NEW.kind = 'payout_hold' THEN
    IF source_row.bucket <> 'reward_wallet' OR destination_row.bucket <> 'payout_hold'
      OR source_row.owner_id IS DISTINCT FROM destination_row.owner_id
      OR NEW.actor_id IS DISTINCT FROM source_row.owner_id
      OR NOT EXISTS (SELECT 1 FROM withdrawals w WHERE NEW.reference = 'withdrawal:' || w.id::text
        AND w.account_id = source_row.owner_id AND w.amount_kobo = NEW.amount_kobo)
    THEN RAISE EXCEPTION 'Invalid withdrawal hold' USING ERRCODE = '23514'; END IF;
  ELSIF NEW.kind IN ('payout_paid', 'payout_returned') THEN
    IF source_row.bucket <> 'payout_hold'
      OR (NEW.kind = 'payout_paid' AND destination_row.bucket <> 'clearing')
      OR (NEW.kind = 'payout_returned' AND (destination_row.bucket <> 'reward_wallet'
        OR destination_row.owner_id IS DISTINCT FROM source_row.owner_id))
      OR NOT EXISTS (SELECT 1 FROM withdrawals w JOIN withdrawal_outcomes o ON o.withdrawal_id = w.id
        WHERE w.account_id = source_row.owner_id AND w.amount_kobo = NEW.amount_kobo
          AND NEW.actor_id = w.account_id
          AND ((NEW.kind = 'payout_paid' AND o.outcome = 'paid' AND NEW.reference = 'withdrawal-paid:' || w.id::text)
            OR (NEW.kind = 'payout_returned' AND o.outcome = 'failed' AND NEW.reference = 'withdrawal-returned:' || w.id::text)))
    THEN RAISE EXCEPTION 'Invalid withdrawal settlement' USING ERRCODE = '23514'; END IF;
  ELSIF NEW.kind = 'campaign_return' THEN
    IF source_row.bucket <> 'task_locked' OR destination_row.bucket <> 'available'
      OR source_row.owner_id IS DISTINCT FROM destination_row.owner_id
      OR NEW.actor_id IS DISTINCT FROM source_row.owner_id
      OR NOT EXISTS (SELECT 1 FROM campaign_returns c JOIN sponsor_tasks t ON t.id = c.task_id
        WHERE NEW.reference = 'campaign-return:' || c.id::text AND t.allocation_account_id = NEW.source_id
          AND c.amount_kobo = NEW.amount_kobo)
    THEN RAISE EXCEPTION 'Invalid campaign return' USING ERRCODE = '23514'; END IF;
  ELSIF NEW.kind = 'prize_handover' THEN
    -- The deposit for a handed-over item returns to the business owner.
    IF source_row.bucket <> 'task_locked' OR destination_row.bucket <> 'available'
      OR source_row.owner_id IS DISTINCT FROM destination_row.owner_id
      OR NOT EXISTS (SELECT 1 FROM prize_handovers h JOIN claim_redemptions r ON r.id = h.redemption_id
        JOIN sponsor_tasks t ON t.id = r.task_id
        WHERE NEW.reference = 'prize-handover:' || h.redemption_id::text
          AND t.allocation_account_id = NEW.source_id AND t.reward_kobo = NEW.amount_kobo
          AND NEW.actor_id = h.actor_id)
    THEN RAISE EXCEPTION 'Invalid prize handover' USING ERRCODE = '23514'; END IF;
  ELSIF NEW.kind = 'prize_cash_value' THEN
    IF source_row.bucket <> 'task_locked' OR destination_row.bucket <> 'reward_wallet'
      OR NOT EXISTS (SELECT 1 FROM prize_cash_outs c JOIN claim_redemptions r ON r.id = c.redemption_id
        JOIN sponsor_tasks t ON t.id = r.task_id
        WHERE NEW.reference = 'prize-cash:' || c.redemption_id::text
          AND t.allocation_account_id = NEW.source_id AND t.reward_kobo = NEW.amount_kobo
          AND r.account_id = destination_row.owner_id AND NEW.actor_id = r.account_id)
    THEN RAISE EXCEPTION 'Invalid prize cash value' USING ERRCODE = '23514'; END IF;
  ELSIF NEW.kind = 'void_reversal' THEN
    IF source_row.bucket <> 'task_locked' OR destination_row.bucket <> 'reward_wallet'
      OR NOT EXISTS (SELECT 1 FROM purchase_void_rulings r JOIN purchase_confirmations p ON p.id = r.confirmation_id
        JOIN sponsor_tasks t ON t.id = p.task_id
        WHERE NEW.reference = 'void-reversal:' || p.id::text AND r.decision = 'reversed'
          AND t.allocation_account_id = NEW.source_id AND purchase_payout(p.id) = NEW.amount_kobo
          AND p.account_id = destination_row.owner_id AND NEW.actor_id = r.reviewer_id)
    THEN RAISE EXCEPTION 'Invalid void reversal' USING ERRCODE = '23514'; END IF;
  ELSIF NEW.kind = 'referral_cashback' THEN
    IF source_row.bucket <> 'task_locked' OR destination_row.bucket <> 'reward_wallet'
      OR NOT EXISTS (SELECT 1 FROM purchase_confirmations p JOIN sponsor_tasks t ON t.id = p.task_id
        WHERE NEW.reference = 'purchase-referral:' || p.id::text AND t.allocation_account_id = NEW.source_id
          AND p.referrer_id = destination_row.owner_id
          AND purchase_referrer_payout(p.id) = NEW.amount_kobo AND NEW.amount_kobo > 0
          AND ((NEW.actor_id = p.account_id
              AND EXISTS (SELECT 1 FROM purchase_releases r WHERE r.confirmation_id = p.id)
              AND NOT EXISTS (SELECT 1 FROM purchase_voids v WHERE v.confirmation_id = p.id))
            OR EXISTS (SELECT 1 FROM purchase_void_rulings r WHERE r.confirmation_id = p.id
              AND r.decision = 'reversed' AND r.reviewer_id = NEW.actor_id)))
    THEN RAISE EXCEPTION 'Invalid referral cash back' USING ERRCODE = '23514'; END IF;
  ELSIF NEW.kind = 'bill_hold' THEN
    IF source_row.bucket <> 'reward_wallet' OR destination_row.bucket <> 'payout_hold'
      OR source_row.owner_id IS DISTINCT FROM destination_row.owner_id
      OR NEW.actor_id IS DISTINCT FROM source_row.owner_id
      OR NOT EXISTS (SELECT 1 FROM bill_purchases b WHERE NEW.reference = 'bill:' || b.id::text
        AND b.account_id = source_row.owner_id AND b.amount_kobo = NEW.amount_kobo)
    THEN RAISE EXCEPTION 'Invalid bill hold' USING ERRCODE = '23514'; END IF;
  ELSIF NEW.kind IN ('bill_paid', 'bill_returned') THEN
    IF source_row.bucket <> 'payout_hold'
      OR (NEW.kind = 'bill_paid' AND destination_row.bucket <> 'clearing')
      OR (NEW.kind = 'bill_returned' AND (destination_row.bucket <> 'reward_wallet'
        OR destination_row.owner_id IS DISTINCT FROM source_row.owner_id))
      OR NOT EXISTS (SELECT 1 FROM bill_purchases b JOIN bill_outcomes o ON o.bill_id = b.id
        WHERE b.account_id = source_row.owner_id AND b.amount_kobo = NEW.amount_kobo
          AND NEW.actor_id = b.account_id
          AND ((NEW.kind = 'bill_paid' AND o.outcome = 'delivered' AND NEW.reference = 'bill-paid:' || b.id::text)
            OR (NEW.kind = 'bill_returned' AND o.outcome = 'failed' AND NEW.reference = 'bill-returned:' || b.id::text)))
    THEN RAISE EXCEPTION 'Invalid bill settlement' USING ERRCODE = '23514'; END IF;
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
