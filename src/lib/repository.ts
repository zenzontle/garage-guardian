'use client';

import { del, get, set } from 'idb-keyval';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { EMPTY_SNAPSHOT, type Car, type Photo, type ScheduleItem, type Snapshot, type Visit } from './model';

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

class LocalRepository implements Repository {
  async load(): Promise<Snapshot> {
    return clone((await get<Snapshot>(SNAPSHOT_KEY)) ?? EMPTY_SNAPSHOT);
  }
  private async write(update: (snapshot: Snapshot) => void) {
    const snapshot = await this.load();
    update(snapshot);
    await set(SNAPSHOT_KEY, snapshot);
  }
  saveCar(car: Car) {
    return this.write((snapshot) => {
      snapshot.cars = upsert(snapshot.cars, car);
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
    const file = await get<Blob>(`photo:${photo.path}`);
    if (!file) throw new Error('Photo is no longer available.');
    return URL.createObjectURL(file);
  }
  async removePhoto(photo: Photo) {
    await del(`photo:${photo.path}`);
  }
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

class SupabaseRepository implements Repository {
  constructor(
    private client: SupabaseClient,
    private userId: string,
  ) {}

  async load(): Promise<Snapshot> {
    const [cars, schedules, visits] = await Promise.all([
      this.client.from('cars').select('*').order('created_at'),
      this.client.from('schedule_items').select('*').order('created_at'),
      this.client.from('visits').select('*').order('service_date', { ascending: false }),
    ]);
    for (const result of [cars, schedules, visits]) if (result.error) throw result.error;
    return {
      cars: (cars.data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        year: row.year,
        make: row.make,
        model: row.model,
        vin: row.vin,
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
    const { error } = await this.client.from('cars').upsert(carToRow(car, this.userId));
    if (error) throw error;
  }
  async deleteCar(id: string) {
    const { data: visits, error: lookupError } = await this.client.from('visits').select('photos').eq('car_id', id);
    if (lookupError) throw lookupError;
    const { error } = await this.client.from('cars').delete().eq('id', id);
    if (error) throw error;
    const paths = (visits ?? []).flatMap((visit) => (visit.photos as Photo[]).map((photo) => photo.path));
    if (paths.length) await this.client.storage.from('visit-photos').remove(paths);
  }
  async saveSchedule(item: ScheduleItem) {
    const { error } = await this.client.from('schedule_items').upsert(scheduleToRow(item, this.userId));
    if (error) throw error;
  }
  async deleteSchedule(id: string) {
    const { error } = await this.client.from('schedule_items').delete().eq('id', id);
    if (error) throw error;
  }
  async saveVisit(visit: Visit) {
    const { data: previous, error: lookupError } = await this.client
      .from('visits')
      .select('photos')
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
    const { error } = await this.client.from('visits').delete().eq('id', visit.id);
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
  if (supabase) {
    if (!userId) throw new Error('Sign in to access your records.');
    return new SupabaseRepository(supabase, userId);
  }
  return new LocalRepository();
}
