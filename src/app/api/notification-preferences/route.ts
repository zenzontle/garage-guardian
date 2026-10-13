import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { notificationPatchSchema, preferencesFromRow } from '@/lib/notification-preferences';

export const dynamic = 'force-dynamic';
const reply = (body: object, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
const failure = (code: string, status: number) => reply({ error: { code } }, status);

async function handle(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return failure('cloudNotConfigured', 503);
  const token = /^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!token) return failure('sessionExpired', 401);
  try {
    const db = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data, error } = await db.auth.getUser(token);
    if (error || !data.user) return failure('sessionExpired', 401);
    const userId = data.user.id;
    if (request.method === 'GET') {
      const result = await db
        .from('notification_preferences')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      if (result.error) return failure('notificationSave', 502);
      return reply({ preferences: result.data ? preferencesFromRow(result.data) : null });
    }
    // Bound the body before parsing, including requests without Content-Length.
    const reader = request.body?.getReader();
    if (!reader) return failure('notificationInput', 400);
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 2048) {
        await reader.cancel();
        return failure('notificationInput', 413);
      }
      chunks.push(value);
    }
    let input: unknown;
    try {
      input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return failure('notificationInput', 400);
    }
    const parsed = notificationPatchSchema.safeParse(input);
    if (!parsed.success) return failure('notificationInput', 400);
    const patch = parsed.data;
    const row = {
      ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
      ...(patch.weekday === undefined ? {} : { weekday: patch.weekday }),
      ...(patch.emailLanguage === undefined ? {} : { email_language: patch.emailLanguage }),
    };
    // Update only supplied columns; an insert race retries the same partial update.
    let result = await db
      .from('notification_preferences')
      .update(row)
      .eq('user_id', userId)
      .select('*')
      .maybeSingle();
    if (!result.error && !result.data) {
      result = await db
        .from('notification_preferences')
        .insert({ user_id: userId, ...row })
        .select('*')
        .single();
      if (result.error?.code === '23505') {
        result = await db
          .from('notification_preferences')
          .update(row)
          .eq('user_id', userId)
          .select('*')
          .single();
      }
    }
    if (result.error || !result.data) return failure('notificationSave', 502);
    return reply({ preferences: preferencesFromRow(result.data) });
  } catch {
    return failure('notificationSave', 502);
  }
}
export const GET = handle;
export const PATCH = handle;
