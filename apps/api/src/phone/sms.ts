// An SMS provider behind one narrow boundary. Codes are generated and checked
// by Acticlaim; the provider only delivers the message.
export interface SmsProvider {
  readonly name: string;
  send(input: { to: string; body: string; reference: string }): Promise<void>;
}

export class SmsFailed extends Error {
  constructor() {
    super('SMS could not be sent');
  }
}

// Development and test provider: keeps messages in memory. Configuration
// refuses it in production.
export class TestSmsProvider implements SmsProvider {
  readonly name = 'test';
  readonly sent: { to: string; body: string; reference: string }[] = [];
  fail = false;
  send(input: { to: string; body: string; reference: string }) {
    if (this.fail) return Promise.reject(new SmsFailed());
    this.sent.push(input);
    return Promise.resolve();
  }
}

// Accepts international format, or a local number for the default country
// (0803 123 4567 for +234). Returns E.164, or null.
export function normalizePhone(input: string, defaultPrefix: string) {
  const compact = input.replace(/[\s().-]/g, '');
  let e164: string;
  if (/^\+[1-9]\d{6,14}$/.test(compact)) e164 = compact;
  else if (/^00[1-9]\d{6,14}$/.test(compact)) e164 = `+${compact.slice(2)}`;
  else if (/^0\d{6,13}$/.test(compact))
    e164 = `${defaultPrefix}${compact.slice(1)}`;
  else return null;
  // Nigerian numbers: +234 followed by 10 digits.
  if (e164.startsWith('+234') && !/^\+234[789]\d{9}$/.test(e164)) return null;
  return /^\+[1-9]\d{6,14}$/.test(e164) ? e164 : null;
}

export function maskPhone(e164: string) {
  return `${e164.slice(0, 4)} ••• ${e164.slice(-4)}`;
}
