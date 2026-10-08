import Link from 'next/link';
import { Brand } from '@/components/auth/auth-frame';
export const metadata = {
  title: 'Privacy policy',
  robots: { index: true, follow: true },
};
const updated = '8 October 2026';
export default function Page() {
  return (
    <main id="main-content" className="help legal">
      <Brand />
      <h1>Privacy policy</h1>
      <p className="small-note">Last updated {updated}</p>
      <p>
        This policy explains what personal data Acticlaim collects, why, who we
        share it with and your rights under the Nigeria Data Protection Act
        2023. Acticlaim is the data controller.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <b>Account:</b> your name, email address, username and password (we
          store only a one-way hash of the password, never the password).
        </li>
        <li>
          <b>Phone:</b> your phone number and when you verified it.
        </li>
        <li>
          <b>Bank:</b> the bank account you add for withdrawals.
        </li>
        <li>
          <b>Activity:</b> purchases businesses confirm for you, prize codes you
          claim, tasks and the work you submit, wallet movements, withdrawals,
          points and referrals.
        </li>
        <li>
          <b>Security:</b> sign-in sessions, two-factor settings, and the IP
          address and device details needed to limit abuse and investigate
          fraud.
        </li>
      </ul>
      <p>
        Businesses see what they need to run their offers, such as a confirmed
        purchase or submitted work. Your public profile shows your verified
        record, never where you shop.
      </p>

      <h2>Why we use it</h2>
      <ul>
        <li>To run your account and pay you (our contract with you).</li>
        <li>
          To prevent fraud, duplicate accounts and abuse (our legitimate
          interest, and to protect businesses and other users).
        </li>
        <li>
          To meet legal duties, for example records of payments and responses to
          lawful requests.
        </li>
        <li>
          To send emails about your account, such as sign-in links and security
          alerts. We do not send marketing without your consent.
        </li>
      </ul>
      <p>We do not sell your personal data.</p>

      <h2>Who we share it with</h2>
      <p>Only service providers we need to run Acticlaim:</p>
      <ul>
        <li>Bachs, to collect business payments and send withdrawals.</li>
        <li>Resend, to send account emails.</li>
        <li>An SMS provider, to verify your phone number.</li>
        <li>Supabase and Brimble, which host our database and servers.</li>
      </ul>
      <p>
        Some of these store data outside Nigeria, including in the European
        Union. We use providers with appropriate safeguards for these transfers,
        as the Act requires. We also share data when the law requires it.
      </p>

      <h2>How long we keep it</h2>
      <p>
        We keep account data while your account is open. Payment and wallet
        records are kept for as long as the law requires after that, and
        security records for a limited time. Sign-in emails in our sending queue
        are deleted after they expire.
      </p>

      <h2>Your rights</h2>
      <p>
        You can ask to see, correct, move or delete your data, object to how we
        use it, or withdraw consent you gave. Some records, such as payments,
        must be kept by law even if you ask us to delete them. If you are
        unhappy with our answer, you can complain to the Nigeria Data Protection
        Commission.
      </p>

      <h2>Security</h2>
      <p>
        Data is encrypted in transit. Passwords are hashed, queued emails are
        encrypted, and reviewer access needs two-factor sign-in. No system is
        perfectly secure; if a breach affects you, we will tell you and the
        regulator as the law requires.
      </p>

      <h2>Children</h2>
      <p>Acticlaim is for people aged 18 and over.</p>

      <h2>Changes and contact</h2>
      <p>
        We will post changes here and tell you about important ones. To use your
        rights or ask a question, email{' '}
        <a href="mailto:support@acticlaim.com">support@acticlaim.com</a>. Our
        terms are in the <Link href="/terms">terms of service</Link>.
      </p>
    </main>
  );
}
