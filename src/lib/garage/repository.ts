'use client';

import { del, get, set, update } from 'idb-keyval';
import { AppError } from '../utils/app-error';
import { accountAuthStorageKey, serializeAccountSignIns } from '../account/account-session';
import { bootstrapRecovery } from '../account/account-recovery';
import { recordDiagnostic } from '../feedback/diagnostics';
import {
  initializeCloudSchedules,
  initializeSchedule,
  initializeSnapshotSchedules,
} from '../maintenance/schedule-defaults';
import { todayISO } from '../utils/today-iso';
import { connectionFailure, OfflineReceipts } from '../currency/offline-receipts';
import {
  currencyOrDefault,
  isCurrency,
  mergeConversions,
  normalizeVisit,
  receiptInputs,
  sameInputs,
  validConversion,
  validCents,
  validDate,
  type Currency,
  type Conversion,
} from '../currency/currency';
import { createClient, navigatorLock, type SupabaseClient } from '@supabase/supabase-js';
import { checkedFuelEntry } from '../fuel/fuel';
import { fuelFromRow, fuelToRow } from '../fuel/fuel-rows';
import {
  EMPTY_SNAPSHOT,
  normalizeCar,
  normalizePlate,
  normalizeSnapshot,
  type Car,
  type FuelEntry,
  type Photo,
  type ScheduleItem,
  type Snapshot,
  type Visit,
} from './model';

export type Repository = {
  saveHomeCurrency(currency: Currency): Promise<void>;
  saveConversion(visit: Visit, target: Currency, conversion: Conversion): Promise<void>;
  load(): Promise<Snapshot>;
  saveCar(car: Car): Promise<void>;
  setCarArchived(id: string, archived: boolean): Promise<void>;
  deleteCar(id: string): Promise<void>;
  saveSchedule(item: ScheduleItem): Promise<void>;
  deleteSchedule(id: string): Promise<void>;
  saveVisit(visit: Visit, manualTargets?: Currency[]): Promise<void>;
  deleteVisit(visit: Visit): Promise<void>;
  saveFuelEntry(entry: FuelEntry): Promise<void>;
  deleteFuelEntry(entry: FuelEntry): Promise<void>;
  // Photos are stored under the owning visit's or fill-up's ID.
  uploadPhoto(recordId: string, file: File): Promise<Photo>;
  photoUrl(photo: Photo): Promise<string>;
  removePhoto(photo: Photo): Promise<void>;
};

const SNAPSHOT_KEY = 'garage-guardian:local:v1';
const clone = <T>(value: T): T => structuredClone(value);
// Keep load-time initialization provenance private and atomic with the guest records.
type LocalSnapshot = Snapshot & { automaticSchedules?: ScheduleItem[] };

function snapshotData(snapshot: Snapshot): Snapshot {
  return {
    homeCurrency: currencyOrDefault(snapshot.homeCurrency),
    cars: snapshot.cars,
    schedules: snapshot.schedules,
    visits: snapshot.visits,
    fuelEntries: snapshot.fuelEntries ?? [],
  };
}

function checkedVisit(visit: Visit, manualTargets: Currency[]): Visit {
  if (
    !validCents(visit.totalCostCents) ||
    !validDate(visit.date) ||
    (visit.currency !== undefined && !isCurrency(visit.currency)) ||
    visit.items.some((item) => item.costCents !== null && !validCents(item.costCents)) ||
    visit.items.reduce((sum, item) => sum + (item.costCents ?? 0), 0) > visit.totalCostCents
  )
    throw new AppError('visitFields');
  const normalized = normalizeVisit(visit);
  // A copied snapshot is not a manual edit. Only explicitly edited targets may replace overrides.
  normalized.conversions = Object.fromEntries(
    Object.entries(normalized.conversions ?? {}).filter(
      ([target, conversion]) =>
        conversion.source !== 'manual' || manualTargets.includes(target as Currency),
    ),
  );
  return normalized;
}

