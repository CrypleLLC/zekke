import { describe, expect, it } from 'vitest';
import { canonicalizeFormula, localizeFormula } from '../formula-locale';
import { FUNCTION_NAME_TABLES, availableFunctionLanguages, functionNamesFor } from './index';

const NAME = /^[\p{Lu}][\p{Lu}\p{N}_]*(?:\.[\p{Lu}\p{N}_]+)*$/u;
const tables = Object.entries(FUNCTION_NAME_TABLES) as [string, Record<string, string>][];
const englishNames = new Set(tables.flatMap(([, table]) => Object.keys(table)));

describe('the function-name tables', () => {
  it('offer English and the five languages built from Microsoft’s articles', () => {
    expect(availableFunctionLanguages()).toEqual(['en', 'pt-BR', 'pt-PT', 'es', 'fr', 'de']);
  });

  it.each(tables)('%s covers the same functions as every other language', (_language, table) => {
    expect(Object.keys(table).sort()).toEqual(Object.keys(tables[0][1]).sort());
    expect(Object.keys(table).length).toBeGreaterThan(480);
  });

  it.each(tables)('%s gives each function one well-formed name that no other function has', (_language, table) => {
    const seen = new Map<string, string>();
    for (const [english, local] of Object.entries(table)) {
      expect(local, english).toMatch(NAME);
      const key = local.toLocaleUpperCase();
      expect(seen.get(key), `${english} and ${seen.get(key)} are both ${local}`).toBeUndefined();
      seen.set(key, english);
    }
  });

  it('reuse another function’s English name only where Excel does, and only these', () => {
    const reused = tables.flatMap(([language, table]) =>
      Object.entries(table)
        .filter(([english, local]) => local !== english && englishNames.has(local))
        .map(([english, local]) => `${language}: ${english} = ${local}`),
    );
    expect(reused).toEqual(['es: FIXED = DECIMAL', 'fr: MIRR = TRIM', 'fr: VARP = VAR.P']);
  });

  it.each(tables)('%s translates a formula using every function there and back', (language) => {
    const names = functionNamesFor(language as never)!;
    const table = FUNCTION_NAME_TABLES[language as never] as Record<string, string>;
    const canonical = `=${Object.keys(table).map((name) => `${name}(A1,1.5)`).join('+')}`;
    const local = localizeFormula(canonical, { decimal: ',', names });
    expect(local).toContain(`${table.SUM}(A1;1,5)`);
    expect(canonicalizeFormula(local, { decimal: ',', names })).toBe(canonical);
  });
});
