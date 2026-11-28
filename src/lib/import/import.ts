import {
  distanceAbbreviation,
  type Car,
  type DistanceUnit,
  type Expense,
  type ExpenseCategory,
  type FuelEntry,
  type FuelType,
  type ScheduleItem,
  type Snapshot,
  type Visit,
  type VisitItem,
  type VolumeUnit,
} from '../garage/model';
import { isCurrency, parseCents, validDate, type Currency } from '../currency/currency';
import {
  computeTotalCents,
  computeUnitPriceMilli,
  defaultVolumeUnit,
  FUEL_NOTES_MAX_LENGTH,
  fuelOdometerInOrder,
  MAX_INTEGER,
  MAX_VOLUME_MILLI,
  parseMilli,
  STATION_MAX_LENGTH,
} from '../fuel/fuel';
import {
  EXPENSE_DESCRIPTION_MAX_LENGTH,
  EXPENSE_NOTES_MAX_LENGTH,
  isExpenseCategory,
} from '../expenses/expenses';
import { unguardCell } from './csv-parse';

export const IMPORT_KINDS = ['visit', 'fuel', 'expense'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

// Fields in the order the mapping form lists them.
export const IMPORT_FIELDS = {
  visit: [
    'date',
    'car',
    'odometer',
    'distanceUnit',
    'items',
    'itemCosts',
    'total',
    'currency',
    'provider',
    'notes',
  ],
  fuel: [
    'date',
    'car',
    'odometer',
    'distanceUnit',
    'volume',
    'volumeUnit',
    'unitPrice',
    'total',
    'currency',
    'fuelType',
    'fullTank',
    'missedPrevious',
    'station',
    'notes',
  ],
  expense: ['date', 'car', 'category', 'description', 'total', 'currency', 'renewsOn', 'notes'],
} as const satisfies Record<ImportKind, readonly string[]>;
export type ImportField = (typeof IMPORT_FIELDS)[ImportKind][number];

/** The fields a file must map. The vehicle may come from a column or the vehicle choice. */
export const REQUIRED_FIELDS: Record<ImportKind, readonly ImportField[]> = {
  visit: ['date', 'items'],
  fuel: ['date', 'odometer', 'volume'],
  expense: ['date', 'category', 'total'],
};

export type ImportMapping = Partial<Record<ImportField, number>>;
export type DateOrder = 'ymd' | 'mdy' | 'dmy';
export type ImportRecord = { visit: Visit; fuel: FuelEntry; expense: Expense };

// Rows beyond this would take minutes to save one by one and are not a hand-kept log.
export const MAX_IMPORT_ROWS = 2000;
const TEXT_MAX_LENGTH = 100;
const NOTES_MAX_LENGTH = 2000;

export type ImportIssueCode =
  | 'missingDate'
  | 'invalidDate'
  | 'futureDate'
  | 'missingCar'
  | 'unknownCar'
  | 'invalidOdometer'
  | 'missingOdometer'
  | 'distanceUnitMismatch'
  | 'invalidAmount'
  | 'missingAmount'
  | 'invalidCurrency'
  | 'missingItems'
  | 'itemCostsTooHigh'
  | 'invalidItemCosts'
  | 'invalidVolume'
  | 'missingVolume'
  | 'invalidVolumeUnit'
  | 'missingFuelPrice'
  | 'invalidUnitPrice'
  | 'unknownFuelType'
  | 'invalidFlag'
  | 'odometerOrder'
  | 'missingCategory'
  | 'unknownCategory'
  | 'invalidRenewal'
  | 'textTooLong';

export type ImportIssue = { code: ImportIssueCode; values?: Record<string, string | number> };
export type ImportRowStatus = 'ready' | 'duplicate' | 'error';
export type ImportRow<T> = {
  /** The 1-based line of the record in the file, counting the header as line 1. */
  line: number;
  status: ImportRowStatus;
  /** Errors on rows that cannot be imported; warnings on rows that can. */
  issues: ImportIssue[];
  record: T | null;
};
export type ImportPreview<T> = {
  rows: ImportRow<T>[];
  ready: number;
  duplicates: number;
  errors: number;
  /** Rows past MAX_IMPORT_ROWS, which are not read. */
  skipped: number;
};

export type ImportOptions = {
  /** Every row's vehicle when set; otherwise the mapped car column names it. */
  carId: string | null;
  /** The currency of rows without a currency column or value. */
  currency: Currency;
  dateOrder: DateOrder;
  today: string;
  /** The time base for new records' creation times, which keep the file's order. */
  now: number;
  newId: () => string;
};

// Lowercase without accents or punctuation: "Odómetro (mi)" → "odometro mi".
export function normalizeHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// English and Spanish column names, most specific first. The export's own headers come first.
const HEADER_ALIASES: Record<ImportField, readonly string[]> = {
  date: ['date', 'fecha', 'service date', 'fill date', 'fecha de servicio', 'day', 'dia'],
  car: ['car', 'vehicle', 'vehiculo', 'auto', 'coche', 'carro'],
  odometer: [
    'odometer',
    'odometro',
    'mileage',
    'kilometraje',
    'odo',
    'miles',
    'millas',
    'km',
    'kilometers',
    'kilometros',
  ],
  distanceUnit: ['distance unit', 'unidad de distancia', 'odometer unit'],
  items: ['items', 'services', 'service', 'servicios', 'servicio', 'work', 'trabajo', 'tasks'],
  itemCosts: ['original item costs', 'item costs', 'costos por servicio', 'costos de servicios'],
  total: [
    'original total',
    'total',
    'total cost',
    'costo total',
    'cost',
    'costo',
    'amount',
    'monto',
    'importe',
    'price',
  ],
  currency: ['original currency', 'currency', 'moneda', 'moneda original'],
  provider: ['provider', 'shop', 'proveedor', 'taller', 'mechanic', 'mecanico'],
  notes: ['notes', 'notas', 'note', 'nota', 'comments', 'comentarios'],
  volume: [
    'volume',
    'volumen',
    'gallons',
    'galones',
    'liters',
    'litres',
    'litros',
    'quantity',
    'cantidad',
  ],
  volumeUnit: ['volume unit', 'unidad de volumen'],
  unitPrice: [
    'price per unit',
    'unit price',
    'precio por unidad',
    'precio unitario',
    'precio',
    'price',
  ],
  fuelType: ['gas type', 'fuel type', 'tipo de combustible', 'combustible', 'fuel', 'grade'],
  fullTank: ['full tank', 'tanque lleno', 'full'],
  missedPrevious: ['missed previous', 'carga anterior omitida', 'missed'],
  station: ['station', 'gas station', 'estacion', 'gasolinera'],
  category: ['category', 'categoria', 'type', 'tipo'],
  description: ['description', 'descripcion', 'concepto'],
  renewsOn: ['renews on', 'renewal date', 'renewal', 'renueva', 'fecha de renovacion'],
};

/**
 * Matches columns to fields by name. Each column feeds at most one field: fields claim their
 * best match in alias order, so "Original total" goes to the total and "Price per unit" to the
 * unit price even though both also contain words of other fields.
 */
export function autoMap(kind: ImportKind, headers: string[]): ImportMapping {
  const normalized = headers.map(normalizeHeader);
  const mapping: ImportMapping = {};
  const used = new Set<number>();
  const fields: readonly ImportField[] = IMPORT_FIELDS[kind];
  // Exact matches first, in alias priority, so a weaker alias never steals an exact column.
  const ranks = Math.max(...fields.map((field) => HEADER_ALIASES[field].length));
  for (let rank = 0; rank < ranks; rank++) {
    for (const field of fields) {
      if (mapping[field] !== undefined) continue;
      const alias = HEADER_ALIASES[field][rank];
      if (alias === undefined) continue;
      const column = normalized.findIndex((header, index) => !used.has(index) && header === alias);
      if (column === -1) continue;
      mapping[field] = column;
      used.add(column);
    }
  }
  return mapping;
}

/** Spreadsheet day-month order, read from slash dates whose day is above 12. */
export function detectDateOrder(values: string[]): DateOrder | null {
  let order: DateOrder | null = null;
  for (const value of values) {
    const match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value.trim());
    if (!match) continue;
    const [first, second] = [Number(match[1]), Number(match[2])];
    if (first > 12 && second <= 12) order = 'dmy';
    else if (second > 12 && first <= 12) order = 'mdy';
    if (order) return order;
  }
  return order;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** An ISO date from YYYY-MM-DD (with an optional time) or a day/month/year in the given order. */
export function parseImportDate(value: string, order: DateOrder): string | null {
  const text = value.trim();
  let year: number, month: number, day: number;
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/.exec(text);
  const local = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (iso) [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (local && order !== 'ymd') {
    const [first, second] = [Number(local[1]), Number(local[2])];
    year = Number(local[3]);
    [month, day] = order === 'mdy' ? [first, second] : [second, first];
  } else return null;
  const date = `${year}-${pad(month)}-${pad(day)}`;
  return validDate(date) ? date : null;
}

/**
 * A plain decimal for the money and volume parsers: currency symbols, spaces, and thousands
 * commas (1,234.56) are removed. A decimal comma or a negative amount is not a number here.
 */
export function plainDecimal(value: string): string | null {
  const text = value.trim().replace(/^(?:US|CA|MX|C)?\$\s*|\s*(?:USD|MXN|CAD)$/gi, '');
  if (/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(text)) return text.replaceAll(',', '');
  return /^\d+(\.\d*)?$|^\.\d+$/.test(text) ? (text.startsWith('.') ? `0${text}` : text) : null;
}

function parseOdometer(value: string): number | null {
  const text = plainDecimal(value);
  if (text === null || !/^\d+$/.test(text)) return null;
  const odometer = Number(text);
  return Number.isSafeInteger(odometer) && odometer <= MAX_INTEGER ? odometer : null;
}

// parseCents allows at most two decimals; spreadsheets often write 12.5 or 12.50.
function parseMoney(value: string): number | null {
  const text = plainDecimal(value);
  return text === null || text === '' ? null : parseCents(text);
}

const words = (value: string) => normalizeHeader(value);

function parseDistanceUnit(value: string): DistanceUnit | null {
  const text = words(value);
  if (['mi', 'mile', 'miles', 'milla', 'millas'].includes(text)) return 'miles';
  if (
    [
      'km',
      'kms',
      'kilometer',
      'kilometers',
      'kilometre',
      'kilometres',
      'kilometro',
      'kilometros',
    ].includes(text)
  )
    return 'kilometers';
  return null;
}

function parseVolumeUnit(value: string): VolumeUnit | null {
  const text = words(value);
  if (['gal', 'gals', 'gallon', 'gallons', 'galon', 'galones', 'us gal'].includes(text))
    return 'gallons';
  if (['l', 'lt', 'lts', 'liter', 'liters', 'litre', 'litres', 'litro', 'litros'].includes(text))
    return 'liters';
  return null;
}

const FUEL_ALIASES: Record<string, FuelType> = {
  regular: 'regular',
  unleaded: 'regular',
  gasoline: 'regular',
  gas: 'regular',
  magna: 'regular',
  'gasolina regular': 'regular',
  midgrade: 'midgrade',
  'mid grade': 'midgrade',
  plus: 'midgrade',
  intermedia: 'midgrade',
  premium: 'premium',
  super: 'premium',
  'gasolina premium': 'premium',
  diesel: 'diesel',
  e85: 'e85',
  flex: 'e85',
  other: 'other',
  otro: 'other',
  otra: 'other',
};

const CATEGORY_ALIASES: Record<string, ExpenseCategory> = {
  seguro: 'insurance',
  'car insurance': 'insurance',
  registro: 'registration',
  'placas y registro': 'registration',
  'verificacion o inspeccion': 'inspection',
  'tenencia o impuesto': 'tax',
  placas: 'registration',
  'inspection or emissions': 'inspection',
  emissions: 'inspection',
  verificacion: 'inspection',
  'inspeccion o emisiones': 'inspection',
  inspeccion: 'inspection',
  'vehicle tax': 'tax',
  impuesto: 'tax',
  'impuesto vehicular': 'tax',
  tenencia: 'tax',
  loan: 'financing',
  lease: 'financing',
  'loan or lease payment': 'financing',
  financiamiento: 'financing',
  'pago de credito o arrendamiento': 'financing',
  credito: 'financing',
  estacionamiento: 'parking',
  toll: 'tolls',
  peaje: 'tolls',
  peajes: 'tolls',
  casetas: 'tolls',
  caseta: 'tolls',
  wash: 'washing',
  'car wash': 'washing',
  'washing and detailing': 'washing',
  detailing: 'washing',
  lavado: 'washing',
  'lavado y detallado': 'washing',
  otro: 'other',
  otros: 'other',
};

function parseFlag(value: string, fallback: boolean): boolean | null {
  const text = words(value);
  if (text === '') return fallback;
  if (['yes', 'y', 'true', '1', 'x', 'si', 's'].includes(text)) return true;
  if (['no', 'n', 'false', '0'].includes(text)) return false;
  return null;
}

const characters = (value: string) => Array.from(value).length;
const carKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

type Cells = (field: ImportField) => string;
type RowContext = { line: number; cells: Cells; issues: ImportIssue[]; options: ImportOptions };

function readCar({ cells, issues, options }: RowContext, cars: Car[], mapped: boolean): Car | null {
  if (options.carId) {
    const car = cars.find((entry) => entry.id === options.carId);
    if (!car) issues.push({ code: 'missingCar' });
    return car ?? null;
  }
  const name = mapped ? cells('car').trim() : '';
  if (!name) {
    issues.push({ code: 'missingCar' });
    return null;
  }
  const matches = cars.filter((car) => carKey(car.name) === carKey(name));
  // Prefer an active vehicle when an archived one shares its name.
  const car = matches.find((entry) => !entry.isArchived) ?? matches[0];
  if (!car) issues.push({ code: 'unknownCar', values: { name } });
  return car ?? null;
}

function readDate({ cells, issues, options }: RowContext, field: 'date' | 'renewsOn') {
  const text = cells(field).trim();
  if (!text) {
    if (field === 'date') issues.push({ code: 'missingDate' });
    return null;
  }
  const date = parseImportDate(text, options.dateOrder);
  if (!date) issues.push({ code: field === 'date' ? 'invalidDate' : 'invalidRenewal' });
  else if (field === 'date' && date > options.today) issues.push({ code: 'futureDate' });
  return date;
}

function readCurrency({ cells, issues, options }: RowContext): Currency {
  const text = cells('currency').trim().toUpperCase();
  if (!text) return options.currency;
  if (isCurrency(text)) return text;
  issues.push({ code: 'invalidCurrency', values: { value: cells('currency').trim() } });
  return options.currency;
}

function readOdometer(context: RowContext, car: Car | null, required: boolean): number | null {
  const { cells, issues } = context;
  const text = cells('odometer').trim();
  const unitText = cells('distanceUnit').trim();
  if (car && unitText) {
    const unit = parseDistanceUnit(unitText);
    if (unit !== car.distanceUnit)
      issues.push({
        code: 'distanceUnitMismatch',
        values: { value: unitText, unit: distanceAbbreviation(car.distanceUnit) },
      });
  }
  if (!text) {
    if (required) issues.push({ code: 'missingOdometer' });
    return null;
  }
  const odometer = parseOdometer(text);
  if (odometer === null) issues.push({ code: 'invalidOdometer' });
  return odometer;
}

function readText(
  { cells, issues }: RowContext,
  field: ImportField,
  max: number,
  label: string,
): string {
  const text = cells(field).trim();
  if (characters(text) > max) issues.push({ code: 'textTooLong', values: { field: label, max } });
  return text;
}

const splitItems = (value: string) =>
  value
    .split(/[;\n|]/)
    .map((name) => name.trim().replace(/\s+/g, ' '))
    .filter(Boolean);

// "Oil change: 49.99; Rotation: 20.00", as exported, matched to items by name.
function readItemCosts(context: RowContext, items: VisitItem[]) {
  const text = context.cells('itemCosts').trim();
  if (!text) return;
  const remaining = [...items];
  for (const part of text.split(/[;\n|]/)) {
    if (!part.trim()) continue;
    const separator = part.lastIndexOf(':');
    const name = separator === -1 ? '' : part.slice(0, separator).trim().replace(/\s+/g, ' ');
    const cents = separator === -1 ? null : parseMoney(part.slice(separator + 1));
    const item = remaining.find(
      (entry) => entry.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    );
    if (!item || cents === null) {
      context.issues.push({ code: 'invalidItemCosts', values: { value: part.trim() } });
      return;
    }
    item.costCents = cents;
    remaining.splice(remaining.indexOf(item), 1);
  }
}

function buildVisit(
  context: RowContext,
  snapshot: Snapshot,
  mapping: ImportMapping,
  createdAt: string,
): Visit | null {
  const { issues, options } = context;
  const car = readCar(context, snapshot.cars, mapping.car !== undefined);
  const date = readDate(context, 'date');
  const odometer = readOdometer(context, car, false);
  const names = splitItems(context.cells('items'));
  if (!names.length) issues.push({ code: 'missingItems' });
  // An item named like one of the vehicle's active tasks completes that task, as in the form.
  const schedules = snapshot.schedules.filter(
    (item: ScheduleItem) => item.carId === car?.id && item.isActive,
  );
  const items: VisitItem[] = names.map((name) => ({
    id: options.newId(),
    name,
    scheduleItemId:
      schedules.find((item) => item.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())
        ?.id ?? null,
    costCents: null,
  }));
  readItemCosts(context, items);
  const totalText = context.cells('total').trim();
  const total = totalText ? parseMoney(totalText) : 0;
  if (total === null) issues.push({ code: 'invalidAmount' });
  else if (items.reduce((sum, item) => sum + (item.costCents ?? 0), 0) > total)
    issues.push({ code: 'itemCostsTooHigh' });
  const currency = readCurrency(context);
  const provider = readText(context, 'provider', TEXT_MAX_LENGTH, 'provider');
  const notes = readText(context, 'notes', NOTES_MAX_LENGTH, 'notes');
  if (!car || !date || total === null || issues.length) return null;
  return {
    id: options.newId(),
    carId: car.id,
    date,
    odometer,
    totalCostCents: total,
    currency,
    conversions: {},
    provider,
    notes,
    items,
    photos: [],
    createdAt,
  };
}

function buildFuelEntry(
  context: RowContext,
  snapshot: Snapshot,
  mapping: ImportMapping,
  createdAt: string,
): FuelEntry | null {
  const { cells, issues, options } = context;
  const car = readCar(context, snapshot.cars, mapping.car !== undefined);
  const date = readDate(context, 'date');
  const odometer = readOdometer(context, car, true);
  const volumeText = plainDecimal(cells('volume'));
  const volumeMilli = volumeText === null ? null : parseMilli(volumeText);
  if (!cells('volume').trim()) issues.push({ code: 'missingVolume' });
  else if (volumeMilli === null || volumeMilli < 1 || volumeMilli > MAX_VOLUME_MILLI)
    issues.push({ code: 'invalidVolume' });
  const unitText = cells('volumeUnit').trim();
  const volumeUnit = unitText ? parseVolumeUnit(unitText) : defaultVolumeUnit(car ?? undefined);
  if (!volumeUnit) issues.push({ code: 'invalidVolumeUnit', values: { value: unitText } });
  // Either price or total is enough; the other is computed like in the fill-up form.
  const priceText = cells('unitPrice').trim();
  const priceDecimal = priceText ? plainDecimal(priceText) : null;
  let unitPriceMilli = priceDecimal === null ? null : parseMilli(priceDecimal);
  if (priceText && unitPriceMilli === null) issues.push({ code: 'invalidUnitPrice' });
  const totalText = cells('total').trim();
  let total = totalText ? parseMoney(totalText) : null;
  if (totalText && total === null) issues.push({ code: 'invalidAmount' });
  if (!priceText && !totalText) issues.push({ code: 'missingFuelPrice' });
  const validVolume = volumeMilli !== null && volumeMilli >= 1 && volumeMilli <= MAX_VOLUME_MILLI;
  if (validVolume && total === null && unitPriceMilli !== null && !totalText) {
    total = computeTotalCents(volumeMilli, unitPriceMilli);
    if (total > MAX_INTEGER) issues.push({ code: 'invalidAmount' });
  } else if (validVolume && total !== null && unitPriceMilli === null && !priceText) {
    unitPriceMilli = computeUnitPriceMilli(total, volumeMilli);
    if (unitPriceMilli === null) issues.push({ code: 'invalidUnitPrice' });
  }
  const fuelText = cells('fuelType').trim();
  let fuelType: FuelType = 'other';
  if (fuelText) {
    const known = FUEL_ALIASES[words(fuelText)];
    if (known) fuelType = known;
    else issues.push({ code: 'unknownFuelType', values: { value: fuelText } });
  }
  const isFullTank = parseFlag(cells('fullTank'), true);
  const missedPrevious = parseFlag(cells('missedPrevious'), false);
  if (isFullTank === null || missedPrevious === null) issues.push({ code: 'invalidFlag' });
  const currency = readCurrency(context);
  const station = readText(context, 'station', STATION_MAX_LENGTH, 'station');
  const notes = readText(context, 'notes', FUEL_NOTES_MAX_LENGTH, 'notes');
  if (
    !car ||
    !date ||
    odometer === null ||
    !validVolume ||
    !volumeUnit ||
    unitPriceMilli === null ||
    total === null ||
    isFullTank === null ||
    missedPrevious === null ||
    issues.some((issue) => issue.code !== 'unknownFuelType')
  )
    return null;
  return {
    id: options.newId(),
    carId: car.id,
    date,
    odometer,
    volumeMilli: volumeMilli!,
    volumeUnit,
    fuelType,
    unitPriceMilli,
    totalCostCents: total,
    currency,
    conversions: {},
    isFullTank,
    missedPrevious,
    station,
    notes,
    photos: [],
    createdAt,
  };
}

function buildExpense(
  context: RowContext,
  snapshot: Snapshot,
  mapping: ImportMapping,
  createdAt: string,
): Expense | null {
  const { cells, issues, options } = context;
  const car = readCar(context, snapshot.cars, mapping.car !== undefined);
  const date = readDate(context, 'date');
  const categoryText = cells('category').trim();
  let description = readText(context, 'description', EXPENSE_DESCRIPTION_MAX_LENGTH, 'description');
  let category: ExpenseCategory = 'other';
  if (!categoryText) issues.push({ code: 'missingCategory' });
  else {
    const key = words(categoryText);
    const known = isExpenseCategory(key) ? key : CATEGORY_ALIASES[key];
    if (known) category = known;
    else {
      // Kept as an "Other" cost, with the file's category as its description.
      issues.push({ code: 'unknownCategory', values: { value: categoryText } });
      if (!description) description = categoryText.slice(0, EXPENSE_DESCRIPTION_MAX_LENGTH);
    }
  }
  const totalText = cells('total').trim();
  const total = totalText ? parseMoney(totalText) : null;
  if (!totalText) issues.push({ code: 'missingAmount' });
  else if (total === null) issues.push({ code: 'invalidAmount' });
  const currency = readCurrency(context);
  const renewsOn = readDate(context, 'renewsOn');
  if (renewsOn && date && renewsOn <= date) issues.push({ code: 'invalidRenewal' });
  const notes = readText(context, 'notes', EXPENSE_NOTES_MAX_LENGTH, 'notes');
  if (!car || !date || total === null || issues.some((issue) => issue.code !== 'unknownCategory'))
    return null;
  return {
    id: options.newId(),
    carId: car.id,
    date,
    category,
    description,
    totalCostCents: total,
    currency,
    conversions: {},
    renewsOn,
    notes,
    createdAt,
  };
}

// What makes two records the same receipt, whichever device or file it came from.
const duplicateKeys = {
  visit: (visit: Visit) =>
    JSON.stringify([visit.carId, visit.date, visit.odometer, visit.totalCostCents, visit.currency]),
  fuel: (entry: FuelEntry) =>
    JSON.stringify([
      entry.carId,
      entry.date,
      entry.odometer,
      entry.volumeMilli,
      entry.totalCostCents,
    ]),
  expense: (expense: Expense) =>
    JSON.stringify([
      expense.carId,
      expense.date,
      expense.category,
      expense.totalCostCents,
      expense.currency,
    ]),
};

/**
 * Reads every data row into a record of the given kind and classifies it: ready to save, a
 * duplicate of a saved record or an earlier row, or an error that blocks it. Fill-up odometers
 * must also stay in order with the vehicle's saved fill-ups and the file's other fill-ups.
 */
export function buildImportPreview<K extends ImportKind>(
  kind: K,
  table: string[][],
  mapping: ImportMapping,
  snapshot: Snapshot,
  options: ImportOptions,
): ImportPreview<ImportRecord[K]> {
  const body = table.slice(1, MAX_IMPORT_ROWS + 1);
  const skipped = Math.max(0, table.length - 1 - MAX_IMPORT_ROWS);
  const build = { visit: buildVisit, fuel: buildFuelEntry, expense: buildExpense }[kind] as (
    context: RowContext,
    snapshot: Snapshot,
    mapping: ImportMapping,
    createdAt: string,
  ) => ImportRecord[K] | null;
  const rows: ImportRow<ImportRecord[K]>[] = body.map((cells, index) => {
    const read: Cells = (field) => {
      const column = mapping[field];
      return column === undefined ? '' : unguardCell(cells[column] ?? '');
    };
    const issues: ImportIssue[] = [];
    const createdAt = new Date(options.now + index).toISOString();
    const record = build(
      { line: index + 2, cells: read, issues, options },
      snapshot,
      mapping,
      createdAt,
    );
    return { line: index + 2, status: record ? 'ready' : 'error', issues, record };
  });

  if (kind === 'fuel') {
    const imported = rows.flatMap((row) => (row.record ? [row.record as FuelEntry] : []));
    const all = [...snapshot.fuelEntries, ...imported];
    for (const row of rows) {
      if (!row.record || fuelOdometerInOrder(row.record as FuelEntry, all)) continue;
      row.issues.push({ code: 'odometerOrder' });
      row.status = 'error';
      row.record = null;
    }
  }

  const key = duplicateKeys[kind] as (record: ImportRecord[K]) => string;
  const existing = {
    visit: snapshot.visits,
    fuel: snapshot.fuelEntries,
    expense: snapshot.expenses,
  }[kind] as ImportRecord[K][];
  const seen = new Set(existing.map(key));
  for (const row of rows) {
    if (!row.record) continue;
    const value = key(row.record);
    if (seen.has(value)) row.status = 'duplicate';
    seen.add(value);
  }

  return {
    rows,
    ready: rows.filter((row) => row.status === 'ready').length,
    duplicates: rows.filter((row) => row.status === 'duplicate').length,
    errors: rows.filter((row) => row.status === 'error').length,
    skipped,
  };
}

/** The records an import saves: ready rows, plus duplicates when the owner keeps them. */
export function recordsToImport<T>(preview: ImportPreview<T>, includeDuplicates: boolean): T[] {
  return preview.rows.flatMap((row) =>
    row.record && (row.status === 'ready' || (includeDuplicates && row.status === 'duplicate'))
      ? [row.record]
      : [],
  );
}