export class LocalRepository implements Repository {
  async saveHomeCurrency(currency: Currency) {
    if (!isCurrency(currency)) throw new AppError('visitFields');
    await this.write((snapshot) => {
      snapshot.homeCurrency = currency;
    });
  }
  async saveConversion(visit: Visit, target: Currency, conversion: Conversion) {
    if (!isCurrency(target) || !validConversion(conversion, receiptInputs(visit)))
      throw new AppError('visitFields');
    await this.write((snapshot) => {
      const current = snapshot.visits.find((entry) => entry.id === visit.id);
      if (
        !current ||
        !sameInputs(receiptInputs(current), receiptInputs(visit)) ||
        current.conversions?.[target]
      )
        return;
      current.conversions = { ...current.conversions, [target]: conversion };
    });
  }
  async load(): Promise<Snapshot> {
    const snapshot = normalizeSnapshot(
      clone(snapshotData((await get<LocalSnapshot>(SNAPSHOT_KEY)) ?? EMPTY_SNAPSHOT)),
    );
    const today = todayISO();
    if (initializeSnapshotSchedules(snapshot, today) === snapshot) return snapshot;
    let initialized = snapshot;
    await mutateLocalSnapshot((current) => {
      const schedules = initializeSnapshotSchedules(current, today).schedules;
      current.automaticSchedules = [
        ...(current.automaticSchedules ?? []),
        ...schedules.filter((item, index) => item !== current.schedules[index]),
      ];
      current.schedules = schedules;
      initialized = clone(snapshotData(current));
    });
    return initialized;
  }
  private async write(update: (snapshot: LocalSnapshot) => void) {
    await mutateLocalSnapshot(update);
  }
  async saveCar(car: Car) {
    const normalized = { ...normalizeCar(car), plate: normalizePlate(car.plate) };
    return this.write((snapshot) => {
      const current = snapshot.cars.find((entry) => entry.id === car.id);
      snapshot.cars = upsert(snapshot.cars, {
        ...normalized,
        isArchived: current?.isArchived ?? normalized.isArchived,
      });
    });
  }
  async deleteCar(id: string) {
    const snapshot = await this.load();
    for (const record of [...snapshot.visits, ...snapshot.fuelEntries]) {
      if (record.carId !== id) continue;
      for (const photo of record.photos) await del(`photo:${photo.path}`);
    }
    await this.write((current) => {
      current.cars = current.cars.filter((car) => car.id !== id);
      current.schedules = current.schedules.filter((item) => item.carId !== id);
      current.visits = current.visits.filter((visit) => visit.carId !== id);
      current.fuelEntries = current.fuelEntries.filter((entry) => entry.carId !== id);
    });
  }
  async setCarArchived(id: string, archived: boolean) {
    await this.write((snapshot) => {
      const car = snapshot.cars.find((car) => car.id === id);
      if (!car) throw new AppError('archive');
      car.isArchived = archived;
    });
  }
  saveSchedule(item: ScheduleItem) {
    return this.write((snapshot) => {
      const car = snapshot.cars.find((car) => car.id === item.carId);
      snapshot.schedules = upsert(
        snapshot.schedules,
        car
          ? initializeSchedule(item, car, snapshot.visits, todayISO(), snapshot.fuelEntries)
          : item,
      );
    });
  }
  deleteSchedule(id: string) {
    return this.write((snapshot) => {
      snapshot.schedules = snapshot.schedules.filter((item) => item.id !== id);
    });
  }
  async saveVisit(visit: Visit, manualTargets: Currency[] = []) {
    visit = checkedVisit(visit, manualTargets);
    const previous = (await this.load()).visits.find((entry) => entry.id === visit.id);
    await this.write((snapshot) => {
      const current = snapshot.visits.find((entry) => entry.id === visit.id);
      const conversions =
        current && sameInputs(receiptInputs(current), receiptInputs(visit))
          ? mergeConversions(current.conversions, visit.conversions)
          : visit.conversions;
      snapshot.visits = upsert(snapshot.visits, { ...visit, conversions });
    });
    for (const photo of previous?.photos ?? []) {
      if (!visit.photos.some((entry) => entry.path === photo.path))
        await this.removePhoto(photo).catch(recordDiagnostic);
    }
  }
  async deleteVisit(visit: Visit) {
    for (const photo of visit.photos) await del(`photo:${photo.path}`);
    await this.write((snapshot) => {
      snapshot.visits = snapshot.visits.filter((item) => item.id !== visit.id);
    });
  }
  async saveFuelEntry(entry: FuelEntry) {
    entry = checkedFuelEntry(entry);
    const previous = (await this.load()).fuelEntries.find((current) => current.id === entry.id);
    await this.write((snapshot) => {
      snapshot.fuelEntries = upsert(snapshot.fuelEntries, entry);
    });
    for (const photo of previous?.photos ?? []) {
      if (!entry.photos.some((current) => current.path === photo.path))
        await this.removePhoto(photo).catch(recordDiagnostic);
    }
  }
  async deleteFuelEntry(entry: FuelEntry) {
    for (const photo of entry.photos) await del(`photo:${photo.path}`);
    await this.write((snapshot) => {
      snapshot.fuelEntries = snapshot.fuelEntries.filter((item) => item.id !== entry.id);
    });
  }
  async uploadPhoto(recordId: string, file: File): Promise<Photo> {
    const id = crypto.randomUUID();
    const path = `${recordId}/${id}`;
    await set(`photo:${path}`, file);
    return { id, path, name: file.name, contentType: file.type };
  }
  async photoUrl(photo: Photo): Promise<string> {
    const file = await this.readPhoto(photo);
    return URL.createObjectURL(file);
  }
  async readPhoto(photo: Photo): Promise<Blob> {
    const file = await get<Blob>(`photo:${photo.path}`);
    if (!file) throw new AppError('photoMissing', { name: photo.name });
    return file;
  }
  async clearTransferred(transferred: Snapshot, initializedSchedules: ScheduleItem[] = []) {
    transferred = normalizeSnapshot(transferred);
    // Preserve anything edited in another tab or after signing out during a transfer.
    await this.write((current) => {
      const automaticallyInitialized = (current.automaticSchedules ?? []).filter((item) =>
        transferred.schedules.some((original) =>
          sameRecord({ ...item, firstDueMiles: null, firstDueDate: null }, original),
        ),
      );
      const cleanupSchedules = [
        ...transferred.schedules,
        ...initializedSchedules,
        ...automaticallyInitialized,
      ];
      const changed = <T extends { id: string }>(item: T, originals: T[]) =>
        !originals.some((original) => original.id === item.id && sameRecord(item, original));
      current.visits = current.visits.filter((item) => changed(item, transferred.visits));
      current.fuelEntries = current.fuelEntries.filter((item) =>
        changed(item, transferred.fuelEntries),
      );
      const neededSchedules = new Set(
        current.visits.flatMap((visit) => visit.items.map((item) => item.scheduleItemId)),
      );
      current.schedules = current.schedules.filter(
        (item) => changed(item, cleanupSchedules) || neededSchedules.has(item.id),
      );
      const neededCars = new Set(
        [...current.schedules, ...current.visits, ...current.fuelEntries].map((item) => item.carId),
      );
      current.cars = current.cars.filter(
        (item) => changed(item, transferred.cars) || neededCars.has(item.id),
      );
    });
    const current = await this.load();
    const retainedPaths = new Set(
      [...current.visits, ...current.fuelEntries].flatMap((record) =>
        record.photos.map((photo) => photo.path),
      ),
    );
    for (const record of [...transferred.visits, ...transferred.fuelEntries]) {
      for (const photo of record.photos)
        if (!retainedPaths.has(photo.path)) await this.removePhoto(photo);
    }
  }
  async removePhoto(photo: Photo) {
    await del(`photo:${photo.path}`);
  }
}

