'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  busy = false,
  variant = 'modal',
  id,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  busy?: boolean;
  variant?: 'modal' | 'drawer';
  id?: string;
}) {
  const t = useTranslations();
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    (
      dialog.current?.querySelector<HTMLElement>(
        variant === 'drawer'
          ? 'button:not(:disabled)'
          : '.modal-body input, .modal-body select, .modal-body textarea',
      ) ?? dialog.current
    )?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, [variant]);
  useEffect(() => {
    if (variant !== 'drawer') return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [variant]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);
  return (
    <div
      className={`modal-backdrop${variant === 'drawer' ? ' drawer-backdrop' : ''}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialog}
        id={id}
        tabIndex={-1}
        className={`modal${variant === 'drawer' ? ' profile-drawer' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          const controls = dialog.current?.querySelectorAll<HTMLElement>(
            'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
          );
          if (!controls?.length) return;
          const first = controls[0],
            last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (
            !event.shiftKey &&
            (document.activeElement === last || document.activeElement === dialog.current)
          ) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <div className="modal-header">
          <div>
            <h2>{title}</h2>
          </div>
          <button
            className="icon-button"
            disabled={busy}
            onClick={onClose}
            aria-label={t('shared.close')}
          >
            <X size={20} />
          </button>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}
