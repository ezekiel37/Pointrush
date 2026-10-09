import { z } from 'zod';

const money = z.string().regex(/^\d+$/);
export const billKind = z.enum(['airtime', 'data', 'electricity', 'tv']);
export type BillKind = z.infer<typeof billKind>;

export const billOptions = z.object({
  available: z.boolean(),
  minKobo: money.optional(),
  maxKobo: money.optional(),
  billers: z.array(
    z.object({
      id: z.string(),
      kind: billKind,
      name: z.string(),
      plans: z
        .array(
          z.object({ code: z.string(), name: z.string(), amountKobo: money }),
        )
        .nullable(),
    }),
  ),
});
export const billPurchase = z.object({
  id: z.uuid(),
  kind: billKind,
  biller: z.string(),
  customerRef: z.string(),
  planCode: z.string().nullable(),
  amountKobo: money,
  createdAt: z.coerce.date(),
  state: z.enum(['pending', 'delivered', 'failed']),
  token: z.string().nullable(),
  failure: z.string().nullable(),
});
export type BillPurchase = z.infer<typeof billPurchase>;
export const billPage = z.object({
  items: z.array(billPurchase),
  nextCursor: z.string().nullable(),
});
export const billCustomer = z.object({ name: z.string() });

export const kindLabel: Record<BillKind, string> = {
  airtime: 'Airtime',
  data: 'Data',
  electricity: 'Electricity',
  tv: 'TV',
};
// What the number field asks for, per kind.
export const refLabel: Record<BillKind, string> = {
  airtime: 'Phone number',
  data: 'Phone number',
  electricity: 'Meter number',
  tv: 'Decoder (smartcard) number',
};
