'use client';

import { del, get, set, update } from 'idb-keyval';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { LocalRepository, SupabaseRepository, sameRecord } from './repository';
import type { Snapshot } from './model';

type Transfer = {
  userId: string;
  status: 'pending' | 'uploading' | 'uploaded';
  snapshot?: Snapshot;
};
const transferKey = (project: string) => `garage-guardian:signup-transfer:v1:${project}`;

export async function pendingTransfer(project: string): Promise<Transfer | undefined> {
  return get<Transfer>(transferKey(project));
}

export async function registerSignup(project: string, user: User, hasSession: boolean) {
  // Supabase can return an obfuscated user with no identities for an existing email.
  if (!hasSession && !user.identities?.length) return;
  await update<Transfer>(transferKey(project), (previous) => {
    if (previous && previous.userId !== user.id) throw new Error('Finish the previous account transfer before creating another account.');
    return previous ?? { userId: user.id, status: 'pending' };
  });
}

// Also serializes duplicate requests from React Strict Mode in this tab.
const transfers = new Map<string, Promise<void>>();

export async function transferSignupData(client: SupabaseClient, project: string, userId: string, assertActive: () => void = () => {}) {
  const key = transferKey(project);
  const previous = transfers.get(key);
  if (previous) {
    await previous.catch(() => undefined);
    assertActive();
    return transferSignupData(client, project, userId, assertActive);
  }
  const work = (async () => {
    if (typeof navigator !== 'undefined' && navigator.locks) {
      await navigator.locks.request(key, () => runTransfer(client, project, userId, assertActive));
    } else await runTransfer(client, project, userId, assertActive);
  })();
  transfers.set(key, work);
  try { await work; }
  finally { if (transfers.get(key) === work) transfers.delete(key); }
}

async function runTransfer(client: SupabaseClient, project: string, userId: string, assertActive: () => void) {
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
  const snapshot = transfer.snapshot;
  if (!snapshot) throw new Error('The transfer could not be resumed. Your browser data has been kept.');

  if (transfer.status !== 'uploaded') {
    const expected = structuredClone(snapshot);
    // Each await is a cancellation boundary: never continue under another session.
    for (const car of expected.cars) { assertActive(); await cloud.saveCar(car); }
    for (const item of expected.schedules) { assertActive(); await cloud.saveSchedule(item); }
    for (const visit of expected.visits) {
      for (const photo of visit.photos) {
        assertActive();
        const file = await local.readPhoto(photo);
        const path = `${userId}/${visit.id}/${photo.id}.webp`;
        assertActive();
        const { error } = await client.storage.from('visit-photos').upload(path, file, { contentType: photo.contentType, upsert: true });
        if (error) throw error;
        assertActive();
        const { data: uploaded, error: readError } = await client.storage.from('visit-photos').download(path);
        if (readError) throw readError;
        if (!uploaded || uploaded.size !== file.size) throw new Error('A photo upload could not be verified. Your browser data has been kept.');
        const [originalBytes, uploadedBytes] = await Promise.all([file.arrayBuffer(), uploaded.arrayBuffer()]);
        const verifiedBytes = new Uint8Array(uploadedBytes);
        if (!new Uint8Array(originalBytes).every((byte, index) => byte === verifiedBytes[index])) {
          throw new Error('A photo upload could not be verified. Your browser data has been kept.');
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
        if (!sameRecord(item, saved[key].find((entry) => entry.id === item.id))) {
          throw new Error('The upload could not be verified. Your browser data has been kept. Retry the transfer.');
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
