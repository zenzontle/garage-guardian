'use client';

import { useMemo, useState, type PointerEvent } from 'react';
import { useTranslations } from 'next-intl';
import type { Car, FuelEntry } from '@/lib/garage/model';
import type { FuelEconomy } from '@/lib/fuel/economy';
import { useDisplay } from '@/i18n/use-display';
import { useFuelDisplay } from './use-fuel-display';

const WIDTH = 640;
const HEIGHT = 220;
const PAD = { top: 16, right: 52, bottom: 28, left: 44 };
const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

// Round axis bounds to clean steps around the data, so ticks read as plain numbers.
function niceScale(min: number, max: number) {
  const span = max - min || Math.max(1, Math.abs(max) * 0.1);
  const rough = span / 3;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((m) => m >= rough)!;
  const low = Math.floor(min / step) * step;
  const high = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = low; value <= high + step / 2; value += step) ticks.push(value);
  return { low, high: high === low ? low + step : high, ticks };
}

/** Economy of each measured tank over time for one vehicle, against its average. */
export function FuelTrend({
  car,
  entries,
  economy,
}: {
  car: Car;
  entries: FuelEntry[];
  economy: FuelEconomy;
}) {
  const t = useTranslations();
  const { displayDate, number } = useDisplay();
  const fuel = useFuelDisplay();
  const [active, setActive] = useState<number | null>(null);
  const points = useMemo(
    () =>
      entries
        .filter((entry) => entry.carId === car.id && economy.byEntry.has(entry.id))
        .map((entry) => ({ entry, value: economy.byEntry.get(entry.id)! }))
        .sort(
          (a, b) => a.entry.date.localeCompare(b.entry.date) || a.entry.odometer - b.entry.odometer,
        ),
    [car.id, entries, economy],
  );
  if (points.length < 2 || economy.average === null)
    return <p className="section-hint">{t('fuel.trendEmpty')}</p>;

  const values = points.map((point) => point.value);
  const scale = niceScale(Math.min(...values, economy.average), Math.max(...values));
  const first = day(points[0].entry.date);
  const last = day(points[points.length - 1].entry.date);
  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  // Same-day tanks are spread evenly, so every point stays reachable.
  const x = (index: number) =>
    PAD.left +
    (last === first
      ? (index / (points.length - 1)) * plotWidth
      : ((day(points[index].entry.date) - first) / (last - first)) * plotWidth);
  const y = (value: number) =>
    PAD.top + plotHeight - ((value - scale.low) / (scale.high - scale.low)) * plotHeight;
  const path = points
    .map(
      (point, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`,
    )
    .join(' ');
  const averageY = y(economy.average);
  const tick = (value: number) => number(Number(value.toFixed(value % 1 ? 1 : 0)));

  function track(event: PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const pointer = ((event.clientX - box.left) / box.width) * WIDTH;
    let nearest = 0;
    for (let index = 1; index < points.length; index++)
      if (Math.abs(x(index) - pointer) < Math.abs(x(nearest) - pointer)) nearest = index;
    setActive(nearest);
  }

  const shown = active === null ? null : points[active];
  const label = t('fuel.trendLabel', {
    vehicle: car.name,
    count: points.length,
    first: displayDate(points[0].entry.date),
    last: displayDate(points[points.length - 1].entry.date),
    average: fuel.economy(economy.average, economy.unit),
  });
  return (
    <div className="fuel-trend">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={label}
        onPointerMove={track}
        onPointerLeave={() => setActive(null)}
      >
        {scale.ticks.map((value) => (
          <g key={value}>
            <line
              className="trend-grid"
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(value)}
              y2={y(value)}
            />
            <text className="trend-axis" x={PAD.left - 8} y={y(value)} textAnchor="end" dy="0.32em">
              {tick(value)}
            </text>
          </g>
        ))}
        <text className="trend-axis" x={PAD.left} y={HEIGHT - 6} textAnchor="start">
          {displayDate(points[0].entry.date)}
        </text>
        <text className="trend-axis" x={WIDTH - PAD.right} y={HEIGHT - 6} textAnchor="end">
          {displayDate(points[points.length - 1].entry.date)}
        </text>
        <line
          className="trend-average"
          x1={PAD.left}
          x2={WIDTH - PAD.right}
          y1={averageY}
          y2={averageY}
        />
        <text className="trend-axis" x={WIDTH - PAD.right + 6} y={averageY} dy="0.32em">
          {tick(economy.average)}
        </text>
        {shown && (
          <line
            className="trend-crosshair"
            x1={x(active!)}
            x2={x(active!)}
            y1={PAD.top}
            y2={PAD.top + plotHeight}
          />
        )}
        <path className="trend-line" d={path} />
        {points.map((point, index) => (
          <circle
            key={point.entry.id}
            className={`trend-point ${index === active ? 'active' : ''}`}
            cx={x(index)}
            cy={y(point.value)}
            r={index === active ? 5.5 : 4}
          />
        ))}
      </svg>
      {shown && (
        <div
          className="trend-tooltip"
          style={{
            left: `${(x(active!) / WIDTH) * 100}%`,
            top: `${(y(shown.value) / HEIGHT) * 100}%`,
          }}
          aria-hidden="true"
        >
          <strong>{fuel.economy(shown.value, economy.unit)}</strong>
          <span>{displayDate(shown.entry.date)}</span>
        </div>
      )}
    </div>
  );
}
