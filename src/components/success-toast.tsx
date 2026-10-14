'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle, X } from 'lucide-react';

export function SuccessToast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const t = useTranslations();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const remaining = useRef(6000);
  useEffect(() => {
    const visibility = () => setHidden(document.hidden);
    visibility();
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  }, []);
  useEffect(() => {
    if (hovered || focused || hidden) return;
    const start = Date.now();
    const timer = setTimeout(onDismiss, remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - start;
    };
  }, [hovered, focused, hidden, onDismiss]);
  return (
    <div
      className="success-toast"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <CheckCircle size={20} aria-hidden="true" />
      <span role="status">{message}</span>
      <button
        type="button"
        className="icon-button"
        aria-label={t('interactions.dismissSuccess')}
        onClick={onDismiss}
      >
        <X size={18} />
      </button>
    </div>
  );
}
