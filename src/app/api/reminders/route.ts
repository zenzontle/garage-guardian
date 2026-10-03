import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAllDue } from '@/lib/due';
import { normalizeCar, type Car, type ScheduleItem, type Visit } from '@/lib/model';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  const emailKey = process.env.BREVO_API_KEY;
  const sender = process.env.BREVO_SENDER_EMAIL;
  const recipient = process.env.REMINDER_TO_EMAIL;
  if (!url || !key || !emailKey || !sender || !recipient) return NextResponse.json({ status: 'email_disabled' });

  // One weekly digest for the single owner of this private prototype.
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: authError } = await db.auth.admin.listUsers({ page: 1, perPage: 2 });
  if (authError) return NextResponse.json({ error: 'Could not load owner' }, { status: 500 });
  const owner = auth.users.find((user) => user.email?.toLowerCase() === recipient.toLowerCase());
  if (!owner) return NextResponse.json({ error: 'Reminder recipient has no account' }, { status: 400 });
  const [carResult, scheduleResult, visitResult] = await Promise.all([
    db.from('cars').select('*').eq('user_id', owner.id),
    db.from('schedule_items').select('*').eq('user_id', owner.id),
    db.from('visits').select('*').eq('user_id', owner.id),
  ]);
  if (carResult.error || scheduleResult.error || visitResult.error)
    return NextResponse.json({ error: 'Could not load maintenance' }, { status: 500 });
  if (now.getUTCDay() !== 1) return NextResponse.json({ status: 'not_digest_day' });
  const cars: Car[] = (carResult.data ?? []).map((row) => normalizeCar({
    id: row.id,
    name: row.name,
    year: row.year,
    make: row.make,
    model: row.model,
    vin: row.vin,
    plate: row.plate,
    distanceUnit: row.distance_unit,
    odometer: row.odometer,
    reminderDays: row.reminder_days,
    reminderMiles: row.reminder_miles,
    createdAt: row.created_at,
  }));
  const schedules: ScheduleItem[] = (scheduleResult.data ?? []).map((row) => ({
    id: row.id,
    carId: row.car_id,
    name: row.name,
    intervalMiles: row.interval_miles,
    intervalMonths: row.interval_months,
    firstDueMiles: row.first_due_miles,
    firstDueDate: row.first_due_date,
    sourceNote: row.source_note,
    isActive: row.is_active,
    createdAt: row.created_at,
  }));
  const visits: Visit[] = (visitResult.data ?? []).map((row) => ({
    id: row.id,
    carId: row.car_id,
    date: row.service_date,
    odometer: row.odometer,
    totalCostCents: row.total_cost_cents,
    provider: row.provider,
    notes: row.notes,
    items: row.items ?? [],
    photos: row.photos ?? [],
    createdAt: row.created_at,
  }));
  const relevant = getAllDue(cars, schedules, visits, today).filter(
    (item) => item.status === 'due' || item.status === 'upcoming',
  );
  if (!relevant.length) return NextResponse.json({ status: 'nothing_due' });
  const { error: claimError } = await db.from('reminder_deliveries').insert({ user_id: owner.id, week_start: today });
  if (claimError) {
    if (claimError.code === '23505') return NextResponse.json({ status: 'already_sent' });
    return NextResponse.json({ error: 'Could not claim digest' }, { status: 500 });
  }
  const lines = relevant
    .map(
      (item) =>
        `<li><strong>${escapeHtml(item.schedule.name)}</strong> — ${escapeHtml(item.car.name)} (${item.status === 'due' ? 'due now' : 'coming up'})</li>`,
    )
    .join('');
  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': emailKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        sender: { email: sender, name: 'Garage Guardian' },
        to: [{ email: recipient }],
        subject: `Garage Guardian: ${relevant.length} maintenance ${relevant.length === 1 ? 'item' : 'items'} to review`,
        htmlContent: `<p>Your garage has maintenance to review:</p><ul>${lines}</ul><p>Open Garage Guardian for due dates, odometer readings, and your full service history.</p>`,
      }),
    });
    if (!response.ok) throw new Error(`Email provider returned ${response.status}`);
    return NextResponse.json({ status: 'sent', count: relevant.length });
  } catch {
    await db.from('reminder_deliveries').delete().eq('user_id', owner.id).eq('week_start', today);
    return NextResponse.json({ error: 'Email delivery failed' }, { status: 502 });
  }
}

function escapeHtml(input: string): string {
  return input.replace(
    /[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
}
