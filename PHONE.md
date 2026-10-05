# Phone verification

Migration 0019. One verified mobile number per account and per person. It gates prize claims, referral rewards and withdrawals, and is the main defence against one person running many accounts.

## Routes

| Route                              | Behaviour                                                                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/api/v1/phone`                | `{verified, phone}` with the number masked (`+234 ••• 4567`).                                                                             |
| POST `/api/v1/phone/challenges`    | `{phoneNumber}` in international or local format (`0803 123 4567`). Sends a 6-digit code; returns `challengeId`, `expiresAt`, `resendAt`. |
| POST `/api/v1/phone/verifications` | `{challengeId, code}`. Verifies the number on the right code.                                                                             |

Reasons: `phone_unavailable` (503 with no SMS provider; 409 when the account already has a number or the number belongs to another account), `country_unsupported`, `code_cooldown`, `code_limit`, `sms_busy`, `sms_failed`, `code_wrong`, `code_expired`.

## Rules (enforced in the database)

- Codes are random, expire after 10 minutes, and are stored only as a SHA-256 hash.
- Five guesses per code, counted even when wrong; a newer code replaces older ones; a used code never works again.
- One code a minute per account, five a day per account and five a day per number.
- A platform-wide daily ceiling (`SMS_DAILY_LIMIT`, default 500) caps cost if something goes wrong.
- SMS goes only to configured countries (`SMS_ALLOWED_PREFIXES`, default `+234`). This blocks "SMS pumping" fraud, where attackers trigger texts to premium international numbers. Nigerian numbers must be mobile (`+234` then 7, 8 or 9 and nine digits).
- The SMS is sent after the database commit. A failed send still counts towards the limits.

## Configuration

`SMS_PROVIDER=test` keeps messages in memory and is refused in production. A real adapter (for example Termii or Africa's Talking) implements `SmsProvider.send` in `apps/api/src/phone/sms.ts`; it should use a registered sender ID and DND-compliant transactional route.

## Verification

PGlite tests cover normalisation, unavailable provider, unsupported countries, hashing, ownership, single use, taken numbers, guess limits, replacement, expiry, per-account, per-number and platform caps, and failed sends. A native PostgreSQL test proves parallel guesses from two pools never exceed five attempts.

## Known limits

- Changing a verified number is not supported yet; it needs support review.
- A hashed 6-digit code can be brute-forced from a database copy within its 10-minute life. Codes are short-lived and single-use; a keyed hash is a later hardening step.
