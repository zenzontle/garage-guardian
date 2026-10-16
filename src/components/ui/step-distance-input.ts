import type { KeyboardEvent } from 'react';

export function stepDistanceInput(
  event: KeyboardEvent<HTMLInputElement>,
  step: number,
  onChange: (value: string) => void,
) {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
  event.preventDefault();
  const input = event.currentTarget;
  const value = Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : 0;
  const min = input.min === '' ? -Infinity : Number(input.min);
  const max = input.max === '' ? Infinity : Number(input.max);
  const next = value + (event.key === 'ArrowUp' ? step : -step);
  onChange(String(Math.min(max, Math.max(min, next))));
}
