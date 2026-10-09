CREATE TABLE "referral_pool_topups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"actor_id" uuid NOT NULL,
	"bank_reference" varchar(120) NOT NULL,
	"reason" varchar(500) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_topup_positive" CHECK ("referral_pool_topups"."amount_kobo" > 0),
	CONSTRAINT "referral_topup_reference" CHECK (length(btrim("referral_pool_topups"."bank_reference")) > 0 and length(btrim("referral_pool_topups"."reason")) > 0)
);
--> statement-breakpoint
CREATE TABLE "referral_rewards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referee_id" uuid NOT NULL,
	"referrer_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"basis_kobo" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_reward_kind" CHECK ("referral_rewards"."kind" in ('friend', 'business')),
	CONSTRAINT "referral_reward_positive" CHECK ("referral_rewards"."amount_kobo" > 0)
);
--> statement-breakpoint
ALTER TABLE "funding_accounts" DROP CONSTRAINT "funding_account_shape";--> statement-breakpoint
ALTER TABLE "funding_transfers" DROP CONSTRAINT "funding_transfer_kind";--> statement-breakpoint
ALTER TABLE "auth_users" ADD COLUMN "invited_by" text;--> statement-breakpoint
ALTER TABLE "referral_pool_topups" ADD CONSTRAINT "referral_pool_topups_actor_id_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_referee_id_accounts_id_fk" FOREIGN KEY ("referee_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_referrer_id_accounts_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "referral_reward_once" ON "referral_rewards" USING btree ("referee_id","kind");--> statement-breakpoint
CREATE INDEX "referral_reward_referrer" ON "referral_rewards" USING btree ("referrer_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "funding_referral_pool_unique" ON "funding_accounts" USING btree ("bucket") WHERE "funding_accounts"."bucket" = 'referral_pool';--> statement-breakpoint
ALTER TABLE "funding_accounts" ADD CONSTRAINT "funding_account_shape" CHECK (("funding_accounts"."bucket" in ('clearing', 'referral_pool') and "funding_accounts"."owner_id" is null and "funding_accounts"."allocation_id" is null) or ("funding_accounts"."bucket" in ('available', 'reward_wallet', 'payout_hold') and "funding_accounts"."owner_id" is not null and "funding_accounts"."allocation_id" is null) or ("funding_accounts"."bucket" = 'task_locked' and "funding_accounts"."owner_id" is not null and "funding_accounts"."allocation_id" is not null));--> statement-breakpoint
ALTER TABLE "funding_transfers" ADD CONSTRAINT "funding_transfer_kind" CHECK ("funding_transfers"."kind" in ('funding_confirmed', 'task_lock', 'task_reward', 'purchase_cashback', 'prize_claim', 'payout_hold', 'payout_paid', 'payout_returned', 'campaign_return', 'prize_handover', 'prize_cash_value', 'void_reversal', 'bill_hold', 'bill_paid', 'bill_returned', 'referral_cashback', 'referral_pool_funded', 'referral_reward'));
--> statement-breakpoint
INSERT INTO funding_accounts (bucket) VALUES ('referral_pool');
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
  ELSIF NEW.kind = 'referral_pool_funded' THEN
    -- Acticlaim's own money into the referral pool, recorded by a reviewer
    -- with the bank reference of the deposit.
    IF source_row.bucket <> 'clearing' OR destination_row.bucket <> 'referral_pool'
      OR NOT staff_reviewer_active(NEW.actor_id)
      OR NOT EXISTS (SELECT 1 FROM referral_pool_topups t WHERE NEW.reference = 'referral-topup:' || t.id::text
        AND t.amount_kobo = NEW.amount_kobo AND t.actor_id = NEW.actor_id)
    THEN RAISE EXCEPTION 'Invalid referral pool funding' USING ERRCODE = '23514'; END IF;
  ELSIF NEW.kind = 'referral_reward' THEN
    IF source_row.bucket <> 'referral_pool' OR destination_row.bucket <> 'reward_wallet'
      OR NOT EXISTS (SELECT 1 FROM referral_rewards r WHERE NEW.reference = 'referral-reward:' || r.id::text
        AND r.referrer_id = destination_row.owner_id AND r.amount_kobo = NEW.amount_kobo
        AND NEW.actor_id = r.referrer_id)
    THEN RAISE EXCEPTION 'Invalid referral reward' USING ERRCODE = '23514'; END IF;
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
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['referral_pool_topups','referral_rewards'] LOOP
    EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION funding_reject_mutation()', name);
    EXECUTE format('CREATE TRIGGER no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION funding_reject_mutation()', name);
  END LOOP;
END $$;
--> statement-breakpoint
-- Anyone active with a verified phone may invite; the phone is what makes
-- fake inviters costly. The invited account must still be new and have no
-- settled activity, and circular invites stay refused.
CREATE OR REPLACE FUNCTION referral_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('referrer:' || NEW.referrer_id::text, 0));
  IF NEW.referee_id = NEW.referrer_id
    OR NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.referee_id AND access_state = 'active'
      AND created_at > clock_timestamp() - interval '7 days')
    OR NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.referrer_id AND access_state = 'active')
    OR NOT EXISTS (SELECT 1 FROM verified_phones WHERE account_id = NEW.referrer_id)
    OR EXISTS (SELECT 1 FROM referrals WHERE referee_id = NEW.referrer_id AND referrer_id = NEW.referee_id)
    OR points_settled_with(NEW.referee_id, NULL)
    OR (SELECT count(*) FROM referrals WHERE referrer_id = NEW.referrer_id
        AND created_at > clock_timestamp() - interval '30 days') >= 20 THEN
    RAISE EXCEPTION 'Referral unavailable' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Whether the inviter works or worked at the business that paid.
