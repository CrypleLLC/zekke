export interface FunctionNames {
  toLocal: ReadonlyMap<string, string>;
  toCanonical: ReadonlyMap<string, string>;
}

export interface FormulaSyntax {
  decimal: '.' | ',';
  names?: FunctionNames;
}

export const CANONICAL_SYNTAX: FormulaSyntax = { decimal: '.' };

const IDENTIFIER = /[\p{L}_][\p{L}\p{N}_.]*/uy;
const NUMBER_CANONICAL = /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;
const NUMBER_LOCAL = /(?:\d+(?:,\d*)?|,\d+)(?:[eE][+-]?\d+)?/y;

export function functionNames(table: Readonly<Record<string, string>>): FunctionNames {
  const toLocal = new Map<string, string>();
  const toCanonical = new Map<string, string>();
  for (const [canonical, local] of Object.entries(table)) {
    toLocal.set(canonical.toUpperCase(), local);
    toCanonical.set(local.toLocaleUpperCase(), canonical.toUpperCase());
  }
  return { toLocal, toCanonical };
}

function isPlain(syntax: FormulaSyntax): boolean {
  return syntax.decimal === '.' && syntax.names === undefined;
}

function readQuoted(text: string, start: number, quote: string): number {
  let index = start + 1;
  while (index < text.length) {
    if (text[index] === quote) {
      if (text[index + 1] === quote) {
        index += 2;
        continue;
      }
      return index + 1;
    }
    index += 1;
  }
  return text.length;
}

function readBracketed(text: string, start: number): number {
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === '[') {
      depth += 1;
    } else if (text[index] === ']') {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
  }
  return text.length;
}

function nextNonSpace(text: string, index: number): string {
  let cursor = index;
  while (cursor < text.length && text[cursor] === ' ') {
    cursor += 1;
  }
  return text[cursor] ?? '';
}

function previousIsReferenceEnd(output: string): boolean {
  return /[\p{L}\p{N}_$.)\]]$/u.test(output);
}

function translate(formula: string, from: FormulaSyntax, to: FormulaSyntax, direction: 'local' | 'canonical'): string {
  if (!formula.startsWith('=') || (isPlain(from) && isPlain(to))) {
    return formula;
  }
  const fromArgument = from.decimal === ',' ? ';' : ',';
  const toArgument = to.decimal === ',' ? ';' : ',';
  const fromColumn = from.decimal === ',' ? '\\' : ',';
  const toColumn = to.decimal === ',' ? '\\' : ',';
  const numberPattern = from.decimal === ',' ? NUMBER_LOCAL : NUMBER_CANONICAL;
  let output = '=';
  let index = 1;
  let arrayDepth = 0;

  while (index < formula.length) {
    const character = formula[index];

    if (character === '"' || character === "'") {
      const end = readQuoted(formula, index, character);
      output += formula.slice(index, end);
      index = end;
      continue;
    }
    if (character === '[') {
      const end = readBracketed(formula, index);
      output += formula.slice(index, end);
      index = end;
      continue;
    }
    if (character === '{') {
      arrayDepth += 1;
      output += character;
      index += 1;
      continue;
    }
    if (character === '}') {
      arrayDepth = Math.max(0, arrayDepth - 1);
      output += character;
      index += 1;
      continue;
    }
    if (arrayDepth > 0 && character === fromColumn) {
      output += toColumn;
      index += 1;
      continue;
    }
    if (arrayDepth === 0 && character === fromArgument) {
      output += toArgument;
      index += 1;
      continue;
    }

    if (/\d/.test(character) || (character === from.decimal && /\d/.test(formula[index + 1] ?? ''))) {
      if (previousIsReferenceEnd(output) && /[\p{L}$]$/u.test(output)) {
        const digits = /\d+/y;
        digits.lastIndex = index;
        const match = digits.exec(formula);
        output += match?.[0] ?? character;
        index += match?.[0].length ?? 1;
        continue;
      }
      numberPattern.lastIndex = index;
      const match = numberPattern.exec(formula);
      if (match !== null) {
        output += from.decimal === to.decimal ? match[0] : match[0].replace(from.decimal, to.decimal);
        index += match[0].length;
        continue;
      }
    }

    IDENTIFIER.lastIndex = index;
    const identifier = IDENTIFIER.exec(formula);
    if (identifier !== null && !/[\p{L}\p{N}_$]$/u.test(output)) {
      const word = identifier[0];
      const after = index + word.length;
      const isCall = nextNonSpace(formula, after) === '(';
      const isBoolean = /^(TRUE|FALSE)$/i.test(word) || (from.names?.toCanonical.get(word.toLocaleUpperCase()) ?? '').match(/^(TRUE|FALSE)$/) !== null;
      const followedByReference = formula[after] === '!' || /^\$?\d/.test(formula.slice(after));
      if ((isCall || isBoolean) && !followedByReference) {
        output += renameFunction(word, from, to, direction);
      } else {
        output += word;
      }
      index = after;
      continue;
    }

    output += character;
    index += 1;
  }
  return output;
}

function renameFunction(word: string, from: FormulaSyntax, to: FormulaSyntax, direction: 'local' | 'canonical'): string {
  if (direction === 'local') {
    const canonical = word.toUpperCase();
    return to.names?.toLocal.get(canonical) ?? word;
  }
  const local = word.toLocaleUpperCase();
  return from.names?.toCanonical.get(local) ?? word;
}

export function localizeFormula(canonical: string, syntax: FormulaSyntax): string {
  return translate(canonical, CANONICAL_SYNTAX, syntax, 'local');
}

export function canonicalizeFormula(local: string, syntax: FormulaSyntax): string {
  return translate(local, syntax, CANONICAL_SYNTAX, 'canonical');
}

export function localizeNumber(value: number, syntax: FormulaSyntax): string {
  const text = String(value);
  return syntax.decimal === ',' ? text.replace('.', ',') : text;
}
