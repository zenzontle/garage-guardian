import { z } from 'zod';

export const notificationPatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    weekday: z.number().int().min(0).max(6).optional(),
    emailLanguage: z.enum(['en', 'es']).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

export type NotificationPreferences = {
  enabled: boolean;
  weekday: number;
  emailLanguage: 'en' | 'es';
  nextScheduledAt: string | null;
};
export type NotificationPatch = z.infer<typeof notificationPatchSchema>;
export type PreferenceRow = {
  user_id: string;
  enabled: boolean;
  weekday: number;
  email_language: 'en' | 'es';
  next_scheduled_at: string | null;
};
export function preferencesFromRow(row: PreferenceRow): NotificationPreferences {
  return {
    enabled: row.enabled,
    weekday: row.weekday,
    emailLanguage: row.email_language,
    nextScheduledAt: row.next_scheduled_at,
  };
}