CREATE FUNCTION referral_staff_link(business_owner uuid, inviter uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM business_staff bs JOIN sponsor_profiles sp ON sp.id = bs.sponsor_id
    WHERE sp.owner_id = business_owner AND bs.account_id = inviter)
$$;
--> statement-breakpoint
-- What one referral would pay now under the settings in force, or nothing.
-- Friend: the friend's largest payout from a business the inviter neither
-- owns nor works at, at least minQualifyingKobo. Business: what the invited
-- business paid to at least minCustomers different customers (never the
-- inviter or the owner), after funding at least minFundingKobo. The reward
-- is the smaller of rewardKobo and maxPercent of that, within the inviter's
-- monthly count and amount.
CREATE FUNCTION referral_reward_quote(referee uuid, reward_kind text,
  OUT referrer uuid, OUT amount bigint, OUT basis bigint) LANGUAGE plpgsql STABLE AS $$
DECLARE
  cfg jsonb := platform_settings_current() -> 'referrals';
  k jsonb;
  r referrals%ROWTYPE;
  customers int;
  used_count int;
  used_kobo bigint;
  month_start timestamptz;
BEGIN
  IF cfg IS NULL OR NOT coalesce((cfg ->> 'enabled')::boolean, false) THEN RETURN; END IF;
  k := cfg -> reward_kind;
  IF k IS NULL OR NOT coalesce((k ->> 'enabled')::boolean, false) THEN RETURN; END IF;
  SELECT * INTO r FROM referrals WHERE referee_id = referee;
  IF r.referee_id IS NULL
    OR EXISTS (SELECT 1 FROM referral_rewards WHERE referee_id = referee AND kind = reward_kind)
    OR NOT EXISTS (SELECT 1 FROM accounts WHERE id = r.referrer_id AND access_state = 'active')
    OR NOT EXISTS (SELECT 1 FROM accounts WHERE id = referee AND access_state = 'active')
    OR NOT EXISTS (SELECT 1 FROM verified_phones WHERE account_id = r.referrer_id)
    OR NOT EXISTS (SELECT 1 FROM verified_phones WHERE account_id = referee) THEN
    RETURN;
  END IF;
  IF reward_kind = 'friend' THEN
    SELECT max(f.amount_kobo) INTO basis FROM funding_transfers f
      JOIN funding_accounts d ON d.id = f.destination_id
      JOIN funding_accounts src ON src.id = f.source_id
      WHERE d.owner_id = referee AND d.bucket = 'reward_wallet'
        AND f.kind IN ('purchase_cashback', 'task_reward', 'prize_claim', 'prize_cash_value', 'void_reversal')
        AND src.owner_id <> r.referrer_id
        AND NOT referral_staff_link(src.owner_id, r.referrer_id);
    IF basis IS NULL OR basis < (k ->> 'minQualifyingKobo')::bigint THEN basis := NULL; RETURN; END IF;
  ELSIF reward_kind = 'business' THEN
    IF NOT EXISTS (SELECT 1 FROM sponsor_profiles WHERE owner_id = referee)
      OR referral_staff_link(referee, r.referrer_id)
      OR coalesce((SELECT sum(f.amount_kobo) FROM funding_transfers f
          JOIN funding_accounts d ON d.id = f.destination_id
          WHERE d.owner_id = referee AND d.bucket = 'available' AND f.kind = 'funding_confirmed'), 0)
        < (k ->> 'minFundingKobo')::bigint THEN
      RETURN;
    END IF;
    SELECT coalesce(sum(f.amount_kobo), 0), count(DISTINCT d.owner_id) INTO basis, customers
      FROM funding_transfers f
      JOIN funding_accounts src ON src.id = f.source_id
      JOIN funding_accounts d ON d.id = f.destination_id
      WHERE src.owner_id = referee AND src.bucket = 'task_locked'
        AND f.kind IN ('purchase_cashback', 'task_reward', 'prize_claim', 'prize_cash_value', 'void_reversal')
        AND d.owner_id <> r.referrer_id AND d.owner_id <> referee;
    IF basis < (k ->> 'minPaidOutKobo')::bigint OR customers < (k ->> 'minCustomers')::int THEN
      basis := NULL; RETURN;
    END IF;
  ELSE
    RETURN;
  END IF;
  amount := least((k ->> 'rewardKobo')::bigint, basis * (k ->> 'maxPercent')::bigint / 100);
  month_start := date_trunc('month', clock_timestamp() AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos';
  SELECT count(*), coalesce(sum(amount_kobo), 0) INTO used_count, used_kobo FROM referral_rewards
    WHERE referrer_id = r.referrer_id AND created_at >= month_start;
  IF used_count >= (cfg ->> 'monthlyCount')::int THEN amount := NULL; basis := NULL; RETURN; END IF;
  amount := least(amount, (cfg ->> 'monthlyKobo')::bigint - used_kobo);
  IF amount IS NULL OR amount <= 0 THEN amount := NULL; basis := NULL; RETURN; END IF;
  referrer := r.referrer_id;
END $$;
--> statement-breakpoint
-- A reward row must be exactly what the quote says, so it cannot be forged.
CREATE FUNCTION referral_reward_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE q record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('referral-reward:' || NEW.referrer_id::text, 0));
  SELECT * INTO q FROM referral_reward_quote(NEW.referee_id, NEW.kind);
  IF q.referrer IS DISTINCT FROM NEW.referrer_id OR q.amount IS DISTINCT FROM NEW.amount_kobo
    OR q.basis IS DISTINCT FROM NEW.basis_kobo THEN
    RAISE EXCEPTION 'Referral reward unavailable' USING ERRCODE = '23514';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER referral_reward_guard BEFORE INSERT ON referral_rewards
  FOR EACH ROW EXECUTE FUNCTION referral_reward_guard();
