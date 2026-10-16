'use client';

import { useCallback, useContext, useEffect, useId, useRef } from 'react';
import { InteractionContext } from './interaction-provider';

/** Compare editable data only: generated IDs, errors and presentation state are not drafts. */
export function useFormInteraction(
  value: unknown,
  {
    busy = false,
    enabled = true,
    group,
    onDiscard,
  }: {
    busy?: boolean;
    enabled?: boolean;
    group?: string;
    onDiscard?: () => void;
  } = {},
) {
  const interactions = useContext(InteractionContext);
  const id = useId();
  const serialized = JSON.stringify(value);
  const baseline = useRef(serialized);
  const valueRef = useRef(value);
  valueRef.current = value;
  const lock = useRef(false);
  const current = useRef({ dirty: false, busy: false, group, discard: () => {} });
  const accept = useCallback(
    (...args: [unknown?]) => {
      baseline.current = JSON.stringify(args.length ? args[0] : valueRef.current);
      current.current.dirty = false;
      interactions?.syncProtection();
    },
    [interactions],
  );
  current.current = {
    dirty: enabled && serialized !== baseline.current,
    busy: enabled && (busy || lock.current),
    group,
    discard: () => {
      current.current.dirty = false;
      onDiscard?.();
    },
  };
  useEffect(() => interactions?.register(id, () => current.current), [interactions, id]);
  useEffect(() => {
    interactions?.syncProtection();
  }, [interactions, serialized, busy, enabled]);
  return {
    accept,
    begin: () => {
      if (lock.current || busy) return false;
      lock.current = true;
      current.current.busy = true;
      interactions?.syncProtection();
      return true;
    },
    end: () => {
      lock.current = false;
      current.current.busy = false;
      interactions?.syncProtection();
    },
    request: (action: () => void) => {
      if (current.current.busy) return;
      if (interactions) interactions.request(action, id);
      else action();
    },
  };
}
