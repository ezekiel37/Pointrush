// Where to go after signing in. Only same-site paths from a short list of
// characters are accepted, so a crafted link cannot send someone to another
// site ("//evil.example", "/\evil.example") or smuggle in script.
export function safeNext(value: string | null | undefined): string | null {
  if (!value || value.length > 200) return null;
  if (!/^\/(?![/\\])[A-Za-z0-9\-_/?=&.]*$/.test(value)) return null;
  return value;
}

// Carries a return path through the sign-in and sign-up pages.
export function withNext(path: string, next: string | null): string {
  return next ? `${path}?next=${encodeURIComponent(next)}` : path;
}