async function mutateLocalSnapshot(mutate: (snapshot: LocalSnapshot) => void) {
  await update<LocalSnapshot>(SNAPSHOT_KEY, (saved) => {
    const snapshot: LocalSnapshot = normalizeSnapshot(clone(saved ?? EMPTY_SNAPSHOT));
    mutate(snapshot);
    if (snapshot.automaticSchedules) {
      const schedules = new Map(snapshot.schedules.map((item) => [item.id, item]));
      snapshot.automaticSchedules = snapshot.automaticSchedules.filter((automatic) =>
        sameRecord(schedules.get(automatic.id), automatic),
      );
      if (!snapshot.automaticSchedules.length) delete snapshot.automaticSchedules;
    }
    return snapshot;
  });
}

export function sameRecord(left: unknown, right: unknown): boolean {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, entry]) => [
            key,
            key === 'createdAt' && typeof entry === 'string'
              ? new Date(entry).toISOString()
              : canonical(entry),
          ]),
      );
    return value;
  };
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function upsert<T extends { id: string }>(items: T[], item: T): T[] {
  return [...items.filter((existing) => existing.id !== item.id), item];
}

const carToRow = (car: Car, userId: string) => ({
  id: car.id,
  user_id: userId,
  name: car.name,
  year: car.year,
  make: car.make,
  model: car.model,
  vin: car.vin,
  plate: car.plate,
  is_archived: car.isArchived,
  distance_unit: car.distanceUnit,
  odometer: car.odometer,
  reminder_days: car.reminderDays,
  reminder_miles: car.reminderMiles,
  created_at: car.createdAt,
});
const scheduleToRow = (item: ScheduleItem, userId: string) => ({
  id: item.id,
  user_id: userId,
  car_id: item.carId,
  name: item.name,
  interval_miles: item.intervalMiles,
  interval_months: item.intervalMonths,
  first_due_miles: item.firstDueMiles,
  first_due_date: item.firstDueDate,
  source_note: item.sourceNote,
  is_active: item.isActive,
  created_at: item.createdAt,
});
export type SaveScheduleWithDefaultsArgs = {
  p_user_id: string;
  p_item: ReturnType<typeof scheduleToRow>;
  p_today: string;
};
const visitToRow = (visit: Visit, userId: string) => ({
  id: visit.id,
  user_id: userId,
  car_id: visit.carId,
  service_date: visit.date,
  odometer: visit.odometer,
  total_cost_cents: visit.totalCostCents,
  currency: currencyOrDefault(visit.currency),
  conversions: visit.conversions ?? {},
  provider: visit.provider,
  notes: visit.notes,
  items: visit.items,
  photos: visit.photos,
  created_at: visit.createdAt,
});

