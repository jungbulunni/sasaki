import { describe, expect, it } from 'vitest';
import { canBeat, classifyCombo } from '../src/combos';

const c = (...cards: string[]) => classifyCombo(cards)!;
const beats = (a: string[], b: string[]) => canBeat(c(...a), c(...b));

describe('조합 식별', () => {
  it('싱글/페어/닐리리/쌍카/틀/사사끼/마대/불돼지를 구분한다', () => {
    expect(c('S3').kind).toBe('single');
    expect(c('S3', 'H3').kind).toBe('pair');
    expect(c('S3', 'H4', 'D5').kind).toBe('nilliri');
    expect(c('S12', 'H13', 'D14').kind).toBe('nilliri');
    expect(c('S4', 'H4', 'S5', 'H5', 'S6', 'H6').kind).toBe('ssangka');
    expect(c('S7', 'H7', 'D7').kind).toBe('teul');
    expect(c('S4', 'H4', 'D14').kind).toBe('sasaki');
    expect(c('S9', 'H9', 'D9', 'C9').kind).toBe('madae');
    expect(c('H10', 'D10').kind).toBe('bulpig');
  });
  it('흑돼지(♠10♣10)는 평소 일반 10 페어', () => {
    expect(c('S10', 'C10').kind).toBe('pair');
  });
  it('사사끼는 반드시 4·4·A (5·5·A 등은 조합 아님)', () => {
    expect(classifyCombo(['S5', 'H5', 'D14'])).toBeNull();
    expect(classifyCombo(['S4', 'H14', 'D14'])).toBeNull();
  });
  it('불연속·중복·A 넘어가기는 닐리리 아님', () => {
    expect(classifyCombo(['S3', 'H4', 'D6'])).toBeNull();
    expect(classifyCombo(['S13', 'H14', 'D3'])).toBeNull();
    expect(classifyCombo(['S3', 'S3', 'H4'])).toBeNull();
  });
});

describe('강약 비교 (2026-11-04 확정 규칙)', () => {
  it('같은 숫자 위에 같은 숫자는 낼 수 없다', () => {
    expect(beats(['H9'], ['S9'])).toBe(false);
    expect(beats(['S9', 'H9'], ['D9', 'C9'])).toBe(false);
    expect(beats(['S10', 'C10'], ['H10', 'S10'])).toBe(false); // 10 페어 위에 10 페어 불가
    expect(beats(['S11', 'H11', 'D11'], ['C11', 'S11', 'H11'])).toBe(false);
  });
  it('흑돼지를 일반 10 페어로 55·66·99 위에 낼 수 있다', () => {
    for (const p of [['S5', 'H5'], ['S6', 'H6'], ['S9', 'H9']]) expect(beats(['S10', 'C10'], p)).toBe(true);
  });
  it('길이가 다른 닐리리끼리는 비교할 수 없다', () => {
    expect(beats(['S5', 'H6', 'D7', 'C8'], ['S3', 'H4', 'D5'])).toBe(false);
    expect(beats(['S5', 'H6', 'D7'], ['S3', 'H4', 'D5'])).toBe(true);
  });
  it('쌍카는 같은 쌍 수끼리만 비교', () => {
    const s456 = ['S4', 'H4', 'S5', 'H5', 'S6', 'H6'];
    expect(beats(['D5', 'C5', 'D6', 'C6', 'S7', 'H7'], s456)).toBe(true);
    expect(beats(['D5', 'C5', 'D6', 'C6', 'S7', 'H7', 'S8', 'H8'], s456)).toBe(false);
  });
  it('틀은 싱글·페어·닐리리를 이기지만 쌍카는 못 이긴다', () => {
    expect(beats(['S3', 'H3', 'D3'], ['S14'])).toBe(true);
    expect(beats(['S3', 'H3', 'D3'], ['S14', 'H14'])).toBe(true);
    expect(beats(['S3', 'H3', 'D3'], ['S8', 'H9', 'D10', 'C11', 'S12'])).toBe(true);
    expect(beats(['S3', 'H3', 'D3'], ['S4', 'H4', 'S5', 'H5', 'S6', 'H6'])).toBe(false);
  });
  it('쌍카도 틀을 이기지 못한다', () => {
    expect(beats(['S12', 'H12', 'S13', 'H13', 'S14', 'H14'], ['S3', 'H3', 'D3'])).toBe(false);
  });
  it('사사끼는 AAA보다 높은 틀, 마대에는 진다', () => {
    expect(beats(['S4', 'H4', 'D14'], ['S14', 'H14', 'C14'])).toBe(true);
    expect(beats(['S14', 'H14', 'C14'], ['S4', 'H4', 'D14'])).toBe(false);
    expect(beats(['S3', 'H3', 'D3', 'C3'], ['S4', 'H4', 'D14'])).toBe(true);
  });
  it('마대는 싱글·페어·닐리리·틀·쌍카를 모두 이긴다', () => {
    const madae = ['S3', 'H3', 'D3', 'C3'];
    expect(beats(madae, ['S14'])).toBe(true);
    expect(beats(madae, ['S14', 'H14'])).toBe(true);
    expect(beats(madae, ['S12', 'H13', 'D14'])).toBe(true);
    expect(beats(madae, ['S14', 'H14', 'D14'])).toBe(true);
    expect(beats(madae, ['S12', 'H12', 'S13', 'H13', 'S14', 'H14'])).toBe(true);
    expect(beats(['S4', 'H4', 'D4', 'C4'], madae)).toBe(true);
  });
  it('불돼지는 마대·쌍카 등 모든 조합을 이긴다', () => {
    for (const x of [['S14'], ['S14', 'H14'], ['S14', 'H14', 'D14', 'C14'], ['S12', 'H12', 'S13', 'H13', 'S14', 'H14'], ['S4', 'H4', 'D14']])
      expect(beats(['H10', 'D10'], x)).toBe(true);
  });
  it('불돼지 위에는 일반 제출로 아무것도 낼 수 없다', () => {
    expect(beats(['S14', 'H14', 'D14', 'C14'], ['H10', 'D10'])).toBe(false);
    expect(beats(['S10', 'C10'], ['H10', 'D10'])).toBe(false);
  });
  it('선은 어떤 조합이든 낼 수 있다', () => {
    expect(canBeat(c('S3'), null)).toBe(true);
  });
});
