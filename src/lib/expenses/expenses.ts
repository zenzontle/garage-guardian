import { AppError } from '../utils/app-error';
import {
  currencyOrDefault,
  isCurrency,
  normalizeReceipt,
  validCents,
  validDate,
} from '../currency/currency';
import type { Car, Expense } from '../garage/model';

export const EXPENSE_CATEGORIES = [
  'insurance',
  'registration',
  'inspection',
  'tax',
  'financing',
  'parking',
  'tolls',
  'washing',
  'other',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

// Match the database checks in 0015_ownership_costs.sql.
export const EXPENSE_DESCRIPTION_MAX_LENGTH = 100;
export const EXPENSE_NOTES_MAX_LENGTH = 2000;

export const isExpenseCategory = (value: unknown): value is ExpenseCategory =>
  EXPENSE_CATEGORIES.some((category) => category === value);
// Count Unicode characters like PostgreSQL char_length, rather than UTF-16 units.
const characters = (value: string) => Array.from(value).length;

export function normalizeExpense(expense: Expense): Expense {
  return {
    ...normalizeReceipt({ ...expense, currency: currencyOrDefault(expense.currency) }),
    category: isExpenseCategory(expense.category) ? expense.category : 'other',
    description: expense.description ?? '',
    renewsOn: expense.renewsOn ?? null,
    notes: expense.notes ?? '',
  };
}

export function checkedExpense(expense: Expense): Expense {
  const description = (expense.description ?? '').trim();
  const notes = (expense.notes ?? '').trim();
  if (
    !expense.id ||
    !expense.carId ||
    !validDate(expense.date) ||
    !isExpenseCategory(expense.category) ||
    !validCents(expense.totalCostCents) ||
    !isCurrency(expense.currency) ||
    (expense.renewsOn !== null &&
      (!validDate(expense.renewsOn) || expense.renewsOn <= expense.date)) ||
    characters(description) > EXPENSE_DESCRIPTION_MAX_LENGTH ||
    characters(notes) > EXPENSE_NOTES_MAX_LENGTH
  )
    throw new AppError('expenseFields');
  // Costs only carry automatic conversions; a stale or manual one is dropped.
  const { conversions } = normalizeReceipt(expense);
  return {
    ...expense,
    description,
    notes,
    conversions: Object.fromEntries(
      Object.entries(conversions).filter(([, conversion]) => conversion.source === 'automatic'),
    ),
  };
}

export function sortExpenses(expenses: Expense[]): Expense[] {
  return [...expenses].sort(
    (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
  );
}

export const expenseToRow = (expense: Expense, userId: string) => ({
  id: expense.id,
  user_id: userId,
  car_id: expense.carId,
  expense_date: expense.date,
  category: expense.category,
  description: expense.description,
  total_cost_cents: expense.totalCostCents,
  currency: expense.currency,
  conversions: expense.conversions ?? {},
  renews_on: expense.renewsOn,
  notes: expense.notes,
  created_at: expense.createdAt,
});

export type ExpenseRow = ReturnType<typeof expenseToRow>;

export const expenseFromRow = (row: ExpenseRow): Expense =>
  normalizeExpense({
    id: row.id,
    carId: row.car_id,
    date: row.expense_date,
    category: row.category,
    description: row.description,
    totalCostCents: row.total_cost_cents,
    currency: row.currency,
    conversions: row.conversions,
    renewsOn: row.renews_on,
    notes: row.notes,
    createdAt: row.created_at,
  });

export type RenewalStatus = 'due' | 'upcoming' | 'later';
export type Renewal = {
  expense: Expense;
  car: Car;
  status: RenewalStatus;
  daysRemaining: number;
};

const recurringName = (expense: Expense) =>
  expense.description.trim().replace(/s+/g, ' ').toLocaleLowerCase();

const daysUntil = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * The next renewal of each active vehicle's recurring costs. A recurring cost is a vehicle,
 * category and description (ignoring case and spacing), so two policies or a membership logged as
 * "Other" stay apart from one-off costs. Its most recent payment decides: that payment's renewal
 * date is the reminder, and logging the next one settles it, whether or not it has a renewal date
 * of its own. Renewals use the vehicle's day window, like maintenance reminders.
 */
export function getRenewals(cars: Car[], expenses: Expense[], today: string): Renewal[] {
  const latest = new Map<string, Expense>();
  for (const expense of expenses) {
    const key = JSON.stringify([expense.carId, expense.category, recurringName(expense)]);
    const current = latest.get(key);
    if (
      !current ||
      expense.date > current.date ||
      (expense.date === current.date && expense.createdAt > current.createdAt)
    )
      latest.set(key, expense);
  }
  const renewals: Renewal[] = [];
  for (const expense of latest.values()) {
    const car = cars.find((entry) => entry.id === expense.carId);
    if (!expense.renewsOn || !car || car.isArchived) continue;
    const daysRemaining = daysUntil(today, expense.renewsOn);
    renewals.push({
      expense,
      car,
      daysRemaining,
      status: daysRemaining <= 0 ? 'due' : daysRemaining <= car.reminderDays ? 'upcoming' : 'later',
    });
  }
  return renewals.sort(
    (a, b) => a.daysRemaining - b.daysRemaining || a.car.name.localeCompare(b.car.name),
  );
}
