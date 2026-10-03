import type { Car, ScheduleItem, Visit } from '../lib/model';

export const car: Car = { id: '11111111-1111-4111-8111-111111111111', name: 'Daily driver', year: 2020, make: 'Toyota', model: 'RAV4', vin: '', plate: "", distanceUnit: 'miles', odometer: 100, reminderDays: 30, reminderMiles: 500, createdAt: '2026-01-01T00:00:00.000Z' };
export const schedule: ScheduleItem = { id: '22222222-2222-4222-8222-222222222222', carId: car.id, name: 'Oil change', intervalMiles: 5000, intervalMonths: 6, firstDueMiles: 5000, firstDueDate: null, sourceNote: 'Manual', isActive: true, createdAt: car.createdAt };
export const visit: Visit = { id: '33333333-3333-4333-8333-333333333333', carId: car.id, date: '2026-09-25', odometer: 100, totalCostCents: 15000, provider: 'Dealer', notes: 'Checked', items: [{ id: 'item', name: schedule.name, scheduleItemId: schedule.id, costCents: 15000 }], photos: [], createdAt: car.createdAt };
