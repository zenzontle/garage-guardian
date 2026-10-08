import { z } from 'zod';

const currentPassword = z.string().min(1).max(1024);
export const accountPatchSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('email'), currentPassword, newEmail: z.email().max(254) }).strict(),
  z
    .object({
      kind: z.literal('password'),
      currentPassword,
      newPassword: z.string().min(6).max(1024),
    })
    .strict(),
]);
export const accountDeleteSchema = z
  .object({ currentPassword, acknowledged: z.literal(true) })
  .strict();
export type AccountPatch = z.infer<typeof accountPatchSchema>;
export type AccountDelete = z.infer<typeof accountDeleteSchema>;
