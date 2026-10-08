import { describe, expect, it } from 'vitest';
import { canonicalizeFormula, functionNames, localizeFormula, localizeNumber, type FormulaSyntax } from './formula-locale';

const NAMES = functionNames({ SUM: 'SOMA', IF: 'SE', VLOOKUP: 'PROCV', TRUE: 'VERDADEIRO', FALSE: 'FALSO', 'NETWORKDAYS.INTL': 'DIATRABALHOTOTAL.INTL', LOG10: 'LOG10', AND: 'E' });
const BRAZIL: FormulaSyntax = { decimal: ',', names: NAMES };
const COMMA_ONLY: FormulaSyntax = { decimal: ',' };
const NAMES_ONLY: FormulaSyntax = { decimal: '.', names: NAMES };

describe('a formula shown in the person’s syntax', () => {
  it.each([
    ['=SUM(A1,B2:C3)', '=SOMA(A1;B2:C3)'],
    ['=IF(A1>1.5,TRUE,FALSE)', '=SE(A1>1,5;VERDADEIRO;FALSO)'],
    ['=VLOOKUP("a,b;c",Sheet1!$A$1:$B$9,2,FALSE)', '=PROCV("a,b;c";Sheet1!$A$1:$B$9;2;FALSO)'],
    ["=SUM('Data, 2024'!A1:A3,.5)", "=SOMA('Data, 2024'!A1:A3;,5)"],
    ['=NETWORKDAYS.INTL(A1,B1,1)*1E-3', '=DIATRABALHOTOTAL.INTL(A1;B1;1)*1E-3'],
    ['=SUM({1,2.5;3,4})', '=SOMA({1\\2,5;3\\4})'],
    ['=LOG10(A10)+Total', '=LOG10(A10)+Total'],
    ['=SUM(1:3,A:C)', '=SOMA(1:3;A:C)'],
    ['=AND(A1,UNKNOWNFN(2.5))', '=E(A1;UNKNOWNFN(2,5))'],
    ['=Table1[Amount, total]', '=Table1[Amount, total]'],
  ])('%s → %s', (canonical, local) => {
    expect(localizeFormula(canonical, BRAZIL)).toBe(local);
    expect(canonicalizeFormula(local, BRAZIL)).toBe(canonical);
  });

  it('reads what the person typed in any case', () => {
    expect(canonicalizeFormula('=soma(a1;1,25)', BRAZIL)).toBe('=SUM(a1,1.25)');
    expect(canonicalizeFormula('=Se(A1;Verdadeiro;falso)', BRAZIL)).toBe('=IF(A1,TRUE,FALSE)');
  });

  it('changes only the separators when the names stay English, and only the names when the separators do', () => {
    expect(localizeFormula('=SUM(A1,1.5)', COMMA_ONLY)).toBe('=SUM(A1;1,5)');
    expect(localizeFormula('=SUM(A1,1.5)', NAMES_ONLY)).toBe('=SOMA(A1,1.5)');
    expect(canonicalizeFormula('=SOMA(A1,1.5)', NAMES_ONLY)).toBe('=SUM(A1,1.5)');
  });

  it('leaves text that is not a formula, and the canonical syntax, alone', () => {
    expect(localizeFormula('SUM(1,2)', BRAZIL)).toBe('SUM(1,2)');
    expect(localizeFormula('=SUM(1,2.5)', { decimal: '.' })).toBe('=SUM(1,2.5)');
  });

  it('writes a number with the person’s decimal sign', () => {
    expect(localizeNumber(1234.5, BRAZIL)).toBe('1234,5');
    expect(localizeNumber(-0.25, NAMES_ONLY)).toBe('-0.25');
    expect(localizeNumber(1e21, BRAZIL)).toBe('1e+21');
  });
});
