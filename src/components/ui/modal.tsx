'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { isTopDialog, useDialogFocus } from '../interaction/dialog-focus';
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
  role = 'dialog',
  initialFocus,
  descriptionId,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  busy?: boolean;
  variant?: 'modal' | 'drawer';
  id?: string;
  role?: 'dialog' | 'alertdialog';
  initialFocus?: string;
  descriptionId?: string;
}) {
  const t = useTranslations();
  const dialog = useRef<HTMLDivElement>(null);
  useDialogFocus(
    dialog,
    true,
    initialFocus ??
      (variant === 'drawer'
        ? 'button:not(:disabled)'
        : '.modal-body input:not(:disabled), .modal-body select:not(:disabled), .modal-body textarea:not(:disabled)'),
  );
  const close = () => {
    if (!busy && isTopDialog(dialog.current)) onClose();
  };
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && isTopDialog(dialog.current)) {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });
  return createPortal(
    <div
      className={`modal-backdrop${variant === 'drawer' ? ' drawer-backdrop' : ''}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={dialog}
        id={id}
        tabIndex={-1}
        className={`modal${variant === 'drawer' ? ' profile-drawer' : ''}`}
        role={role}
        aria-modal="true"
        aria-label={title}
        aria-describedby={descriptionId}
        aria-busy={busy}
        onKeyDown={(event) => {
          if (event.key !== 'Tab' || !isTopDialog(dialog.current)) return;
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
            type="button"
            onClick={close}
            aria-label={t('shared.close')}
          >
            <X size={20} />
          </button>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
