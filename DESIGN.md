# PointRush Design Direction

Status: account shell implemented from the 2026-09-27 design direction. Browser verification and remaining release checks are recorded below. Related: [PRD](PointRush_PRD.md), [UX contract](UX-CONTRACT.md).

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

The account slice defines the semantic tokens it uses below. Additional warning and notification treatments require verification when implemented. Pending rewards must never resemble confirmed earnings. Never communicate status through colour alone. Target WCAG 2.2 AA; proposed hex values are not proof of conformance.

Light-first identity. Dark mode requires separately designed and tested tokens before being offered. Define tokens once in shared CSS custom properties and map Tailwind/shared components to them; no screen-local colour copies. The account-shell mapping is implemented below.

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

## Runtime mapping: account shell

The first account UI implements the established palette without a rebrand. Runtime owner: `apps/web/src/app/globals.css` (`@theme`); Tailwind and shared primitives consume the same semantic properties. This document mirrors the values and explains their use. Manrope 600/700 is self-hosted through `@fontsource/manrope`; body copy uses the system stack. No external font request is required.

| Document role | Runtime token | Value / consumers |
| --- | --- | --- |
| brand-primary | `--color-primary` | #2457E0; actions, links, focus, story panel |
| progress-surface | `--color-mint` | #DDF7ED; status feedback |
| reward-accent | `--color-reward` | #F4C84A; brand mark and setup step |
| page-background | `--color-canvas` | #F7F8FA; account canvas |
| surface / text-primary | `--color-surface` / `--color-ink` | #FFFFFF / #182026 |
| muted text | `--color-muted` | #56636E; help text |
| input border / divider | `--color-border` / `--color-divider` | #798793 / #DCE2E8 |
| error foreground / surface | `--color-danger` / `--color-danger-surface` | #A82727 / #FFF1F0 |
| primary hover / active | `--color-primary-hover` / `--color-primary-active` | #1945BB / #133792 |
| success foreground | `--color-success` | #186347 |
| scrollbar thumb / track / hover / active | `--color-scroll-*` | #798793 / #F7F8FA / #56636E / #182026 |
| control radius | `--radius-control` | 0.5rem; shared fields, buttons, panels |

Account entry uses a blue story panel beside a restrained white form on desktop. The story panel becomes a compact brand header on mobile, leaving the task prominent. The real three-step account setup track is the account-flow variant of the progress signature; it makes no reward promise. Controls are at least 48px tall; password toggles are 44px. Document scrolling preserves mobile keyboard and zoom reachability.

Reconcile result: original brand tokens, Manrope headings, flat surfaces, light theme and 8px corners are retained. Previously unresolved semantic colors now have runtime owners. Browser screenshots and automated accessibility tests cover signup/login and account summary; physical device keyboard and screen-reader checks remain release verification.