--> statement-breakpoint
-- Pays a referral when it qualifies and the pool can cover it. Never blocks
-- the payout that triggered it: anything unavailable is skipped, and the
-- next qualifying payout tries again.
CREATE FUNCTION referral_reward_try(referee uuid, reward_kind text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  q record;
  pool uuid;
  wallet uuid;
  reward uuid;
  pool_balance numeric;
BEGIN
  BEGIN
    SELECT * INTO q FROM referral_reward_quote(referee, reward_kind);
    IF q.referrer IS NULL THEN RETURN; END IF;
    SELECT id INTO pool FROM funding_accounts WHERE bucket = 'referral_pool';
    SELECT coalesce(sum(CASE WHEN destination_id = pool THEN amount_kobo ELSE -amount_kobo END), 0)
      INTO pool_balance FROM funding_transfers WHERE source_id = pool OR destination_id = pool;
    IF pool IS NULL OR pool_balance < q.amount THEN RETURN; END IF;
    INSERT INTO funding_accounts (owner_id, bucket) VALUES (q.referrer, 'reward_wallet') ON CONFLICT DO NOTHING;
    SELECT id INTO wallet FROM funding_accounts WHERE owner_id = q.referrer AND bucket = 'reward_wallet';
    INSERT INTO referral_rewards (referee_id, referrer_id, kind, amount_kobo, basis_kobo)
      VALUES (referee, q.referrer, reward_kind, q.amount, q.basis) RETURNING id INTO reward;
    INSERT INTO funding_transfers (id, source_id, destination_id, amount_kobo, kind, reference, actor_id, reason)
      VALUES (gen_random_uuid(), pool, wallet, q.amount, 'referral_reward', 'referral-reward:' || reward::text,
        q.referrer, 'Referral reward');
  EXCEPTION WHEN check_violation OR unique_violation OR not_null_violation OR foreign_key_violation THEN
    NULL;
  END;
END $$;
--> statement-breakpoint
-- After money reaches a customer: the customer may qualify their inviter,
-- and the business that paid may qualify its inviter.
CREATE FUNCTION referral_after_payout() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE customer uuid; business_owner uuid;
BEGIN
  IF NEW.kind IN ('purchase_cashback', 'task_reward', 'prize_claim', 'prize_cash_value', 'void_reversal') THEN
    SELECT owner_id INTO customer FROM funding_accounts WHERE id = NEW.destination_id;
    SELECT owner_id INTO business_owner FROM funding_accounts WHERE id = NEW.source_id;
    IF customer IS NOT NULL THEN PERFORM referral_reward_try(customer, 'friend'); END IF;
    IF business_owner IS NOT NULL THEN PERFORM referral_reward_try(business_owner, 'business'); END IF;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER referral_after_payout AFTER INSERT ON funding_transfers
  FOR EACH ROW EXECUTE FUNCTION referral_after_payout();
