'use client';

import { del, get, set, update } from 'idb-keyval';
import { AppError } from '../utils/app-error';
import { withNamedLock } from '../utils/named-lock';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { LocalRepository, SupabaseRepository, sameRecord } from './repository';
import { normalizeSnapshot, type Photo, type Snapshot } from './model';
import { initializeSnapshotSchedules } from '../maintenance/schedule-defaults';
import { todayISO } from '../utils/today-iso';
import { CURRENCIES } from '../currency/currency';

type Transfer = {
  userId: string;
  status: 'pending' | 'uploading' | 'uploaded';
  snapshot?: Snapshot;
  baselineDate?: string;
};
export type TransferProgress = {
  phase: 'records' | 'uploading' | 'verifyingPhoto' | 'verifying' | 'cleanup';
  current?: number;
  total?: number;
};
const transferKey = (project: string) => `garage-guardian:signup-transfer:v1:${project}`;
export function pendingTransfer(project: string): Promise<Transfer | undefined> {
  return get<Transfer>(transferKey(project));
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
// Transfer verification and guest cleanup share this lock.
export function withSignupTransferLock<T>(project: string, action: () => Promise<T>) {
  return withNamedLock(transferKey(project), action);
}

export async function transferSignupData(
  client: SupabaseClient,
  project: string,
  userId: string,
  assertActive: () => void = () => {},
  onProgress?: (progress: TransferProgress) => void,
) {
  await withSignupTransferLock(project, () =>
    runTransfer(client, project, userId, assertActive, onProgress),
  );
}

async function runTransfer(
  client: SupabaseClient,
  project: string,
  userId: string,
  assertActive: () => void,
  onProgress?: (progress: TransferProgress) => void,
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
  const snapshot = normalizeSnapshot(transfer.snapshot);

  if (transfer.status !== 'uploaded') {
    // Freeze legacy defaults before any cloud writes; keep the cleanup original unchanged.
    const baselineDate = transfer.baselineDate ?? todayISO();
    if (!transfer.baselineDate) {
      transfer = { ...transfer, baselineDate };
      assertActive();
      await set(transferKey(project), transfer);
    }
    const expected = initializeSnapshotSchedules(
      normalizeSnapshot(structuredClone(snapshot)),
      baselineDate,
    );
    onProgress?.({ phase: 'records' });
    assertActive();
    await cloud.saveHomeCurrency(expected.homeCurrency ?? 'USD');
    const total = [...expected.visits, ...expected.fuelEntries].reduce(
      (sum, record) => sum + record.photos.length,
      0,
    );
    let completed = 0;
    // Each await is a cancellation boundary: never continue under another session.
    for (const car of expected.cars) {
      assertActive();
      await cloud.saveCar(car);
    }
    for (const item of expected.schedules) {
      assertActive();
      await cloud.saveSchedule(item);
    }
    const uploadPhotos = async (record: { id: string; photos: Photo[] }) => {
      for (const photo of record.photos) {
        assertActive();
        const file = await local.readPhoto(photo);
        const path = `${userId}/${record.id}/${photo.id}.webp`;
        assertActive();
        onProgress?.({ phase: 'uploading', current: completed + 1, total });
        const { error } = await client.storage
          .from('visit-photos')
          .upload(path, file, { contentType: photo.contentType, upsert: true });
        if (error) throw error;
        assertActive();
        onProgress?.({ phase: 'verifyingPhoto', current: completed + 1, total });
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
        completed++;
      }
      assertActive();
      onProgress?.({ phase: 'records' });
    };
    for (const visit of expected.visits) {
      await uploadPhotos(visit);
      await cloud.saveVisit(visit, [...CURRENCIES]);
    }
    for (const entry of expected.fuelEntries) {
      await uploadPhotos(entry);
      await cloud.saveFuelEntry(entry);
    }
    assertActive();
    onProgress?.({ phase: 'verifying' });
    const saved = await cloud.load();
    if (saved.homeCurrency !== expected.homeCurrency) throw new AppError('transferVerification');
    for (const key of ['cars', 'schedules', 'visits', 'fuelEntries'] as const) {
      for (const item of expected[key]) {
        if (
          !sameRecord(
            item,
            (saved[key] as { id: string }[]).find((entry) => entry.id === item.id),
          )
        ) {
          throw new AppError('transferVerification');
        }
      }
    }
    assertActive();
    // Durable before guest cleanup: a retry must not upload old records again.
    await set(transferKey(project), { ...transfer, status: 'uploaded' } satisfies Transfer);
  }
  assertActive();
  onProgress?.({ phase: 'cleanup' });
  // Match defaults from frozen inputs without changing the original local photo references.
  const initializedSchedules = transfer.baselineDate
    ? initializeSnapshotSchedules(snapshot, transfer.baselineDate).schedules
    : [];
  await local.clearTransferred(snapshot, initializedSchedules);
  assertActive();
  await del(transferKey(project));
}
