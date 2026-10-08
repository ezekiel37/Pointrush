// A short description of a startup or migration failure that is safe to log:
// error codes and messages (for example "self-signed certificate in
// certificate chain" or "password authentication failed"), with connection
// strings and secret-looking values removed.
export function safeErrorSummary(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 3; depth += 1) {
    const { code, message, cause } = current as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    const text =
      typeof message === 'string'
        ? message
            .replace(/postgres(?:ql)?:\/\/\S+/gi, '[connection string]')
            .replace(
              /\b(password|secret|token|key)\b(\s*[=:]\s*)\S+/gi,
              '$1$2[hidden]',
            )
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 300)
        : '';
    const label =
      typeof code === 'string' || typeof code === 'number' ? `${code}: ` : '';
    if (label || text) parts.push(`${label}${text}`);
    current = cause;
  }
  return parts.join(' <- ') || 'unknown error';
}
