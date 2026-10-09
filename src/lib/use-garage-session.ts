'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppError, failureOf, type AppFailure } from './app-error';
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js';
import { EMPTY_SNAPSHOT, type Snapshot } from './model';
import { createRepository, recoveryInitialization, supabase, type Repository } from './repository';
import {
  pendingTransfer,
  registerSignup,
  transferSignupData,
  withSignupTransferLock,
} from './signup-transfer';
import { recordDiagnostic } from './bug-reports/diagnostics';
import {
  clearAuthCallback,
  clearRecovery,
  rememberRecovery,
  sameRecoverySession,
  storedRecovery,
} from './account-recovery';
import type { AccountPatch } from './account-contract';
import { signOutPasswordSession, updateRecoveryPassword } from './account-session';
import en from '../../messages/en.json';

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
  const [recovering, setRecovering] = useState(false);
  const recoverySession = useRef<Session | null>(null);
  const recoveryFinishing = useRef(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const accountLock = useRef(false);
  const transferBlocked = useRef(false);
  const [accountNotice, setAccountNotice] = useState<'passwordChanged' | null>(null);
  const [resendUntil, setResendUntil] = useState(0);
  const resendDeadline = useRef(0);
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
      if (!active) return;
      if (nextUser) setAccountNotice(null);
      if (recoverySession.current && nextUser?.id === recoverySession.current.user.id) {
        currentUser.current = nextUser;
        setUser(nextUser);
        return;
      }
      if (recoverySession.current || (identity !== undefined && identity !== nextIdentity)) {
        clearRecovery();
        recoverySession.current = null;
        recoveryFinishing.current = false;
        setRecovering(false);
      }
      if (!force && identity === nextIdentity) {
        currentUser.current = nextUser;
        setUser(nextUser);
        return;
      }
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
      transferBlocked.current = Boolean(nextUser);

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
              transferBlocked.current = pending?.userId === nextUser.id;
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
            transferBlocked.current = false;
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
      const startRecovery = (session: Session, finishing = false) => {
        if (!active) return;
        identity = session.user.id;
        ++sessionGeneration.current;
        currentUser.current = session.user;
        recoverySession.current = session;
        recoveryFinishing.current = finishing;
        rememberRecovery(session, finishing);
        setRecovering(true);
        setUser(session.user);
        setRepository(null);
        setSnapshot(EMPTY_SNAPSHOT);
        setLoading(false);
        setTransferring(false);
        setError(null);
        setRefreshError(null);
        setRefreshing(false);
        clearAuthCallback();
      };
      let bootstrapped = false;
      const ready = recoveryInitialization.then(() => {
        bootstrapped = true;
      });
      const handleAuth = (event: AuthChangeEvent, session: Session | null) => {
        if (!active) return;
        const stored = session ? storedRecovery(session) : null;
        const currentRecovery = recoverySession.current;
        if (
          session &&
          (event === 'PASSWORD_RECOVERY' ||
            stored ||
            (currentRecovery && sameRecoverySession(currentRecovery, session)))
        ) {
          startRecovery(session, stored?.finishing ?? recoveryFinishing.current);
        } else {
          if (event === 'INITIAL_SESSION') clearAuthCallback();
          if (currentRecovery) {
            clearRecovery();
            recoverySession.current = null;
            recoveryFinishing.current = false;
            setRecovering(false);
          }
          receive(session?.user ?? null, Boolean(currentRecovery));
        }
      };
      const { data: listener } = client.auth.onAuthStateChange((event, session) => {
        if (bootstrapped) handleAuth(event, session);
        else void ready.then(() => handleAuth(event, session));
      });
      const initialize = async () => {
        try {
          await ready;
          const { data, error } = await client.auth.getSession();
          if (!active || identity !== undefined) return;
          if (error) throw error;
          const stored = data.session ? storedRecovery(data.session) : null;
          if (data.session && stored) startRecovery(data.session, stored.finishing);
          else {
            clearRecovery();
            receive(data.session?.user ?? null);
          }
          clearAuthCallback();
        } catch (cause) {
          if (active && identity === undefined) {
            clearAuthCallback();
            clearRecovery();
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
      if (!repository || mutationBusy.current || recoverySession.current)
        throw new AppError('operationBusy');
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
    const work = withSignupTransferLock(project, async () => {
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
    });
    signupWork.current = work;
    try {
      return await work;
    } finally {
      signupWork.current = null;
    }
  }

  async function signIn(email: string, password: string) {
    if (!supabase) throw new AppError('cloudNotConfigured');
    const wasRecovering = Boolean(recoverySession.current);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    clearRecovery();
    recoverySession.current = null;
    setRecovering(false);
    transition.current(data.user, wasRecovering);
  }

  async function signOut(scope: 'global' | 'local' = 'global') {
    if (!supabase) return true;
    if (accountLock.current) return false;
    try {
      const { error } = await supabase.auth.signOut({ scope });
      if (error) {
        setError(failureOf(error, 'auth'));
        return false;
      }
      transition.current(null);
      return true;
    } catch {
      setError({ code: 'auth' });
      return false;
    }
  }

  async function requestRecovery(email: string) {
    if (!supabase) throw new AppError('cloudNotConfigured');
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: new URL('/auth/recovery', window.location.origin).href,
    });
    if (error && !['user_not_found', 'email_not_found'].includes(error.code ?? ''))
      throw new AppError(failureOf({ code: error.code }, 'auth').code);
  }

  async function resendConfirmation(email: string) {
    if (!supabase) throw new AppError('cloudNotConfigured');
    if (Date.now() < resendDeadline.current) throw new AppError('resendCooldown');
    resendDeadline.current = Date.now() + 60_000;
    setResendUntil(resendDeadline.current);
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: new URL('/', window.location.origin).href },
    });
    if (error && !['user_not_found', 'email_not_found'].includes(error.code ?? ''))
      throw new AppError(failureOf({ code: error.code }, 'auth').code);
  }

  async function accountOperation(action: () => Promise<void>, recovery = false) {
    if (!supabase) throw new AppError('cloudNotConfigured');
    if (accountLock.current || (!recovery && (transferBlocked.current || recoverySession.current)))
      throw new AppError('operationBusy');
    accountLock.current = true;
    setAccountBusy(true);
    try {
      await action();
    } finally {
      accountLock.current = false;
      setAccountBusy(false);
    }
  }

  async function requestAccount(input: AccountPatch) {
    const version = generation.current;
    const { data, error } = await supabase!.auth.getSession();
    if (error || !data.session || data.session.user.id !== currentUser.current?.id)
      throw new AppError('sessionExpired');
    const response = await fetch('/api/account', {
      method: 'PATCH',
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    });
    if (generation.current !== version) throw new AppError('sessionChanged');
    if (!response.ok) {
      const body = (await response.json()) as { error?: { code?: string } };
      const code = body.error?.code;
      throw new AppError(
        code && Object.hasOwn(en.errors, code) ? (code as keyof typeof en.errors) : 'auth',
      );
    }
    return data.session;
  }

  async function finishPasswordChange(session: Session, global: boolean) {
    try {
      await signOutPasswordSession(supabase!, session, global ? 'global' : 'local');
    } catch (cause) {
      setError(failureOf(cause, 'auth'));
      throw cause;
    }
    if (currentUser.current && currentUser.current.id !== session.user.id)
      throw new AppError('sessionChanged');
    clearRecovery();
    recoverySession.current = null;
    recoveryFinishing.current = false;
    setRecovering(false);
    transition.current(null, true);
    setAccountNotice('passwordChanged');
  }

  async function resetPassword(password: string, confirmation: string) {
    if (!recoverySession.current) throw new AppError('recoveryInvalid');
    const session = recoverySession.current;
    if (password !== confirmation) throw new AppError('passwordMismatch');
    if (password.length < 6) throw new AppError('weakPassword');
    await accountOperation(async () => {
      if (!recoveryFinishing.current) {
        await updateRecoveryPassword(supabase!, session, password);
        if (!recoverySession.current || !sameRecoverySession(session, recoverySession.current))
          throw new AppError('sessionChanged');
        recoveryFinishing.current = true;
        rememberRecovery(recoverySession.current!, true);
      }
      await finishPasswordChange(session, true);
    }, true);
  }

  async function cancelRecovery() {
    const session = recoverySession.current;
    if (!session) return;
    await accountOperation(async () => {
      await signOutPasswordSession(supabase!, session, 'local');
      if (recoverySession.current && sameRecoverySession(session, recoverySession.current)) {
        clearRecovery();
        recoverySession.current = null;
        recoveryFinishing.current = false;
        setRecovering(false);
        transition.current(null, true);
      }
    }, true);
  }

  async function changeEmail(currentPassword: string, newEmail: string) {
    await accountOperation(async () => {
      const userId = currentUser.current?.id;
      await requestAccount({ kind: 'email', currentPassword, newEmail });
      const { data, error } = await supabase!.auth.getUser();
      if (error) throw new AppError('auth');
      if (currentUser.current?.id !== userId) throw new AppError('sessionChanged');
      if (data.user?.id === userId) {
        currentUser.current = data.user;
        setUser(data.user);
      }
    });
  }

  async function changePassword(
    currentPassword: string,
    newPassword: string,
    confirmation: string,
  ) {
    if (newPassword !== confirmation) throw new AppError('passwordMismatch');
    if (newPassword.length < 6) throw new AppError('weakPassword');
    await accountOperation(async () => {
      const session = await requestAccount({
        kind: 'password',
        currentPassword,
        newPassword,
      });
      await finishPasswordChange(session, false);
    });
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
    recovering,
    accountBusy,
    accountNotice,
    setAccountNotice,
    resendUntil,
    requestRecovery,
    resendConfirmation,
    resetPassword,
    cancelRecovery,
    changeEmail,
    changePassword,
    retry: () => retry.current(),
  };
}
