import Link from 'next/link';
import { Brand } from '@/components/auth/auth-frame';
export const metadata = {
  title: 'Terms of service',
  robots: { index: true, follow: true },
};
const updated = '8 October 2026';
export default function Page() {
  return (
    <main id="main-content" className="help legal">
      <Brand />
      <h1>Terms of service</h1>
      <p className="small-note">Last updated {updated}</p>
      <p>
        These terms are an agreement between you and Acticlaim. By creating an
        account you accept them. If you do not agree, do not use Acticlaim.
        Businesses also accept the{' '}
        <Link href="/terms/business">business terms</Link>.
      </p>

      <h2>1. Who can use Acticlaim</h2>
      <p>
        You must be at least 18 and able to enter a contract under Nigerian law.
        One person, one account, one verified phone number. Accounts are
        personal: do not share, sell or lend them.
      </p>

      <h2>2. What Acticlaim does</h2>
      <p>
        Acticlaim connects people with businesses that offer cash back on
        purchases, prize codes and paid tasks. The business pays each reward in
        before its offer goes live. Acticlaim holds the business&apos;s payment
        through our payment provider, checks each claim and pays rewards once
        the rules of the offer are met.
      </p>
      <p>
        Acticlaim is not a bank, an employer or a lottery. Earnings are not
        guaranteed: you earn only from real purchases, valid prize codes and
        approved work. Every prize code wins; we do not run draws or games of
        chance.
      </p>

      <h2>3. Cash back</h2>
      <p>
        A purchase counts only when the business confirms it at its till. Cash
        back is held during the business&apos;s refund window and then moves to
        your wallet. A business may void a purchase during that window with a
        reason. You can dispute a void within 7 days, and a reviewer decides.
      </p>

      <h2>4. Prize codes</h2>
      <p>
        Each code can be claimed once, by one verified account. Codes that are
        copied, guessed, bought or sold may be refused. Some prizes are goods
        collected from the business with a voucher.
      </p>

      <h2>5. Paid tasks</h2>
      <p>
        The business sets the task, the pay and the rules for approval. Pay is
        released only for approved work. You can respond to a rejection and
        appeal it within the time shown on the task. You are not an employee of
        Acticlaim or of the business.
      </p>

      <h2>6. Wallet and withdrawals</h2>
      <p>
        Your wallet shows money you have earned. You can withdraw to a Nigerian
        bank account in your own name once you have verified your phone. The
        minimum withdrawal is ₦1,000 and the most you can withdraw is ₦1,000,000
        a day. Withdrawals are sent by our payment provider and can take time to
        arrive. We may hold a withdrawal while we check for fraud or an error.
      </p>

      <h2>7. Points, tiers and referrals</h2>
      <p>
        Points reward settled activity. Points are not money, cannot be
        withdrawn and have no cash value. Referral rewards apply only when the
        person you invite verifies their phone and completes real activity. We
        may change or end points, tiers and referrals with notice.
      </p>

      <h2>8. Things you must not do</h2>
      <ul>
        <li>Create more than one account, or use someone else&apos;s.</li>
        <li>
          Fake purchases, codes, work or reviews, or work with a business to do
          so.
        </li>
        <li>
          Use bots or automated tools, or try to break or overload the service.
        </li>
        <li>
          Use Acticlaim for anything illegal, including fraud or money
          laundering.
        </li>
      </ul>
      <p>
        If you break these terms we may refuse a claim, reverse rewards earned
        by breaking them, freeze withdrawals while we investigate, and close
        your account.
      </p>

      <h2>9. Mistakes</h2>
      <p>
        If money reaches your wallet by mistake, it is not yours. We may correct
        the balance and will tell you when we do.
      </p>

      <h2>10. Our responsibility</h2>
      <p>
        We work to keep Acticlaim running and your money safe, but we do not
        promise the service will always be available. Businesses are responsible
        for their own products, prices and prizes. As far as the law allows, we
        are not liable for indirect losses, and our liability to you is limited
        to the amount in your wallet at the time of the claim. Nothing in these
        terms limits rights you have under Nigerian consumer protection law.
      </p>

      <h2>11. Closing your account</h2>
      <p>
        You can stop using Acticlaim at any time. Withdraw your balance first.
        We may close accounts that break these terms or stay unused for a long
        time, after giving notice where we can.
      </p>

      <h2>12. Changes and law</h2>
      <p>
        We may update these terms. If a change matters, we will tell you before
        it takes effect. These terms are governed by the laws of the Federal
        Republic of Nigeria.
      </p>

      <h2>13. Contact</h2>
      <p>
        Questions or complaints: see <Link href="/help">Help</Link>. How we use
        your data is in the <Link href="/privacy">privacy policy</Link>.
      </p>
    </main>
  );
}
