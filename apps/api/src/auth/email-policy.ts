import { disposableDomains } from './disposable-domains.js';

// Whether an address belongs to a throwaway email service. Subdomains count
// too: x.yopmail.com is as disposable as yopmail.com.
export function disposableEmail(email: string, extra: readonly string[] = []) {
  const domain = email.trim().toLowerCase().split('@').pop() ?? '';
  const blocked = new Set(extra.map((d) => d.toLowerCase()));
  const parts = domain.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join('.');
    if (disposableDomains.has(candidate) || blocked.has(candidate)) return true;
  }
  return false;
}
