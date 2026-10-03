import Link from 'next/link';
import { Brand } from '@/components/auth/auth-frame';
export const metadata = { title: 'Account help' };
const questions = [
  [
    'Why do I need to verify my email?',
    'It confirms that you can access the address used for your account. Email verification does not verify your legal identity or award a public identity badge.',
  ],
  [
    'Where is my verification or reset email?',
    'Check your spam folder and confirm the address you entered. Wait at least a minute before requesting another email. Requests are limited per address and across the platform. An accepted request does not guarantee inbox delivery.',
  ],
  [
    'My link has expired. What should I do?',
    'Request a new verification or password reset email. For password resets, keep the link tab open until you finish; reloading after the token is removed requires reopening the original email link.',
  ],
  [
    'Do I earn points for signing up?',
    'No. Creating an account does not award points or guarantee earnings. You can browse published tasks and reserve a place. Rewards depend on approved work; you can submit text proof, respond to correction requests and appeal rejections from My tasks. File uploads and reward redemption are still being built.',
  ],
  [
    'What does New reputation mean?',
    'It means you have not yet built a history of eligible activity here. It does not mean your account is untrusted. Reputation and identity verification are separate.',
  ],
  [
    'Why are account actions unavailable?',
    'Restricted, suspended and closed accounts cannot perform task or reward actions. You can still view your account status with a valid session. An in-app support and appeal process is being built; it is not available in this version.',
  ],
];
export default function Page() {
  return (
    <main id="main-content" className="help">
      <Brand />
      <h1>A little clarity goes a long way.</h1>
      <p>Answers for getting started with your PointRush account.</p>
      {questions.map(([question, answer]) => (
        <details key={question}>
          <summary>{question}</summary>
          <p>{answer}</p>
        </details>
      ))}
      <div className="flex flex-wrap gap-6 mt-8">
        <Link className="text-link" href="/account">
          Back to your account
        </Link>
        <Link className="text-link" href="/verify-email">
          Resend verification
        </Link>
        <Link className="text-link" href="/forgot-password">
          Reset password
        </Link>
      </div>
    </main>
  );
}
