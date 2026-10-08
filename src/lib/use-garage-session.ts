'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppError, failureOf, type AppFailure } from './app-error';
import type { User } from '@supabase/supabase-js';
import { EMPTY_SNAPSHOT, type Snapshot } from './model';
import { createRepository, supabase, type Repository } from './repository';
import { pendingTransfer, registerSignup, transferSignupData } from './signup-transfer';
import { recordDiagnostic } from './bug-reports/diagnostics';

export type MutationResult = { refreshed: boolean };

export function useGarageSession() {
  const [repository, setRepository] = useState<Repository | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY_SNAPSHOT);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [transferring, setTransferring] = useState(false);
  const [error, setError] = useState<AppFailure | null>(null);
  const [refreshError, setRefreshError] = useState<AppFailure | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const generation = useRef(0);
  const operations = useRef(new Set<Promise<unknown>>());
  const signupWork = useRef<Promise<unknown> | null>(null);
  const transition = useRef<(user: User | null, force?: boolean) => void>(() => {});
  const currentUser = useRef<User | null>(null);
  const retry = useRef<() => void>(() => {});
  const mutationBusy = useRef(false);
  const project = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';

  useEffect(() => {
    const sessionGeneration = generation;
    let active = true;
    let identity: string | null | undefined;
    const receive = (nextUser: User | null, force = false) => {
      const nextIdentity = nextUser?.id ?? null;
      if (!active || (!force && identity === nextIdentity)) return;
      identity = nextIdentity;
      currentUser.current = nextUser;
      const version = ++sessionGeneration.current;
      const assertActive = () => {
        if (!active || sessionGeneration.current !== version) throw new AppError('sessionChanged');
      };
      setUser(nextUser);
      setRepository(null);
      setSnapshot(EMPTY_SNAPSHOT);
      setError(null);
      setRefreshError(null);
      setRefreshing(false);
      setLoading(true);
      setTransferring(false);

      // The auth callback only schedules work; Supabase calls happen after it returns.
      setTimeout(() => {
        void (async () => {
          let failureContext: 'load' | 'transfer' = 'load';
          try {
            await signupWork.current;
            await Promise.allSettled([...operations.current]);
            assertActive();
            if (supabase && nextUser) {
              const pending = await pendingTransfer(project);
              assertActive();
              setTransferring(pending?.userId === nextUser.id);
              if (pending?.userId === nextUser.id) failureContext = 'transfer';
              await transferSignupData(supabase, project, nextUser.id, assertActive);
              failureContext = 'load';
            }
            assertActive();
            const backend = createRepository(nextUser?.id);
            const data = await backend.load();
            assertActive();
            const guarded = new Proxy(backend, {
              get(target, property: keyof Repository) {
                return (...args: unknown[]) => {
                  const work = (async () => {
                    assertActive();
                    const method = target[property] as (...args: unknown[]) => Promise<unknown>;
                    const result = await method.apply(target, args);
                    assertActive();
                    return result;
                  })();
                  operations.current.add(work);
                  void work.finally(() => operations.current.delete(work)).catch(() => {});
                  return work;
                };
              },
            });
            setSnapshot(data);
            setRepository(guarded);
            setTransferring(false);
          } catch (cause) {
            if (active && sessionGeneration.current === version)
              setError(failureOf(cause, failureContext));
          } finally {
            if (active && sessionGeneration.current === version) setLoading(false);
          }
        })();
      }, 0);
    };
    transition.current = receive;
    retry.current = () => receive(currentUser.current, true);
    if (!supabase) receive(null);
    else {
      const client = supabase;
      const { data: listener } = client.auth.onAuthStateChange((_event, session) =>
        receive(session?.user ?? null),
      );
      const initialize = async () => {
        try {
          const { data, error } = await client.auth.getSession();
          if (!active || identity !== undefined) return;
          if (error) throw error;
          receive(data.session?.user ?? null);
        } catch (cause) {
          if (active && identity === undefined) {
            setError(failureOf(cause, 'load'));
            setLoading(false);
          }
        }
      };
      retry.current = () => {
        if (identity === undefined) void initialize();
        else receive(currentUser.current, true);
      };
      void initialize();
      return () => {
        active = false;
        ++sessionGeneration.current;
        listener.subscription.unsubscribe();
      };
    }
    return () => {
      active = false;
      ++sessionGeneration.current;
    };
  }, [project]);

  const reloadSnapshot = useCallback(
    async (version: number): Promise<boolean> => {
      if (!repository || generation.current !== version) return false;
      setRefreshing(true);
      try {
        const data = await repository.load();
        if (generation.current !== version) return false;
        setSnapshot(data);
        setRefreshError(null);
        return true;
      } catch (cause) {
        if (generation.current === version) {
          recordDiagnostic(cause);
          setRefreshError({ code: 'refresh' });
        }
        return false;
      } finally {
        if (generation.current === version) setRefreshing(false);
      }
    },
    [repository],
  );

  const run = useCallback(
    async (action: () => Promise<void>): Promise<MutationResult> => {
      if (!repository || mutationBusy.current) throw new AppError('operationBusy');
      mutationBusy.current = true;
      const version = generation.current;
      setError(null);
      const work = (async () => {
        try {
          await action();
        } catch (cause) {
          if (generation.current === version) setError(failureOf(cause, 'save'));
          throw cause;
        }
        // A failed reload cannot undo a successful mutation.
        return { refreshed: await reloadSnapshot(version) };
      })();
      operations.current.add(work);
      try {
        return await work;
      } finally {
        mutationBusy.current = false;
        operations.current.delete(work);
      }
    },
    [repository, reloadSnapshot],
  );

  const refresh = useCallback(async (): Promise<void> => {
    if (!repository || mutationBusy.current) return;
    mutationBusy.current = true;
    const work = reloadSnapshot(generation.current);
    operations.current.add(work);
    try {
      await work;
    } finally {
      mutationBusy.current = false;
      operations.current.delete(work);
    }
  }, [repository, reloadSnapshot]);

  async function signUp(email: string, password: string): Promise<boolean> {
    if (!supabase) throw new AppError('cloudNotConfigured');
    if (signupWork.current) throw new AppError('signupBusy');
    const client = supabase;
    const work = (async () => {
      const pending = await pendingTransfer(project);
      if (pending) throw new AppError('previousTransfer');
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
      if (data.user) await registerSignup(project, data.user, Boolean(data.session));
      if (data.session) transition.current(data.session.user, true);
      return !data.session;
    })();
    signupWork.current = work;
    try {
      return await work;
    } finally {
      signupWork.current = null;
    }
  }

  async function signIn(email: string, password: string) {
    if (!supabase) throw new AppError('cloudNotConfigured');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    transition.current(data.user);
  }

  async function signOut() {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) setError(failureOf(error, 'auth'));
    else transition.current(null);
  }

  return {
    repository,
    snapshot,
    user,
    loading,
    transferring,
    error,
    setError,
    refreshError,
    setRefreshError,
    refreshing,
    refresh,
    run,
    signUp,
    signIn,
    signOut,
    retry: () => retry.current(),
  };
}
