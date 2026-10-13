'use client';

import { z } from 'zod';
import { supabase } from './repository';
import { AppError } from './app-error';
import type { NotificationPatch } from './notification-preferences';

const responseSchema = z.object({
  preferences: z
    .object({
      enabled: z.boolean(),
      weekday: z.number().int().min(0).max(6),
      emailLanguage: z.enum(['en', 'es']),
      nextScheduledAt: z.string().nullable(),
    })
    .nullable(),
});

export async function notificationRequest(
  userId: string,
  signal: AbortSignal,
  patch?: NotificationPatch,
) {
  if (!supabase) throw new AppError('cloudNotConfigured');
  const { data, error } = await supabase.auth.getSession();
  if (error || data.session?.user.id !== userId) throw new AppError('sessionExpired');
  const response = await fetch('/api/notification-preferences', {
    method: patch ? 'PATCH' : 'GET',
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      'Content-Type': 'application/json',
    },
    ...(patch ? { body: JSON.stringify(patch) } : {}),
  });
  if (response.status === 401) throw new AppError('sessionExpired');
  if (response.status === 400) throw new AppError('notificationInput');
  if (!response.ok) throw new AppError('notificationSave');
  const result = responseSchema.safeParse(await response.json());
  if (!result.success || (patch && !result.data.preferences))
    throw new AppError('notificationSave');
  return result.data.preferences;
}
