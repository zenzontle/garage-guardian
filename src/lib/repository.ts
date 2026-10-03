'use client';

import { del, get, set, update } from 'idb-keyval';
import { AppError } from './app-error';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { EMPTY_SNAPSHOT, normalizeCar, normalizePlate, normalizeSnapshot, type Car, type Photo, type ScheduleItem, type Snapshot, type Visit } from './model';

export type Repository = {
  load(): Promise<Snapshot>;
  saveCar(car: Car): Promise<void>;
  deleteCar(id: string): Promise<void>;
  saveSchedule(item: ScheduleItem): Promise<void>;
  deleteSchedule(id: string): Promise<void>;
  saveVisit(visit: Visit): Promise<void>;
  deleteVisit(visit: Visit): Promise<void>;
  uploadPhoto(visitId: string, file: File): Promise<Photo>;
  photoUrl(photo: Photo): Promise<string>;
  removePhoto(photo: Photo): Promise<void>;
};

const SNAPSHOT_KEY = 'garage-guardian:local:v1';
const clone = <T>(value: T): T => structuredClone(value);

export class LocalRepository implements Repository {
  async load(): Promise<Snapshot> {
    return normalizeSnapshot(clone((await get<Snapshot>(SNAPSHOT_KEY)) ?? EMPTY_SNAPSHOT));
  }
  private async write(update: (snapshot: Snapshot) => void) {
    await mutateLocalSnapshot(update);
  }
  async saveCar(car: Car) {
    const normalized = { ...normalizeCar(car), plate: normalizePlate(car.plate) };
    return this.write((snapshot) => {
      snapshot.cars = upsert(snapshot.cars, normalized);
    });
  }
  async deleteCar(id: string) {
    const snapshot = await this.load();
    for (const visit of snapshot.visits.filter((entry) => entry.carId === id)) {
      for (const photo of visit.photos) await del(`photo:${photo.path}`);
    }
    await this.write((current) => {
      current.cars = current.cars.filter((car) => car.id !== id);
      current.schedules = current.schedules.filter((item) => item.carId !== id);
      current.visits = current.visits.filter((visit) => visit.carId !== id);
    });
  }
  saveSchedule(item: ScheduleItem) {
    return this.write((snapshot) => {
      snapshot.schedules = upsert(snapshot.schedules, item);
    });
  }
  deleteSchedule(id: string) {
    return this.write((snapshot) => {
      snapshot.schedules = snapshot.schedules.filter((item) => item.id !== id);
    });
  }
  async saveVisit(visit: Visit) {
    const previous = (await this.load()).visits.find((entry) => entry.id === visit.id);
    await this.write((snapshot) => {
      snapshot.visits = upsert(snapshot.visits, visit);
    });
    for (const photo of previous?.photos ?? []) {
      if (!visit.photos.some((entry) => entry.path === photo.path)) await this.removePhoto(photo);
    }
  }
  async deleteVisit(visit: Visit) {
    for (const photo of visit.photos) await del(`photo:${photo.path}`);
    await this.write((snapshot) => {
      snapshot.visits = snapshot.visits.filter((item) => item.id !== visit.id);
    });
  }
  async uploadPhoto(visitId: string, file: File): Promise<Photo> {
    const id = crypto.randomUUID();
    const path = `${visitId}/${id}`;
    await set(`photo:${path}`, file);
    return { id, path, name: file.name, contentType: file.type };
  }
  async photoUrl(photo: Photo): Promise<string> {
    const file = await this.readPhoto(photo);
    return URL.createObjectURL(file);
  }
  async readPhoto(photo: Photo): Promise<Blob> {
    const file = await get<Blob>(`photo:${photo.path}`);
    if (!file) throw new AppError("photoMissing", { name: photo.name });
    return file;
  }
  async clearTransferred(transferred: Snapshot) {
    transferred = normalizeSnapshot(transferred);
    // Preserve anything edited in another tab or after signing out during a transfer.
    await this.write((current) => {
      const changed = <T extends { id: string }>(item: T, originals: T[]) => !originals.some((original) => original.id === item.id && sameRecord(item, original));
      current.visits = current.visits.filter((item) => changed(item, transferred.visits));
      const neededSchedules = new Set(current.visits.flatMap((visit) => visit.items.map((item) => item.scheduleItemId)));
      current.schedules = current.schedules.filter((item) => changed(item, transferred.schedules) || neededSchedules.has(item.id));
      const neededCars = new Set([...current.schedules, ...current.visits].map((item) => item.carId));
      current.cars = current.cars.filter((item) => changed(item, transferred.cars) || neededCars.has(item.id));
    });
    const current = await this.load();
    const retainedPaths = new Set(current.visits.flatMap((visit) => visit.photos.map((photo) => photo.path)));
    for (const visit of transferred.visits) {
      for (const photo of visit.photos) if (!retainedPaths.has(photo.path)) await this.removePhoto(photo);
    }
  }
  async removePhoto(photo: Photo) {
    await del(`photo:${photo.path}`);
  }
}

