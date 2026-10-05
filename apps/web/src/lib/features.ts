// Product switches, fixed at build time. Paid small tasks ("jobs") are off for
// launch: Acticlaim starts with cash back and prize codes only.
export const jobsEnabled = process.env.NEXT_PUBLIC_FEATURE_JOBS === 'on';
