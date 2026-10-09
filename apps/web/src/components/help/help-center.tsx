'use client';
import Link from 'next/link';
import { useState } from 'react';
import {
  Building2,
  ChevronRight,
  Coins,
  Plus,
  Rocket,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type Topic = {
  id: string;
  label: string;
  icon: LucideIcon;
  questions: Answer[];
};
type Answer =
  [string, string] | [string, string, { href: string; label: string }[]];

// Answers describe how the product works today; keep them in step with it.
const topics: Topic[] = [
  {
    id: 'start',
    label: 'Getting started',
    icon: Rocket,
    questions: [
      [
        'What is Acticlaim?',
        'A way to get paid for things you already do: cash back on purchases at real businesses, prize codes where every code wins, and paid tasks. The business pays the reward in before an offer goes live, so the money is there when you earn it.',
      ],
      [
        'Does it cost anything to join?',
        'No. Joining is free for shoppers and workers. Businesses pay only for the rewards they fund.',
      ],
      [
        'Why do I need to confirm my email?',
        'It proves you can receive email at that address, so account and security messages reach you. It does not verify your identity.',
      ],
      [
        'I did not get the confirmation email.',
        'Check your spam folder. If you try to sign in before confirming, the sign-in page offers a new link. Links last 1 hour, and you can ask for a new one about once a minute.',
        [{ href: '/verify-email', label: 'Send a new confirmation link' }],
      ],
      [
        'My link has expired. What should I do?',
        'Request a new one. Confirmation links last 1 hour and password reset links 30 minutes.',
        [
          { href: '/verify-email', label: 'New confirmation link' },
          { href: '/forgot-password', label: 'New password reset link' },
        ],
      ],
    ],
  },
  {
    id: 'earn',
    label: 'Earning',
    icon: Coins,
    questions: [
      [
        'How does cash back work?',
        'Pick an offer and get a code on your phone. Show it when you pay; staff confirm the purchase. The cash back is held during the business’s refund window, then moves to your wallet.',
      ],
      [
        'How long is my purchase code valid?',
        'About 15 minutes, and it works once, only for you. If it runs out, get a new one from the offer.',
      ],
      [
        'A business voided my purchase. What can I do?',
        'Businesses can void a purchase during its refund window, with a reason, for at most 20% of a campaign. If you disagree, dispute it from your wallet within 7 days and an Acticlaim reviewer decides.',
      ],
      [
        'How do prize codes work?',
        'Codes come on packs, cards or receipts. Every code wins; there are no draws. Enter it on Claim and the prize goes to your wallet. Each code works once.',
      ],
      [
        'I won an item, not money.',
        'You get a private voucher to show the business when you collect it. If you have not collected it after 14 days, you can take its cash value instead.',
      ],
      [
        'How do paid tasks work?',
        'Read the brief, join the task and submit your proof before the deadline. The business reviews it. Approved work is paid into your wallet. You can respond to correction requests and appeal a rejection within the times shown on the task.',
      ],
    ],
  },
  {
    id: 'wallet',
    label: 'Wallet & withdrawals',
    icon: Wallet,
    questions: [
      [
        'How do I withdraw?',
        'Verify your phone, add a bank account in your own name, and have at least ₦1,000 in your wallet. The wallet shows a checklist until all three are done.',
      ],
      [
        'Are there limits?',
        'The minimum withdrawal is ₦1,000 and you can withdraw up to ₦1,000,000 a day.',
      ],
      [
        'Why can my new bank account not receive money yet?',
        'For your safety, a newly added bank account can receive money 24 hours after you add it. We also email you whenever a bank account is added.',
      ],
      [
        'What is held cash back?',
        'Cash back during the business’s refund window. It is not yours to spend yet, and moves to your wallet when the window closes.',
      ],
      [
        'How do I hide my balance?',
        'Tap the eye on your wallet card. Your choice is remembered on that device.',
      ],
      [
        'Are points money?',
        'No. Points reward real activity, but they are not cash and cannot be withdrawn.',
      ],
    ],
  },
  {
    id: 'business',
    label: 'For businesses',
    icon: Building2,
    questions: [
      [
        'How do I start?',
        'Create an account, set up your business and add funds by bank transfer. Then create a cash back offer, prize codes or a paid task. Acticlaim reviews each campaign before it goes live.',
      ],
      [
        'Why do I pay in advance?',
        'Customers trust offers they know are funded. Your money is locked for the campaign and only paid out for confirmed purchases, valid prize claims or approved work.',
      ],
      [
        'What happens to unused money?',
        'It returns to your balance after the campaign ends and its last refund window closes.',
      ],
      [
        'Can my staff confirm purchases?',
        'Yes. Invite staff from Staff. They can confirm purchases for you but cannot move your money.',
      ],
      [
        'Do prize promotions need a lottery licence?',
        'Acticlaim only runs promotions where every code wins, with prizes funded upfront. There are no draws or games of chance.',
      ],
    ],
  },
  {
    id: 'safety',
    label: 'Safety & account',
    icon: ShieldCheck,
    questions: [
      [
        'Will Acticlaim ever ask for my password?',
        'Never: not by email, phone or chat, and never for a PIN or a fee. If someone asks, it is a scam.',
      ],
      [
        'I think someone else is using my account.',
        'Open your wallet and press "This wasn’t me". Withdrawals lock straight away and your balance stays safe. Then change your password.',
      ],
      [
        'Why are some actions unavailable?',
        'Restricted or suspended accounts cannot earn or withdraw while we check them. You can still see your account status.',
      ],
      [
        'What does New on my profile mean?',
        'You have not built a history here yet. It does not mean your account is untrusted. Tiers grow with the number of different businesses you have real activity with.',
      ],
    ],
  },
];

export function HelpCenter() {
  const [active, setActive] = useState(topics[0]!.id);
  const topic = topics.find((t) => t.id === active) ?? topics[0]!;
  return (
    <div className="help-center">
      <nav className="help-topics" aria-label="Help topics">
        {topics.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-pressed={id === active}
            onClick={() => setActive(id)}
          >
            <Icon size={18} aria-hidden />
            <span>{label}</span>
            <ChevronRight className="help-topic-arrow" size={16} aria-hidden />
          </button>
        ))}
      </nav>
      <section className="help-answers" aria-label={topic.label}>
        {topic.questions.map(([question, answer, links], i) => (
          <details key={`${topic.id}-${question}`} open={i === 0}>
            <summary>
              <span>{question}</span>
              <Plus className="help-toggle" size={18} aria-hidden />
            </summary>
            <p>{answer}</p>
            {links && (
              <p className="help-answer-links">
                {links.map((link) => (
                  <Link key={link.href} className="text-link" href={link.href}>
                    {link.label}
                  </Link>
                ))}
              </p>
            )}
          </details>
        ))}
      </section>
    </div>
  );
}
