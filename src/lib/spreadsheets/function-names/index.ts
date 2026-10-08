import type { FunctionLanguage } from '@/lib/regional';
import { functionNames, type FunctionNames } from '../formula-locale';
import de from './de.json';
import es from './es.json';
import fr from './fr.json';
import ptBR from './pt-BR.json';
import ptPT from './pt-PT.json';

export const FUNCTION_NAME_TABLES: Partial<Record<FunctionLanguage, Readonly<Record<string, string>>>> = {
  'pt-BR': ptBR,
  'pt-PT': ptPT,
  es,
  fr,
  de,
};

const built = new Map<FunctionLanguage, FunctionNames>();

export function availableFunctionLanguages(): FunctionLanguage[] {
  return ['en', ...(Object.keys(FUNCTION_NAME_TABLES) as FunctionLanguage[])];
}

export function functionNamesFor(language: FunctionLanguage): FunctionNames | undefined {
  const table = FUNCTION_NAME_TABLES[language];
  if (table === undefined) {
    return undefined;
  }
  let names = built.get(language);
  if (names === undefined) {
    names = functionNames(table);
    built.set(language, names);
  }
  return names;
}
