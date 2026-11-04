import { z } from 'zod';

// What the staff area may show the signed-in person, about themselves only.
export const staffAccess = z.object({
  reviewer: z.boolean(),
  verified: z.boolean(),
  settingsAdmin: z.boolean(),
});
