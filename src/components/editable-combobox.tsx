'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { rankVehicleSuggestions, type CatalogEntry } from '@/lib/vehicle-catalog';

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  suggestions: CatalogEntry[];
  placeholder?: string;
  loading?: boolean;
  failed?: boolean;
  onRetry: () => void;
};

export function EditableCombobox({
  label,
  value,
  onChange,
  suggestions,
  placeholder,
  loading,
  failed,
  onRetry,
}: Props) {
  const t = useTranslations();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const matches = useMemo(() => rankVehicleSuggestions(suggestions, value), [suggestions, value]);
  const expanded = open && matches.length > 0;
  const activeIndex = expanded && active < matches.length ? active : -1;
  useEffect(() => {
    list.current?.children[activeIndex]?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex]);
  function choose(entry: CatalogEntry) {
    onChange(entry.display_name);
    setOpen(false);
    setActive(-1);
    input.current?.focus();
  }

  return (
    <div className="combobox-field">
      <label htmlFor={id}>{label}</label>
      <div className="combobox-control">
        <input
          ref={input}
          id={id}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={expanded ? `${id}-list` : undefined}
          aria-activedescendant={activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
          aria-describedby={failed ? `${id}-help` : undefined}
          aria-busy={loading || undefined}
          autoComplete="off"
          value={value}
          placeholder={placeholder}
          required
          maxLength={50}
          onFocus={() => {
            setOpen(true);
            setActive(-1);
          }}
          onClick={() => setOpen(true)}
          onBlur={() => {
            setOpen(false);
            setActive(-1);
          }}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && matches.length) {
              event.preventDefault();
              setOpen(true);
              setActive(
                event.key === 'ArrowDown'
                  ? (activeIndex + 1) % matches.length
                  : activeIndex <= 0
                    ? matches.length - 1
                    : activeIndex - 1,
              );
            } else if (event.key === 'Enter' && expanded) {
              event.preventDefault();
              if (activeIndex >= 0) choose(matches[activeIndex]);
              else {
                setOpen(false);
                setActive(-1);
              }
            } else if (event.key === 'Escape' && expanded) {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              setActive(-1);
            } else if (event.key === 'Tab') {
              setOpen(false);
              setActive(-1);
            }
          }}
        />
        {expanded && (
          <ul
            ref={list}
            id={`${id}-list`}
            role="listbox"
            aria-label={t('autocomplete.suggestions', { label })}
            className="combobox-list"
          >
            {matches.map((entry, index) => (
              <li
                id={`${id}-option-${index}`}
                key={entry.id}
                role="option"
                aria-selected={index === activeIndex}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => choose(entry)}
              >
                {entry.display_name}
              </li>
            ))}
          </ul>
        )}
      </div>
      {failed && (
        <span id={`${id}-help`} className="combobox-help" role="status">
          {t('autocomplete.unavailable')}
        </span>
      )}
      {failed && (
        <button type="button" className="combobox-retry" onClick={onRetry}>
          {t('autocomplete.retry', { label: label.toLowerCase() })}
        </button>
      )}
    </div>
  );
}
