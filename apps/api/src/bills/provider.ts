import { createHash } from 'node:crypto';

export type BillKind = 'airtime' | 'data' | 'electricity' | 'tv';
export type BillPlan = { code: string; name: string; amountKobo: bigint };
export type Biller = {
  id: string;
  kind: BillKind;
  name: string;
  // Data bundles and TV packages have fixed prices; airtime and electricity
  // take any amount within the limits.
  plans?: BillPlan[];
};
export type BillResult =
  | { status: 'delivered'; providerRef: string; token?: string }
  | { status: 'failed'; reason: string }
  // Not known yet: checked again later with the same bill ID.
  | { status: 'pending' };

// A bills provider (airtime, data, electricity, TV) behind one narrow
// boundary. Acticlaim never holds the provider's credentials in the browser.
export interface BillProvider {
  readonly name: string;
  billers(): Promise<Biller[]>;
  // Electricity meters and TV decoders: the name the biller holds, so the
  // person can check before paying.
  verifyCustomer(input: {
    kind: BillKind;
    biller: string;
    customerRef: string;
  }): Promise<{ name: string }>;
  // Must be idempotent on billId: a repeated call returns the same result
  // and never pays twice.
  purchase(input: {
    billId: string;
    kind: BillKind;
    biller: string;
    customerRef: string;
    planCode?: string;
    amountKobo: bigint;
  }): Promise<BillResult>;
}

const naira = (n: number) => BigInt(n) * 100n;

// Development and test provider: a fixed catalogue, instant delivery, and
// numbers ending in 0000 fail so failures can be tried. Configuration refuses
// it in production.
export class TestBillProvider implements BillProvider {
  readonly name = 'test';
  readonly purchases = new Map<string, BillResult>();

  billers() {
    const data = (prefix: string): BillPlan[] => [
      { code: `${prefix}-1gb-1d`, name: '1GB, 1 day', amountKobo: naira(350) },
      {
        code: `${prefix}-2gb-7d`,
        name: '2GB, 7 days',
        amountKobo: naira(1500),
      },
      {
        code: `${prefix}-10gb-30d`,
        name: '10GB, 30 days',
        amountKobo: naira(4500),
      },
    ];
    const networks = [
      ['mtn', 'MTN'],
      ['airtel', 'Airtel'],
      ['glo', 'Glo'],
      ['9mobile', '9mobile'],
    ] as const;
    return Promise.resolve<Biller[]>([
      ...networks.map(([id, name]) => ({
        id,
        kind: 'airtime' as const,
        name,
      })),
      ...networks.map(([id, name]) => ({
        id: `${id}-data`,
        kind: 'data' as const,
        name,
        plans: data(id),
      })),
      { id: 'ikedc', kind: 'electricity', name: 'Ikeja Electric (prepaid)' },
      { id: 'ekedc', kind: 'electricity', name: 'Eko Electricity (prepaid)' },
      { id: 'aedc', kind: 'electricity', name: 'Abuja Electricity (prepaid)' },
      {
        id: 'dstv',
        kind: 'tv',
        name: 'DStv',
        plans: [
          { code: 'dstv-padi', name: 'Padi', amountKobo: naira(4400) },
          { code: 'dstv-yanga', name: 'Yanga', amountKobo: naira(6000) },
        ],
      },
      {
        id: 'gotv',
        kind: 'tv',
        name: 'GOtv',
        plans: [
          { code: 'gotv-smallie', name: 'Smallie', amountKobo: naira(1900) },
          { code: 'gotv-jinja', name: 'Jinja', amountKobo: naira(3900) },
        ],
      },
    ]);
  }

  verifyCustomer(input: { customerRef: string }) {
    return Promise.resolve({
      name: `Test Customer ${input.customerRef.slice(-4)}`,
    });
  }

  purchase(input: {
    billId: string;
    kind: BillKind;
    customerRef: string;
  }): Promise<BillResult> {
    const known = this.purchases.get(input.billId);
    if (known) return Promise.resolve(known);
    const result: BillResult = input.customerRef.endsWith('0000')
      ? { status: 'failed', reason: 'The biller declined this number.' }
      : {
          status: 'delivered',
          providerRef: `test_bill_${input.billId}`,
          ...(input.kind === 'electricity'
            ? {
                // A stable 20-digit token derived from the bill ID.
                token: BigInt(
                  `0x${createHash('sha256').update(input.billId).digest('hex').slice(0, 16)}`,
                )
                  .toString()
                  .padStart(20, '0')
                  .slice(0, 20)
                  .replace(/(\d{4})(?=\d)/g, '$1-'),
              }
            : {}),
        };
    this.purchases.set(input.billId, result);
    return Promise.resolve(result);
  }
}
