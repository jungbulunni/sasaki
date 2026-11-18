// AI 팀플레이·막판 계산 (2026-11-18) — 사용자가 지적한 약점
import { describe, expect, it } from 'vitest';
import { CardId, seededRng } from '../src/cards';
import { aiDecide, aiView } from '../src/ai';
import { HandState } from '../src/hand';
import { ok, pass, play, setup } from './helpers';

function mk(hands: CardId[][], leader: number): HandState {
  const all = hands.flat();
  expect(new Set(all).size, '카드 중복').toBe(all.length);
  return setup(hands, leader);
}
const decide = (st: HandState, seat: number) => aiDecide(aiView(st, seat), seededRng(1));
const cardsOf = (a: ReturnType<typeof decide>) => (a as { cards: string[] }).cards.slice().sort();

describe('AI 팀플레이', () => {
  // 0번(♥10)과 2번(♦10)이 같은 편, 2번의 불이 공개된 상황
  it('같은 편이 A 페어로 선을 잡으려 하면 333(틀)으로 덮지 않는다 — 상대가 2장 남아 급해도', () => {
    let st = mk([
      ['H10', 'S3', 'H3', 'C3', 'S6', 'H8', 'C9', 'S12'],
      ['S7', 'H7'],
      ['D10', 'S14', 'H14', 'S5', 'H6', 'C8'],
      ['C4', 'D4', 'S9', 'H11', 'D12', 'C13', 'D13'],
    ], 2);
    st.revealedFire = [2];
    st = ok(st, play(2, 'S14', 'H14'));
    st = ok(st, pass(3));
    expect(decide(st, 0)).toEqual(pass(0));
  });

  it('같은 편이 1장 남았으면 선에서 낮은 싱글을 내 준다', () => {
    const st = mk([
      ['H10', 'S4', 'S8', 'H9', 'C11', 'S12', 'H13', 'D13'],
      ['S5', 'H5', 'C6', 'D7', 'S9', 'D11', 'H12', 'C14'],
      ['D10', 'C12'].slice(0, 2),
      ['C3', 'D3', 'H4', 'C5', 'S7', 'C8', 'D9', 'S13'],
    ], 0);
    st.revealedFire = [2];
    st.hands[2] = ['C12']; // 같은 편은 불을 이미 냄
    const d = decide(st, 0);
    expect(d).toEqual(play(0, 'S4'));
  });

  it('같은 편이 2장 남았으면 낮은 페어를 내 준다 (페어일 확률을 계산)', () => {
    const st = mk([
      ['H10', 'C4', 'S5', 'H5', 'S8', 'C11', 'H13', 'H14'],
      ['C3', 'D4', 'C6', 'D7', 'S9', 'D11', 'H12', 'C14'],
      ['D10', 'C12', 'D12'],
      ['D3', 'H4', 'C5', 'S7', 'C8', 'D9', 'S13', 'D13'],
    ], 0);
    st.revealedFire = [2];
    st.hands[2] = ['C12', 'D12'];
    expect(cardsOf(decide(st, 0))).toEqual(['H5', 'S5']);
  });

  it('같은 편이 3장 남았으면 닐리리일 확률을 계산해서 낮은 닐리리를 내 준다', () => {
    const st = mk([
      ['H10', 'S3', 'H4', 'S5', 'S8', 'C11', 'S12', 'H13', 'D14'],
      ['C3', 'D4', 'C6', 'D7', 'S9', 'D11', 'H12', 'C14'],
      ['D10', 'C7', 'H8', 'D9'],
      ['D3', 'C4', 'C5', 'S7', 'C8', 'H9', 'S13', 'D13'],
    ], 0);
    st.revealedFire = [2];
    st.hands[2] = ['C7', 'H8', 'D9'];
    expect(cardsOf(decide(st, 0))).toEqual(['H4', 'S3', 'S5']);
  });
});

describe('AI 1대1 막판', () => {
  // 1번(♦10, 0번의 같은 편)·2번은 이미 나감 → 0번과 상대 3번만 남음
  function oneVsOne(mine: CardId[], foe: CardId[]): HandState {
    const st = mk([['H10', ...mine], ['D10', 'S3'], ['H3'], foe], 0);
    st.revealedFire = [1];
    st.hands[1] = []; st.hands[2] = [];
    st.finished = [1, 2];
    return st;
  }

  it('상대가 1장 남았으면 싱글이 아닌 조합(페어)으로 시작한다', () => {
    const st = oneVsOne(['S5', 'H5', 'S9', 'S13'], ['C7']);
    expect(cardsOf(decide(st, 0))).toEqual(['H5', 'S5']);
  });

  it('상대가 1장 남았는데 싱글밖에 없으면 높은 숫자부터 낸다', () => {
    const st = oneVsOne(['S4', 'S8', 'S13', 'C6'], ['C7']);
    expect(decide(st, 0)).toEqual(play(0, 'S13'));
  });
});
