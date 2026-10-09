'use client';

import { del, get, set, update } from 'idb-keyval';
import { AppError } from './app-error';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { LocalRepository, SupabaseRepository, sameRecord } from './repository';
import { normalizeSnapshot, type Snapshot } from './model';

type Transfer = {
  userId: string;
  status: 'pending' | 'uploading' | 'uploaded';
  snapshot?: Snapshot;
};
const transferKey = (project: string) => `garage-guardian:signup-transfer:v1:${project}`;
const deletionPrefix = (project: string) => `garage-guardian:deleted-transfer:v1:${project}:`;
const deletedTransfers = new Map<string, Set<string>>();

// Record only confirmed Auth deletions, before best-effort IndexedDB cleanup.
// Separate keys avoid overwriting another tab's cleanup retry.
export function rememberDeletedAccountTransfer(project: string, userId: string) {
  const users = deletedTransfers.get(project) ?? new Set<string>();
  users.add(userId);
  deletedTransfers.set(project, users);
  try {
    localStorage.setItem(`${deletionPrefix(project)}${userId}`, 'confirmed');
  } catch {
    // Keep an in-memory retry when browser storage is unavailable.
  }
}

export async function pendingTransfer(project: string): Promise<Transfer | undefined> {
  const users = new Set(deletedTransfers.get(project));
  try {
    const prefix = deletionPrefix(project);
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key?.startsWith(prefix)) users.add(key.slice(prefix.length));
    }
  } catch {
    // In-memory retries remain available when localStorage cannot be read.
  }
  for (const userId of users) await clearAccountTransfer(project, userId);
  return get<Transfer>(transferKey(project));
}

export async function clearAccountTransfer(project: string, userId: string) {
  await update<Transfer | undefined>(transferKey(project), (previous) =>
    previous?.userId === userId ? undefined : previous,
  );
  deletedTransfers.get(project)?.delete(userId);
  try {
    localStorage.removeItem(`${deletionPrefix(project)}${userId}`);
  } catch {
    // A remaining journal entry safely retries the same owner-scoped cleanup.
  }
}

export async function registerSignup(project: string, user: User, hasSession: boolean) {
  // Supabase can return an obfuscated user with no identities for an existing email.
  if (!hasSession && !user.identities?.length) return;
  await update<Transfer>(transferKey(project), (previous) => {
    if (previous && previous.userId !== user.id) throw new AppError('previousTransfer');
    return previous ?? { userId: user.id, status: 'pending' };
  });
}

// Signup must acquire this before its auth event can reach another tab.
// Deletion shares it with transfer verification and guest cleanup.
const transfers = new Map<string, Promise<unknown>>();

export async function withSignupTransferLock<T>(project: string, action: () => Promise<T>) {
  const key = transferKey(project);
  const previous = transfers.get(key);
  const work = (async () => {
    await previous?.catch(() => undefined);
    if (typeof navigator !== 'undefined' && navigator.locks) {
      return navigator.locks.request(key, action);
    }
    return action();
  })();
  transfers.set(key, work);
  try {
    return await work;
  } finally {
    if (transfers.get(key) === work) transfers.delete(key);
  }
}

export async function transferSignupData(
  client: SupabaseClient,
  project: string,
  userId: string,
  assertActive: () => void = () => {},
) {
  await withSignupTransferLock(project, () => runTransfer(client, project, userId, assertActive));
}

async function runTransfer(
  client: SupabaseClient,
  project: string,
  userId: string,
  assertActive: () => void,
) {
  let transfer = await pendingTransfer(project);
  assertActive();
  if (!transfer || transfer.userId !== userId) return;

  const local = new LocalRepository();
  const cloud = new SupabaseRepository(client, userId);
  if (transfer.status === 'pending') {
    const snapshot = await local.load();
    assertActive();
    transfer = { ...transfer, status: 'uploading', snapshot };
    await set(transferKey(project), transfer);
  }
  if (!transfer.snapshot) throw new AppError('transferResume');
  const snapshot = transfer.snapshot;

  if (transfer.status !== 'uploaded') {
    // Normalize old pending snapshots for verification; keep the cleanup original frozen.
    const expected = normalizeSnapshot(structuredClone(snapshot));
    // Each await is a cancellation boundary: never continue under another session.
    for (const car of expected.cars) {
      assertActive();
      await cloud.saveCar(car);
    }
    for (const item of expected.schedules) {
      assertActive();
      await cloud.saveSchedule(item);
    }
    for (const visit of expected.visits) {
      for (const photo of visit.photos) {
        assertActive();
        const file = await local.readPhoto(photo);
        const path = `${userId}/${visit.id}/${photo.id}.webp`;
        assertActive();
        const { error } = await client.storage
          .from('visit-photos')
          .upload(path, file, { contentType: photo.contentType, upsert: true });
        if (error) throw error;
        assertActive();
        const { data: uploaded, error: readError } = await client.storage
          .from('visit-photos')
          .download(path);
        if (readError) throw readError;
        if (!uploaded || uploaded.size !== file.size) throw new AppError('photoVerification');
        const [originalBytes, uploadedBytes] = await Promise.all([
          file.arrayBuffer(),
          uploaded.arrayBuffer(),
        ]);
        const verifiedBytes = new Uint8Array(uploadedBytes);
        if (!new Uint8Array(originalBytes).every((byte, index) => byte === verifiedBytes[index])) {
          throw new AppError('photoVerification');
        }
        photo.path = path;
      }
      assertActive();
      await cloud.saveVisit(visit);
    }
    assertActive();
    const saved = await cloud.load();
    for (const key of ['cars', 'schedules', 'visits'] as const) {
      for (const item of expected[key]) {
        if (
          !sameRecord(
            item,
            saved[key].find((entry) => entry.id === item.id),
          )
        ) {
          throw new AppError('transferVerification');
        }
      }
    }
    assertActive();
    // Durable before deletion: a cleanup retry must not upload old records again.
    await set(transferKey(project), { ...transfer, status: 'uploaded' } satisfies Transfer);
  }
  assertActive();
  await local.clearTransferred(snapshot);
  assertActive();
  await del(transferKey(project));
}
