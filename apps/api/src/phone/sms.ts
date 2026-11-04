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

// Termii (termii.com), a Nigerian SMS provider. Codes go out on the "dnd"
// route by default: it reaches numbers on Do Not Disturb and is the route
// Termii recommends for one-time codes (support enables it per account).
// The base URL is account-specific, from the Termii dashboard.
export class TermiiSmsProvider implements SmsProvider {
  readonly name = 'termii';
  constructor(
    private readonly config: {
      apiKey: string;
      senderId: string;
      baseUrl: string;
      channel: 'dnd' | 'generic';
    },
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async send(input: { to: string; body: string; reference: string }) {
    let ok = false;
    try {
      const response = await this.fetcher(
        new URL('/api/sms/send', this.config.baseUrl),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: this.config.apiKey,
            // International format without the plus: 2348031234567.
            to: input.to.replace(/^\+/, ''),
            from: this.config.senderId,
            sms: input.body,
            type: 'plain',
            channel: this.config.channel,
          }),
          signal: AbortSignal.timeout(15000),
        },
      );
      const result = (await response.json().catch(() => null)) as {
        code?: unknown;
      } | null;
      ok = response.ok && result?.code === 'ok';
    } catch {
      ok = false;
    }
    // Never echoes Termii's answer: it can carry the account name.
    if (!ok) throw new SmsFailed();
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