export class SupabaseRepository implements Repository {
  private offline: OfflineReceipts | null;
  private uncachedArchives = new Map<string, boolean>();
  constructor(
    private client: SupabaseClient,
    private userId: string,
    allowOffline = false,
  ) {
    this.offline = allowOffline
      ? new OfflineReceipts(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', userId)
      : null;
  }

  async saveHomeCurrency(currency: Currency) {
    if (!isCurrency(currency)) throw new AppError('visitFields');
    const { error } = await this.client
      .from('garage_settings')
      .upsert({ user_id: this.userId, home_currency: currency });
    if (error) throw error;
  }
  async saveConversion(visit: Visit, target: Currency, conversion: Conversion) {
    if (!isCurrency(target) || !validConversion(conversion, receiptInputs(visit)))
      throw new AppError('visitFields');
    return this.withReceiptLock(() => this.saveConversionOnline(visit, target, conversion));
  }
  private async saveConversionOnline(visit: Visit, target: Currency, conversion: Conversion) {
    if (this.offline)
      await this.offline.flush(({ visit, manualTargets }) =>
        this.saveVisitOnline(visit, manualTargets),
      );
    const { error } = await this.client.rpc('save_visit_conversion', {
      p_visit_id: visit.id,
      p_currency: currencyOrDefault(visit.currency),
      p_date: visit.date,
      p_total: visit.totalCostCents,
      p_target: target,
      p_conversion: conversion,
    });
    if (error) throw error;
  }

  async load(): Promise<Snapshot> {
    return this.withReceiptLock(() => this.loadWithPending());
  }
  private withReceiptLock<T>(action: () => Promise<T>): Promise<T> {
    return this.offline ? this.offline.withLock(action) : action();
  }
  private async loadWithPending(): Promise<Snapshot> {
    try {
      if (this.offline)
        await this.offline.flush(({ visit, manualTargets }) =>
          this.saveVisitOnline(visit, manualTargets),
        );
      const snapshot = await this.loadOnline();
      const saved = this.offline ? await this.offline.remember(snapshot) : snapshot;
      this.uncachedArchives.clear();
      return saved;
    } catch (cause) {
      if (this.offline && connectionFailure(cause)) {
        const cached = await this.offline.cachedSnapshot();
        if (cached)
          return {
            ...cached,
            cars: cached.cars.map((car) => ({
              ...car,
              isArchived: this.uncachedArchives.get(car.id) ?? car.isArchived,
            })),
          };
      }
      throw cause;
    }
  }

  private async loadOnline(): Promise<Snapshot> {
    const [cars, schedules, visits, fuelEntries, settings] = await Promise.all([
      this.client.from('cars').select('*').eq('user_id', this.userId).order('created_at'),
      this.client.from('schedule_items').select('*').eq('user_id', this.userId).order('created_at'),
      this.client
        .from('visits')
        .select('*')
        .eq('user_id', this.userId)
        .order('service_date', { ascending: false }),
      this.client
        .from('fuel_entries')
        .select('*')
        .eq('user_id', this.userId)
        .order('fuel_date', { ascending: false }),
      this.client.from('garage_settings').select('*').eq('user_id', this.userId).maybeSingle(),
    ]);
    for (const result of [cars, schedules, visits, fuelEntries, settings])
      if (result.error) throw result.error;
    const snapshot: Snapshot = {
      homeCurrency: currencyOrDefault(settings.data?.home_currency),
      cars: (cars.data ?? []).map((row) =>
        normalizeCar({
          id: row.id,
          name: row.name,
          year: row.year,
          make: row.make,
          model: row.model,
          vin: row.vin,
          plate: row.plate,
          isArchived: row.is_archived,
          distanceUnit: row.distance_unit,
          odometer: row.odometer,
          reminderDays: row.reminder_days,
          reminderMiles: row.reminder_miles,
          createdAt: row.created_at,
        }),
      ),
      schedules: (schedules.data ?? []).map((row) => ({
        id: row.id,
        carId: row.car_id,
        name: row.name,
        intervalMiles: row.interval_miles,
        intervalMonths: row.interval_months,
        firstDueMiles: row.first_due_miles,
        firstDueDate: row.first_due_date,
        sourceNote: row.source_note,
        isActive: row.is_active,
        createdAt: row.created_at,
      })),
      visits: (visits.data ?? []).map((row) => ({
        id: row.id,
        carId: row.car_id,
        date: row.service_date,
        odometer: row.odometer,
        totalCostCents: row.total_cost_cents,
        currency: currencyOrDefault(row.currency),
        conversions: row.conversions ?? {},
        provider: row.provider,
        notes: row.notes,
        items: row.items ?? [],
        photos: row.photos ?? [],
        createdAt: row.created_at,
      })),
      fuelEntries: (fuelEntries.data ?? []).map(fuelFromRow),
    };
    return initializeCloudSchedules(this.client, this.userId, snapshot, todayISO());
  }

  async saveCar(car: Car) {
    const normalized = { ...normalizeCar(car), plate: normalizePlate(car.plate) };
    const { error } = await this.client.rpc('save_car', {
      p_car: carToRow(normalized, this.userId),
    });
    if (error) throw error;
  }
  async deleteCar(id: string) {
    return this.withReceiptLock(() => this.deleteCarOnline(id));
  }
  async setCarArchived(id: string, archived: boolean) {
    return this.withReceiptLock(() => this.setCarArchivedOnline(id, archived));
  }
  private async setCarArchivedOnline(id: string, archived: boolean) {
    const { data, error } = await this.client
      .from('cars')
      .update({ is_archived: archived })
      .eq('user_id', this.userId)
      .eq('id', id)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new AppError('archive');
    this.uncachedArchives.set(id, archived);
    try {
      await this.offline?.rememberCarArchived(id, archived);
      this.uncachedArchives.delete(id);
    } catch (cause) {
      // A cache failure cannot undo an accepted cloud save or re-enable local reminders.
      recordDiagnostic(cause);
    }
  }
  private async deleteCarOnline(id: string) {
    // Collect photo paths before the cascade removes the records that reference them.
    const lookups = await Promise.all(
      ['visits', 'fuel_entries'].map((table) =>
        this.client.from(table).select('photos').eq('user_id', this.userId).eq('car_id', id),
      ),
    );
    for (const lookup of lookups) if (lookup.error) throw lookup.error;
    const { error } = await this.client
      .from('cars')
      .delete()
      .eq('user_id', this.userId)
      .eq('id', id);
    if (error) throw error;
    const paths = lookups.flatMap((lookup) =>
      (lookup.data ?? []).flatMap((record) =>
        ((record.photos as Photo[] | null) ?? []).map((photo) => photo.path),
      ),
    );
    if (paths.length) await this.client.storage.from('visit-photos').remove(paths);
    await this.offline?.remove(undefined, id);
  }
  async saveSchedule(item: ScheduleItem) {
    if (
      item.isActive &&
      item.firstDueDate === null &&
      item.firstDueMiles === null &&
      (item.intervalMiles !== null || item.intervalMonths !== null)
    ) {
      const { error } = await this.client.rpc('save_schedule_with_defaults', {
        p_user_id: this.userId,
        p_item: scheduleToRow(item, this.userId),
        p_today: todayISO(),
      } satisfies SaveScheduleWithDefaultsArgs);
      if (error) throw error;
      return;
    }
    const { error } = await this.client
      .from('schedule_items')
      .upsert(scheduleToRow(item, this.userId));
    if (error) throw error;
  }
  async deleteSchedule(id: string) {
    const { error } = await this.client
      .from('schedule_items')
      .delete()
      .eq('user_id', this.userId)
      .eq('id', id);
    if (error) throw error;
  }
  async saveVisit(visit: Visit, manualTargets: Currency[] = []) {
    return this.withReceiptLock(() => this.saveVisitWithPending(visit, manualTargets));
  }
  private async saveVisitWithPending(visit: Visit, manualTargets: Currency[]) {
    visit = checkedVisit(visit, manualTargets);
    const pending = (await this.offline?.read())?.pending.find(
      (entry) => entry.visit.id === visit.id,
    );
    if (pending && sameInputs(receiptInputs(pending.visit), receiptInputs(visit))) {
      visit = {
        ...visit,
        conversions: mergeConversions(pending.visit.conversions, visit.conversions),
      };
      manualTargets = [...new Set([...pending.manualTargets, ...manualTargets])];
    }
    try {
      await this.saveVisitOnline(visit, manualTargets);
      if (pending) await this.offline?.acknowledge(pending);
      await this.offline?.rememberVisit(visit);
    } catch (cause) {
      if (!this.offline || !connectionFailure(cause)) throw cause;
      await this.offline.enqueue(visit, manualTargets);
    }
  }
  private async saveVisitOnline(visit: Visit, manualTargets: Currency[]) {
    visit = checkedVisit(visit, manualTargets);
    const { data: previous, error: lookupError } = await this.client
      .from('visits')
      .select('photos')
      .eq('user_id', this.userId)
      .eq('id', visit.id)
      .maybeSingle();
    if (lookupError) throw lookupError;
    const { error } = await this.client.from('visits').upsert(visitToRow(visit, this.userId));
    if (error) throw error;
    for (const photo of (previous?.photos as Photo[] | undefined) ?? []) {
      if (!visit.photos.some((entry) => entry.path === photo.path))
        await this.removePhoto(photo).catch(recordDiagnostic);
    }
  }
  async deleteVisit(visit: Visit) {
    return this.withReceiptLock(() => this.deleteVisitOnline(visit));
  }
  private async deleteVisitOnline(visit: Visit) {
    const { error } = await this.client
      .from('visits')
      .delete()
      .eq('user_id', this.userId)
      .eq('id', visit.id);
    if (error) throw error;
    await this.offline?.remove(visit.id);
    if (visit.photos.length)
      await this.client.storage
        .from('visit-photos')
        .remove(visit.photos.map((photo) => photo.path));
  }
  // Fill-ups have no offline queue yet: an offline save surfaces the connection error.
  async saveFuelEntry(entry: FuelEntry) {
    return this.withReceiptLock(() => this.saveFuelEntryOnline(entry));
  }
  private async saveFuelEntryOnline(entry: FuelEntry) {
    entry = checkedFuelEntry(entry);
    const { data: previous, error: lookupError } = await this.client
      .from('fuel_entries')
      .select('photos')
      .eq('user_id', this.userId)
      .eq('id', entry.id)
      .maybeSingle();
    if (lookupError) throw lookupError;
    const { error } = await this.client.from('fuel_entries').upsert(fuelToRow(entry, this.userId));
    if (error) throw error;
    await this.offline?.rememberFuelEntry(entry).catch(recordDiagnostic);
    for (const photo of (previous?.photos as Photo[] | undefined) ?? []) {
      if (!entry.photos.some((current) => current.path === photo.path))
        await this.removePhoto(photo).catch(recordDiagnostic);
    }
  }
  async deleteFuelEntry(entry: FuelEntry) {
    return this.withReceiptLock(() => this.deleteFuelEntryOnline(entry));
  }
  private async deleteFuelEntryOnline(entry: FuelEntry) {
    const { error } = await this.client
      .from('fuel_entries')
      .delete()
      .eq('user_id', this.userId)
      .eq('id', entry.id);
    if (error) throw error;
    await this.offline?.removeFuelEntry(entry.id);
    if (entry.photos.length)
      await this.client.storage
        .from('visit-photos')
        .remove(entry.photos.map((photo) => photo.path));
  }
  async uploadPhoto(recordId: string, file: File): Promise<Photo> {
    const id = crypto.randomUUID();
    const path = `${this.userId}/${recordId}/${id}.webp`;
    const { error } = await this.client.storage
      .from('visit-photos')
      .upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw error;
    return { id, path, name: file.name, contentType: file.type };
  }
  async photoUrl(photo: Photo): Promise<string> {
    const { data, error } = await this.client.storage
      .from('visit-photos')
      .createSignedUrl(photo.path, 60, { download: photo.name });
    if (error) throw error;
    return data.signedUrl;
  }
  async removePhoto(photo: Photo) {
    const { error } = await this.client.storage.from('visit-photos').remove([photo.path]);
    if (error) throw error;
  }
}

export const isCloudConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);
export const supabase = isCloudConfigured
  ? serializeAccountSignIns(
      createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        {
          auth: {
            storageKey: accountAuthStorageKey(process.env.NEXT_PUBLIC_SUPABASE_URL!),
            lock: typeof navigator !== 'undefined' && navigator.locks ? navigatorLock : undefined,
            // A timeout must never steal a lock from an in-flight account cleanup.
            lockAcquireTimeout: -1,
          },
        },
      ),
    )
  : null;

export const recoveryInitialization = supabase ? bootstrapRecovery(supabase) : Promise.resolve();

export function createRepository(userId?: string): Repository {
  if (supabase && userId) {
    return new SupabaseRepository(supabase, userId, true);
  }
  return new LocalRepository();
}