async function mutateLocalSnapshot(mutate: (snapshot: Snapshot) => void) {
  await update<Snapshot>(SNAPSHOT_KEY, (saved) => {
    const snapshot = normalizeSnapshot(clone(saved ?? EMPTY_SNAPSHOT));
    mutate(snapshot);
    return snapshot;
  });
}

export function sameRecord(left: unknown, right: unknown): boolean {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [
        key, key === 'createdAt' && typeof entry === 'string' ? new Date(entry).toISOString() : canonical(entry),
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
const visitToRow = (visit: Visit, userId: string) => ({
  id: visit.id,
  user_id: userId,
  car_id: visit.carId,
  service_date: visit.date,
  odometer: visit.odometer,
  total_cost_cents: visit.totalCostCents,
  provider: visit.provider,
  notes: visit.notes,
  items: visit.items,
  photos: visit.photos,
  created_at: visit.createdAt,
});

export class SupabaseRepository implements Repository {
  constructor(
    private client: SupabaseClient,
    private userId: string,
  ) {}

  async load(): Promise<Snapshot> {
    const [cars, schedules, visits] = await Promise.all([
      this.client.from('cars').select('*').eq('user_id', this.userId).order('created_at'),
      this.client.from('schedule_items').select('*').eq('user_id', this.userId).order('created_at'),
      this.client.from('visits').select('*').eq('user_id', this.userId).order('service_date', { ascending: false }),
    ]);
    for (const result of [cars, schedules, visits]) if (result.error) throw result.error;
    return {
      cars: (cars.data ?? []).map((row) => normalizeCar({
        id: row.id,
        name: row.name,
        year: row.year,
        make: row.make,
        model: row.model,
        vin: row.vin,
        plate: row.plate,
        distanceUnit: row.distance_unit,
        odometer: row.odometer,
        reminderDays: row.reminder_days,
        reminderMiles: row.reminder_miles,
        createdAt: row.created_at,
      })),
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
        provider: row.provider,
        notes: row.notes,
        items: row.items ?? [],
        photos: row.photos ?? [],
        createdAt: row.created_at,
      })),
    };
  }

  async saveCar(car: Car) {
    const normalized = { ...normalizeCar(car), plate: normalizePlate(car.plate) };
    const { error } = await this.client.from('cars').upsert(carToRow(normalized, this.userId));
    if (error) throw error;
  }
  async deleteCar(id: string) {
    const { data: visits, error: lookupError } = await this.client.from('visits').select('photos').eq('user_id', this.userId).eq('car_id', id);
    if (lookupError) throw lookupError;
    const { error } = await this.client.from('cars').delete().eq('user_id', this.userId).eq('id', id);
    if (error) throw error;
    const paths = (visits ?? []).flatMap((visit) => (visit.photos as Photo[]).map((photo) => photo.path));
    if (paths.length) await this.client.storage.from('visit-photos').remove(paths);
  }
  async saveSchedule(item: ScheduleItem) {
    const { error } = await this.client.from('schedule_items').upsert(scheduleToRow(item, this.userId));
    if (error) throw error;
  }
  async deleteSchedule(id: string) {
    const { error } = await this.client.from('schedule_items').delete().eq('user_id', this.userId).eq('id', id);
    if (error) throw error;
  }
  async saveVisit(visit: Visit) {
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
      if (!visit.photos.some((entry) => entry.path === photo.path)) await this.removePhoto(photo);
    }
  }
  async deleteVisit(visit: Visit) {
    const { error } = await this.client.from('visits').delete().eq('user_id', this.userId).eq('id', visit.id);
    if (error) throw error;
    if (visit.photos.length)
      await this.client.storage.from('visit-photos').remove(visit.photos.map((photo) => photo.path));
  }
  async uploadPhoto(visitId: string, file: File): Promise<Photo> {
    const id = crypto.randomUUID();
    const path = `${this.userId}/${visitId}/${id}.webp`;
    const { error } = await this.client.storage
      .from('visit-photos')
      .upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw error;
    return { id, path, name: file.name, contentType: file.type };
  }
  async photoUrl(photo: Photo): Promise<string> {
    const { data, error } = await this.client.storage.from('visit-photos').createSignedUrl(photo.path, 60);
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
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)
  : null;

export function createRepository(userId?: string): Repository {
  if (supabase && userId) {
    return new SupabaseRepository(supabase, userId);
  }
  return new LocalRepository();
}
