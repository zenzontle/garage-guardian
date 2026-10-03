import { createTranslator, type AbstractIntlMessages } from 'next-intl';
import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import es from '../../messages/es.json';
import { mergeMessages, resolveLocale } from './config';

function flatten(messages: AbstractIntlMessages, prefix = ''): Record<string, string> {
  return Object.fromEntries(Object.entries(messages).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string' ? [[path, value]] : Object.entries(flatten(value, path));
  }));
}
function placeholders(message: string) {
  return [...new Set([...message.matchAll(/\{(\w+)(?:,|\})/g)].map((match) => match[1]))].sort();
}

describe('translation contracts', () => {
  it('has matching recursive keys and ICU placeholders and formats every message without errors', () => {
    const english = flatten(en), spanish = flatten(es);
    expect(Object.keys(spanish).sort()).toEqual(Object.keys(english).sort());
    for (const [key, message] of Object.entries(english)) expect(placeholders(spanish[key]), key).toEqual(placeholders(message));
    for (const [locale, messages] of [['en', en], ['es', es]] as const) {
      for (const [key, message] of Object.entries(flatten(messages))) {
        const t = createTranslator({ locale, messages: { entry: { value: message } }, onError: (error) => { throw error; } });
        for (const count of [0, 1, 2]) {
          const values = Object.fromEntries(placeholders(message).map((name) => [name, ['count', 'total'].includes(name) ? count : 'example']));
          expect(t('entry.value', values), `${locale}.${key}`).not.toBe('entry.value');
        }
      }
    }
  });

  it('merges nested Spanish over English without mutating either dictionary', () => {
    const defaults = { shared: { save: 'Save', cancel: 'Cancel' }, title: 'Garage' };
    const merged = mergeMessages(defaults, { shared: { save: 'Guardar' } });
    expect(merged).toEqual({ shared: { save: 'Guardar', cancel: 'Cancel' }, title: 'Garage' });
    expect(defaults.shared.save).toBe('Save');
    const t = createTranslator({ locale: 'es', messages: merged as typeof defaults });
    expect(t('shared.cancel')).toBe('Cancel');
  });

  it('pluralizes complete English and Spanish sentences', () => {
    const english = createTranslator({ locale: 'en', messages: en });
    const spanish = createTranslator({ locale: 'es', messages: es });
    expect(english('app.vehicleCount', { count: 1 })).toBe('1 vehicle');
    expect(spanish('app.vehicleCount', { count: 0 })).toBe('0 vehículos');
    expect(spanish('app.vehicleCount', { count: 1 })).toBe('1 vehículo');
    expect(spanish('reports.visitCount', { count: 2 })).toBe('2 visitas de servicio en esta vista');
  });
});

it.each([
  ['en', ['es-MX'], 'en'], ['es', ['en-US'], 'es'],
  [null, ['fr-FR', 'es-MX', 'en-US'], 'es'], [null, ['en-GB', 'es'], 'en'],
  ['invalid', ['ES-ar'], 'es'], ['es-MX', ['en-US'], 'en'],
  [null, ['fr', 'ja'], 'en'], [null, [], 'en'],
])('resolves saved %s over browser %j to %s', (saved, languages, expected) => {
  expect(resolveLocale(saved, languages as string[])).toBe(expected);
});
