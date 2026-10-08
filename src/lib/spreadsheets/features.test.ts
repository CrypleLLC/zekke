import { describe, expect, it } from 'vitest';
import {
  CONDITIONAL_FEATURE,
  FILTER_FEATURE,
  FILTER_RULE_ID,
  VALIDATION_FEATURE,
  featureItemId,
  featureRuleId,
  filterBody,
  filterColumns,
  mapRuleFormulas,
} from './index';

const mark = (formula: string) => `[${formula}]`;

describe('a feature rule id', () => {
  it('prefixes each item id by feature, and gives the filter one id per sheet', () => {
    expect(featureRuleId(VALIDATION_FEATURE, 'abc')).toBe('dv:abc');
    expect(featureRuleId(CONDITIONAL_FEATURE, '12')).toBe('cf:12');
    expect(featureRuleId(FILTER_FEATURE)).toBe(FILTER_RULE_ID);
    expect(featureItemId(CONDITIONAL_FEATURE, 'cf:12')).toBe('12');
    expect(featureItemId(CONDITIONAL_FEATURE, 'dv:12')).toBeUndefined();
    expect(featureItemId(CONDITIONAL_FEATURE, 'chartid123')).toBeUndefined();
  });

  it('refuses an item id that is not a plain name', () => {
    expect(featureRuleId(VALIDATION_FEATURE, 'a:b')).toBeUndefined();
    expect(featureRuleId(VALIDATION_FEATURE, '')).toBeUndefined();
  });
});

describe('the formulas inside a rule', () => {
  it('maps a validation’s formulas, and leaves a typed list alone', () => {
    expect(mapRuleFormulas(VALIDATION_FEATURE, { type: 'list', formula1: '=A1:A3', formula2: 'x' }, mark)).toEqual({
      type: 'list',
      formula1: '[=A1:A3]',
      formula2: 'x',
    });
    expect(mapRuleFormulas(VALIDATION_FEATURE, { type: 'list', formula1: 'A1,B2' }, mark)).toEqual({ type: 'list', formula1: 'A1,B2' });
  });

  it('maps only the places a conditional format holds a formula', () => {
    const formula = { rule: { type: 'highlightCell', subType: 'formula', value: '=A1>1' } };
    expect(mapRuleFormulas(CONDITIONAL_FEATURE, formula, mark)).toEqual({ rule: { ...formula.rule, value: '[=A1>1]' } });
    const text = { rule: { type: 'highlightCell', subType: 'text', operator: 'containsText', value: '=A1' } };
    expect(mapRuleFormulas(CONDITIONAL_FEATURE, text, mark)).toEqual(text);
    const scale = {
      rule: {
        type: 'colorScale',
        config: [
          { index: 0, color: '#fff', value: { type: 'min' } },
          { index: 1, color: '#000', value: { type: 'formula', value: '=B1' } },
        ],
      },
    };
    expect((mapRuleFormulas(CONDITIONAL_FEATURE, scale, mark) as typeof scale).rule.config[1].value.value).toBe('[=B1]');
    const bar = { rule: { type: 'dataBar', config: { min: { type: 'formula', value: '=C1' }, max: { type: 'max' } } } };
    expect(mapRuleFormulas(CONDITIONAL_FEATURE, bar, mark)).toEqual({
      rule: { type: 'dataBar', config: { min: { type: 'formula', value: '[=C1]' }, max: { type: 'max' } } },
    });
  });
});

describe('a filter’s columns', () => {
  it('are stored by column id and read back by index, dropping a column that is gone', () => {
    const ids = ['c0', 'c1', 'c2'];
    const body = filterBody(
      [
        { colId: 2, filters: { filters: ['x'] } },
        { colId: 9, filters: { blank: true } },
      ],
      (index) => ids[index],
    );
    expect(body).toEqual({ columns: [{ column: 'c2', criteria: { filters: { filters: ['x'] } } }] });
    expect(filterColumns(body, (id) => ['new', ...ids].indexOf(id))).toEqual([{ colId: 3, criteria: { filters: { filters: ['x'] } } }]);
    expect(filterColumns(body, () => undefined)).toEqual([]);
  });
});
