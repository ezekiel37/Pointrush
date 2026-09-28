INSERT INTO usernames (username) VALUES
  ('admin'), ('administrator'), ('api'), ('auth'), ('billing'), ('help'),
  ('login'), ('logout'), ('notifications'), ('pointrush'), ('privacy'),
  ('rewards'), ('root'), ('security'), ('settings'), ('signup'), ('support'),
  ('system'), ('tasks'), ('terms'), ('wallet');
--> statement-breakpoint
CREATE FUNCTION preserve_username_reservation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Username reservations cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF NEW.username IS DISTINCT FROM OLD.username
    OR NEW.account_id IS DISTINCT FROM OLD.account_id
    OR NEW.claimed_at IS DISTINCT FROM OLD.claimed_at
    OR OLD.account_id IS NULL
    OR NOT OLD.is_current THEN
    RAISE EXCEPTION 'Username reservation is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER usernames_preserve_reservation
BEFORE UPDATE OR DELETE ON usernames
FOR EACH ROW EXECUTE FUNCTION preserve_username_reservation();
