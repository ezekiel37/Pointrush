# PointRush Design Direction

Status: documented planning direction from the 2026-09-27 discussion; no UI has been implemented or visually verified. Related: [PRD](PointRush_PRD.md), [UX contract](UX-CONTRACT.md).

## Intent

Communicate real opportunities, visible progress and dependable rewards. Playful around progress, calm and precise around points and payments. Serve mobile-first earners, creators and job seekers as well as sponsors and admins. Avoid betting imagery, guaranteed-income language, fake scarcity or punitive engagement loops.

## Foundation

Use shadcn/ui with Tailwind and one maintained set of shared primitives for Next.js. Use React Hook Form with Zod for form feedback; NestJS remains authoritative. Use Lucide icons. Do not mix shadcn and Material UI across portals. Material UI remains a viable alternative, but editable shadcn primitives better support the proposed identity. Source ownership includes maintenance and accessibility verification; adopting components does not guarantee accessible finished screens.

## Proposed Tokens

| Token | Value | Use |
| --- | --- | --- |
| brand-primary | #2457E0 | Main actions, selected navigation and links |
| progress-surface | #DDF7ED | Mint progress backgrounds, with dark foreground |
| reward-accent | #F4C84A | Restrained yellow milestone emphasis, with dark foreground |
| page-background | #F7F8FA | Main light canvas |
| surface | #FFFFFF | Inputs, menus and repeated mission items |
| text-primary | #182026 | Headings, copy and balances |

Semantic success, warning, error, info, muted text, borders, focus rings and interactive states need complete tokens and contrast verification during implementation. Pending rewards must never resemble confirmed earnings. Never communicate status through colour alone. Target WCAG 2.2 AA; proposed hex values are not proof of conformance.

Light-first identity. Dark mode requires separately designed and tested tokens before being offered. Define tokens once in shared CSS custom properties and map Tailwind/shared components to them; no screen-local colour copies. This mapping is planned, not an existing runtime path.

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
