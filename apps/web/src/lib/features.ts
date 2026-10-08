// Product switches, fixed at build time. Paid small tasks ("jobs") are on
// unless NEXT_PUBLIC_FEATURE_JOBS is "off".
export const jobsEnabled = process.env.NEXT_PUBLIC_FEATURE_JOBS !== 'off';
