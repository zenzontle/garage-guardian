'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslations } from 'next-intl';
import { failureOf, type AppFailure } from '@/lib/app-error';
import { Modal } from './modal';
import { SuccessToast } from './success-toast';
import { installHistoryGuard } from '@/lib/history-guard';

type FormState = { dirty: boolean; busy: boolean; group?: string; discard: () => void };
type SuccessKey =
  | 'interactions.carSaved'
  | 'interactions.taskSaved'
  | 'interactions.visitSaved'
  | 'interactions.carDeleted'
  | 'interactions.taskDeleted'
  | 'interactions.visitDeleted';
type DeleteRequest = {
  title: string;
  description: string;
  onDelete: () => Promise<void>;
  success: SuccessKey;
};
type Interactions = {
  register: (id: string, read: () => FormState) => () => void;
  syncProtection: () => void;
  request: (action: () => void, scope?: string) => void;
  notify: (key: SuccessKey) => void;
  confirmDelete: (request: DeleteRequest) => void;
  clear: () => void;
};
export const InteractionContext = createContext<Interactions | null>(null);
export function useInteractions() {
  return useContext(InteractionContext);
}

export function InteractionProvider({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const descriptionId = useId();
  const forms = useRef(new Map<string, () => FormState>());
  const pending = useRef<{ action: () => void; ids: string[] } | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [deletion, setDeletion] = useState<DeleteRequest | null>(null);
  const deleting = useRef(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<AppFailure | null>(null);
  const [toast, setToast] = useState<{ key: SuccessKey; id: number } | null>(null);
  const toastSequence = useRef(0);
  const generation = useRef(0);
  const dismissToast = useCallback(() => setToast(null), []);
  const selected = useCallback(
    (scope?: string) =>
      [...forms.current].filter(([id, read]) => !scope || id === scope || read().group === scope),
    [],
  );
  const blocked = useCallback(
    () =>
      deleting.current ||
      [...forms.current.values()].some((read) => {
        const state = read();
        return state.dirty || state.busy;
      }),
    [],
  );
  const beforeUnload = useCallback(
    (event: BeforeUnloadEvent) => {
      if (!blocked()) return;
      event.preventDefault();
      event.returnValue = '';
    },
    [blocked],
  );
  const syncProtection = useCallback(() => {
    if (blocked()) window.addEventListener('beforeunload', beforeUnload);
    else window.removeEventListener('beforeunload', beforeUnload);
  }, [blocked, beforeUnload]);
  const request = useCallback(
    (action: () => void, scope?: string) => {
      if (pending.current || deleting.current) return;
      const entries = selected(scope);
      if (entries.some(([, read]) => read().busy)) return;
      const dirty = entries.filter(([, read]) => read().dirty);
      if (!dirty.length) {
        action();
        return;
      }
      pending.current = { action, ids: dirty.map(([id]) => id) };
      setDiscardOpen(true);
    },
    [selected],
  );
  const cancelDiscard = useCallback(() => {
    pending.current = null;
    setDiscardOpen(false);
  }, []);
  const value = useMemo<Interactions>(
    () => ({
      register: (id, read) => {
        forms.current.set(id, read);
        syncProtection();
        return () => {
          forms.current.delete(id);
          syncProtection();
        };
      },
      request,
      syncProtection,
      notify: (key) => setToast({ key, id: ++toastSequence.current }),
      confirmDelete: (next) =>
        request(() => {
          setDeleteError(null);
          setDeletion(next);
        }),
      clear: () => {
        generation.current++;
        forms.current.forEach((read) => read().discard());
        pending.current = null;
        setDiscardOpen(false);
        setDeletion(null);
        setToast(null);
        syncProtection();
      },
    }),
    [request, syncProtection],
  );
  useEffect(() => {
    const uninstall = installHistoryGuard(blocked, request);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      uninstall();
    };
  }, [blocked, request, beforeUnload]);
  async function remove() {
    if (!deletion || deleting.current) return;
    const version = generation.current;
    deleting.current = true;
    syncProtection();
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deletion.onDelete();
      if (version !== generation.current) return;
      value.notify(deletion.success);
      setDeletion(null);
    } catch (cause) {
      if (version === generation.current) setDeleteError(failureOf(cause, 'save'));
    } finally {
      deleting.current = false;
      syncProtection();
      setDeleteBusy(false);
    }
  }
  return (
    <InteractionContext.Provider value={value}>
      {children}
      {toast && <SuccessToast key={toast.id} message={t(toast.key)} onDismiss={dismissToast} />}
      {deletion && (
        <Modal
          title={deletion.title}
          busy={deleteBusy}
          onClose={() => setDeletion(null)}
          role="alertdialog"
          initialFocus=".modal-footer .secondary"
          descriptionId={`${descriptionId}-delete`}
        >
          <div className="modal-body">
            <p id={`${descriptionId}-delete`}>{deletion.description}</p>
            {deleteError && (
              <p role="alert" className="error-text">
                {t('interactions.deleteFailed')}
              </p>
            )}
            {deleteBusy && <p role="status">{t('interactions.deleting')}</p>}
          </div>
          <div className="modal-footer">
            <button
              type="button"
              className="button secondary"
              disabled={deleteBusy}
              onClick={() => setDeletion(null)}
            >
              {t('shared.cancel')}
            </button>
            <button
              type="button"
              className="button danger"
              disabled={deleteBusy}
              onClick={() => void remove()}
            >
              {t(deleteBusy ? 'interactions.deleting' : 'interactions.delete')}
            </button>
          </div>
        </Modal>
      )}
      {discardOpen && (
        <Modal
          title={t('interactions.unsavedTitle')}
          onClose={cancelDiscard}
          role="alertdialog"
          initialFocus=".modal-footer .secondary"
          descriptionId={`${descriptionId}-discard`}
        >
          <div className="modal-body">
            <p id={`${descriptionId}-discard`}>{t('interactions.unsavedDescription')}</p>
          </div>
          <div className="modal-footer">
            <button type="button" className="button secondary" onClick={cancelDiscard}>
              {t('interactions.keepEditing')}
            </button>
            <button
              type="button"
              className="button danger"
              onClick={() => {
                const transition = pending.current;
                if (!transition) return;
                pending.current = null;
                setDiscardOpen(false);
                transition.ids.forEach((id) => forms.current.get(id)?.().discard());
                syncProtection();
                transition.action();
              }}
            >
              {t('interactions.discard')}
            </button>
          </div>
        </Modal>
      )}
    </InteractionContext.Provider>
  );
}
