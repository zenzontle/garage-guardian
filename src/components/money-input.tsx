"use client";

import { ChevronDown, ChevronUp } from "lucide-react";

type MoneyInputProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
};

export function MoneyInput({ label, value, onChange, placeholder, required }: MoneyInputProps) {
  function increment(amount: number) {
    const current = Number(value || 0);
    if (!Number.isFinite(current)) return;
    onChange((Math.max(0, Math.round(current * 100) + amount * 100) / 100).toFixed(2));
  }

  return <div className="money-input">
    <input
      aria-label={label}
      type="number"
      inputMode="decimal"
      min="0"
      step="any"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          increment(event.key === "ArrowUp" ? 1 : -1);
        }
      }}
      placeholder={placeholder}
      required={required}
    />
    <div className="money-steppers">
      <button type="button" aria-label={`Increase ${label.toLowerCase()} by one dollar`} onClick={() => increment(1)}><ChevronUp size={12} /></button>
      <button type="button" aria-label={`Decrease ${label.toLowerCase()} by one dollar`} onClick={() => increment(-1)}><ChevronDown size={12} /></button>
    </div>
  </div>;
}
