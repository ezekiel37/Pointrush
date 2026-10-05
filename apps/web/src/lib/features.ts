// Product switches, fixed at build time. Paid small tasks ("jobs") are off for
// launch: Acticlaim starts with cash back and prize codes only.
export const jobsEnabled = process.env.NEXT_PUBLIC_FEATURE_JOBS === 'on';

// A pilot is a public test version: payments use the provider's sandbox and
// no real money moves. Every page says so.
export const isPilot = process.env.NEXT_PUBLIC_RELEASE_STAGE === 'pilot';
