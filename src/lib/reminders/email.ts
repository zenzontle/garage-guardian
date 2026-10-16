import type { DueItem } from '@/lib/maintenance/due';
import { distanceAbbreviation } from '@/lib/garage/model';
import { carPath } from '@/lib/navigation/garage-routes';

const copy = {
  en: {
    subject: (count: number) =>
      `Garage Guardian: ${count} maintenance ${count === 1 ? 'item' : 'items'} to review`,
    intro: 'Your garage has maintenance to review:',
    due: 'due now',
    upcoming: 'coming up',
    date: 'Due by',
    distance: 'Odometer',
    or: 'or',
    footer: 'Distance reminders use your latest entered odometer readings.',
    settings: 'Manage or disable email reminders',
  },
  es: {
    subject: (count: number) =>
      `Garage Guardian: ${count} ${count === 1 ? 'tarea de mantenimiento pendiente' : 'tareas de mantenimiento pendientes'}`,
    intro: 'Tu garaje tiene mantenimiento pendiente:',
    due: 'vencido',
    upcoming: 'próximamente',
    date: 'Fecha límite',
    distance: 'Odómetro',
    or: 'o',
    footer: 'Los recordatorios de distancia usan las últimas lecturas de odómetro que ingresaste.',
    settings: 'Administrar o desactivar recordatorios por correo',
  },
};
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );

export function reminderOrigin(value: string | undefined) {
  if (!value) throw new Error('reminder_configuration');
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('reminder_configuration');
  return url.origin;
}

export function renderDigest(items: DueItem[], language: 'en' | 'es', origin: string) {
  const t = copy[language];
  const groups = new Map<string, DueItem[]>();
  for (const item of items) groups.set(item.car.id, [...(groups.get(item.car.id) ?? []), item]);
  const html: string[] = [`<html lang="${language}"><body><p>${t.intro}</p>`];
  const text = [t.intro];
  for (const group of groups.values()) {
    const car = group[0].car;
    const link = `${origin}${carPath(car.id)}`;
    html.push(`<h2><a href="${escapeHtml(link)}">${escapeHtml(car.name)}</a></h2><ul>`);
    text.push('', `${car.name}: ${link}`);
    for (const item of group) {
      const details: string[] = [];
      if (item.dueDate)
        details.push(
          `${t.date}: ${new Intl.DateTimeFormat(language, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            timeZone: 'UTC',
          }).format(new Date(`${item.dueDate}T00:00:00Z`))}`,
        );
      if (item.dueMiles !== null)
        details.push(
          `${t.distance}: ${new Intl.NumberFormat(language).format(item.dueMiles)} ${distanceAbbreviation(car.distanceUnit)}`,
        );
      const line = `${item.schedule.name} — ${item.status === 'due' ? t.due : t.upcoming}${details.length ? ` (${details.join(` ${t.or} `)})` : ''}`;
      html.push(`<li>${escapeHtml(line)}</li>`);
      text.push(`- ${line}`);
    }
    html.push('</ul>');
  }
  const settings = `${origin}/settings/notifications`;
  html.push(
    `<p>${t.footer}</p><p><a href="${escapeHtml(settings)}">${t.settings}</a></p></body></html>`,
  );
  text.push('', t.footer, `${t.settings}: ${settings}`);
  return {
    subject: t.subject(items.length),
    htmlContent: html.join(''),
    textContent: text.join('\n'),
  };
}
