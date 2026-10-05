# Acticlaim Design Direction

Status: account shell implemented from the 2026-09-27 design direction. Browser verification and remaining release checks are recorded below. Related: [PRD](Acticlaim_PRD.md), [UX contract](UX-CONTRACT.md).

## Intent

Communicate real opportunities, visible progress and dependable rewards. Playful around progress, calm and precise around points and payments. Serve mobile-first earners, creators and job seekers as well as sponsors and admins. Avoid betting imagery, guaranteed-income language, fake scarcity or punitive engagement loops.

## Foundation

Use shadcn/ui with Tailwind and one maintained set of shared primitives for Next.js. Use React Hook Form with Zod for form feedback; NestJS remains authoritative. Use Lucide icons. Do not mix shadcn and Material UI across portals. Material UI remains a viable alternative, but editable shadcn primitives better support the proposed identity. Source ownership includes maintenance and accessibility verification; adopting components does not guarantee accessible finished screens.

## Tokens (Acticlaim v2, 5 October 2026)

Direction set from the founder's references (Atlas dashboard, Finpay, Elegostra): light canvas, white cards with soft shadows, pill controls, a sidebar dashboard for businesses, and a centred landing hero with floating product cards. Acticlaim keeps its own signature: the perforated purchase ticket and a green/lime brand. Runtime owner: `apps/web/src/app/globals.css` (`@theme`).

| Role | Token | Value |
| --- | --- | --- |
| Canvas / surface / sunken | `--color-canvas` / `--color-surface` / `--color-sunken` | #F5F6F4 / #FFFFFF / #EEF0EE |
| Ink / muted text | `--color-ink` / `--color-muted` | #0E1512 / #5D6862 |
| Lines | `--color-line` / `--color-divider` | #E6E9E7 / #EEF0EE |
| Non-text marks only | `--color-faint` | #8B9590 (3.1:1; never text) |
| Brand (key action, links, focus) | `--color-brand` / `--color-brand-deep` / `--color-brand-soft` | #0F6E50 / #0B4D39 / #E8F3EE |
| Highlight | `--color-lime` | #D4F25A, ink text only |
| Status chips (text on surface) | success / pending / info / danger | #0E6B4B on #E6F4EE · #8A5300 on #FFF4DE · #1F5FAF on #EAF2FC · #A3261F on #FDECEA |
| Purchase-state series | `--color-series-*` | paid #1BAF7A · ready #2A78D6 · held #EDA100 · voided #4A3AA7 |

Measured: ink on canvas 17.1:1; muted 5.3–5.8:1; white on brand 6.2:1; every chip pair 5.0–7.4:1; ink on lime 14.7:1. The series set passed the dataviz validator (lightness band, chroma, CVD ΔE ≥ 23, normal-vision ΔE 24); paid and held sit below 3:1 on white, so they always appear beside text labels with counts and percentages.

Type: Geist (variable) for everything, Geist Mono for codes and aligned columns. Large figures use proportional digits; tables use tabular digits. Buttons are pills; cards use 20px radius and two-layer soft shadows.

Charts follow the dataviz skill: single-series area with a 2px line, 10% wash, hairline grid, clean ticks, pointer and arrow-key crosshair with tooltip, and a screen-reader table. A range change keeps the previous chart faded until new data arrives.

Illustration: `components/landing/spiral.tsx` draws a golden-angle leaf rosette in SVG, generated rather than photographed. Landing cards with example numbers are labelled as examples; no customer logos, testimonials or stock portraits are used before real customers exist.

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

Shoppers: `AppShell` with a pill navigation bar on wide screens and a bottom tab bar on phones. Businesses: `DashShell` with a grouped sidebar (Operations, Work, Support), breadcrumbs and a Lagos clock; on phones the sidebar becomes a scrolling pill row. Tables become stacked cards below 640px. Every screen is tested at 390px with axe and a horizontal-overflow check.

## Task journey continuation

Task discovery, detail and My tasks extend the account shell using the same light palette, document scrolling, Manrope headings, shared controls and persistent Feedback states. Briefs use plain wrapped text; capacity, deadlines and conditional reward value are visible before joining. Search and paging live in the URL. No new component library, celebratory earning animation, cash balance or identity badge is introduced. Shared owners and verification cases are recorded in UX-CONTRACT.md.

## Round 2 (October 2026)

- Page titles are quieter: 1.4–1.75rem, weight 600. Only the landing hero stays large.
- Dark mode follows the device setting with its own palette (not an inversion). Fills that carry white text use `--color-ink-fill`; green text uses `--color-brand-text`; text on lime uses `--color-on-lime`. QR codes stay black on white for scanning. A browser test runs the accessibility check in dark mode.
- Reviewers use the dashboard layout with their own sidebar (Campaigns, Appeals, Accounts, Payments).
- Points and tier live on the profile; the wallet is only money.
