# Acticlaim Design Direction

Status: account shell implemented from the 2026-09-27 design direction. Browser verification and remaining release checks are recorded below. Related: [PRD](Acticlaim_PRD.md), [UX contract](UX-CONTRACT.md).

## Intent

Communicate real opportunities, visible progress and dependable rewards. Playful around progress, calm and precise around points and payments. Serve mobile-first earners, creators and job seekers as well as sponsors and admins. Avoid betting imagery, guaranteed-income language, fake scarcity or punitive engagement loops.

## Foundation

Use shadcn/ui with Tailwind and one maintained set of shared primitives for Next.js. Use React Hook Form with Zod for form feedback; NestJS remains authoritative. Use Lucide icons. Do not mix shadcn and Material UI across portals. Material UI remains a viable alternative, but editable shadcn primitives better support the proposed identity. Source ownership includes maintenance and accessibility verification; adopting components does not guarantee accessible finished screens.

## Tokens (Acticlaim, October 2026)

Superseded the earlier blue palette and Manrope. Runtime owner: `apps/web/src/app/globals.css` (`@theme`). Language: receipts and proof — warm paper, ink, monospaced money and codes, and one electric accent reserved for the single most important action on a screen.

| Role | Token | Value |
| --- | --- | --- |
| Canvas / surface / sunken | `--color-canvas` / `--color-surface` / `--color-sunken` | #F3F0E8 / #FFFDF8 / #EBE6DA |
| Ink (text, primary buttons, focus) | `--color-ink` | #141210 |
| Muted text | `--color-muted` | #5E584E |
| Input border / divider | `--color-border` / `--color-divider` | #8A8377 / #E2DCCF |
| Accent (one key action, current tab) | `--color-accent` | #D7FF3C, ink text |
| Earned / paid | `--color-success` on `--color-mint` | #136B3E on #E3F5E9 |
| Pending / held money | `--color-pending` on `--color-pending-surface` | #8A5300 on #FFF3DC |
| Error | `--color-danger` on `--color-danger-surface` | #A3261F on #FDECEA |

Measured WCAG contrast: body ink 16.4:1; muted on canvas 6.2:1; pending 5.8:1; success 5.8:1; danger 6.4:1; ink on accent 16.3:1; input border 3.7:1 (non-text). Held money always carries a text label and amber colour and never uses the earned style. Light theme only; dark mode needs separately tested tokens.

Type: Bricolage Grotesque (variable, self-hosted) for headings; system sans-serif for body; JetBrains Mono for money, codes, labels and counts with tabular numerals.

Signature element: the ticket — a perforated card with an ink header, large monospaced code, QR and countdown. It is used for purchase codes and echoed on the landing page.

## Typography, Geometry and Motion

- Manrope headings, system sans-serif body, tabular numerals for balances. Self-host/subset heading fonts where appropriate and retain a stable fallback.
- Comfortable 16px form text, 44-48px target controls, 8px-or-less repeated-card corners, minimal shadows, restrained borders and no nested cards.
- User screens emphasise next action and progress; sponsor/admin screens emphasise scannable records, filters, budgets and audit history. Same tokens and behaviours across all portals.
- Signature element: a mission progress track showing the actual model's states. Selected assignments include application/selection; never show a universal Join-to-reward promise.
- Short celebrations only after confirmed milestones; honour reduced motion. No flashing balances, fake countdowns, autoplay-heavy assets or penalties for missing a day.
- Available, pending and locked points remain distinct; display reward value without labelling points as withdrawable cash.
- Mobile layouts must survive long names, large numbers, slow connections, virtual keyboards and 200% zoom.

## Documentation and Verification

Shared components own visual and interaction states. Runtime tokens must trace back here or to a documented generated source. Changes require contrast checks, keyboard/touch checks, narrow/wide viewport screenshots, all form states and reduced-motion checks before claiming completion.

References: [shadcn/ui](https://ui.shadcn.com/docs), [forms](https://ui.shadcn.com/docs/forms/react-hook-form), [Material UI](https://mui.com/material-ui/getting-started/).

## Identity and Reputation Labels

Show earned user/sponsor reputation separately from identity/business verification. New is neutral, not a warning. Explain verification scope and reputation evidence without implying guaranteed honesty or earnings. Sponsor signup remains lightweight, with no mandatory identity-document collection at launch. Every task still shows a truthful platform-review state; high reputation never substitutes for task approval.

## Code Presentation

Claim codes should be readable on low-quality print and easy to type on mobile. Use grouped uppercase text, generous spacing and a visible copy button. The standard visual treatment is `PR-ABC-7K4M-9X2QD`; QR may sit beside it when available but is never the only path. Discovery QR and reward claim QR use different labels so users do not confuse scanning a page with claiming a reward.

## Navigation and shells

`AppShell` provides one model: a sticky top bar with Offers, Claim, Jobs, Wallet and Profile on wide screens, and a bottom tab bar on phones, with Business separated in the bar. Auth journeys keep the split story layout with an ink story panel. All screens are verified at 390px for no horizontal overflow and with automated axe checks.

## Task journey continuation

Task discovery, detail and My tasks extend the account shell using the same light palette, document scrolling, Manrope headings, shared controls and persistent Feedback states. Briefs use plain wrapped text; capacity, deadlines and conditional reward value are visible before joining. Search and paging live in the URL. No new component library, celebratory earning animation, cash balance or identity badge is introduced. Shared owners and verification cases are recorded in UX-CONTRACT.md.
