// AI 실력 개선 (2026-11-12) — 사용자가 지적한 다섯 가지 약점
import { describe, expect, it } from 'vitest';
import { CardId, seededRng } from '../src/cards';
import { aiDecide, aiView, pigThreat } from '../src/ai';
import { HandState } from '../src/hand';
import { ok, pass, play, setup } from './helpers';

// 채우기용 카드 (8·9·10·Q·K·A는 쓰지 않음 — 시험마다 자유롭게 씀)
const F34 = ['S3', 'H3', 'C3', 'D3', 'S4', 'H4', 'C4', 'D4'];
const F67 = ['S6', 'H6', 'C6', 'D6', 'S7', 'H7', 'C7', 'D7'];
const F5J = ['S5', 'H5', 'C5', 'D5', 'S11', 'H11', 'C11', 'D11'];
const rm = (list: CardId[], ...cards: CardId[]) => list.filter((c) => !cards.includes(c));

/** 카드가 겹치지 않는지 확인하고 판 만들기 (불이 없으면 helpers가 0·1번에 붙임) */
function mk(hands: CardId[][], leader: number): HandState {
  const all = hands.flat();
  expect(new Set(all).size, '카드 중복').toBe(all.length);
  return setup(hands, leader);
}
const decide = (st: HandState, seat: number) => aiDecide(aiView(st, seat), seededRng(1));

describe('AI 실력 개선', () => {
  it('① 돼지(♥10♦10)를 쪼개서 닐리리에 쓰지 않는다 — ♠10이 있으면 ♠10을 쓴다', () => {
    let st = mk([['H10', 'D10', 'S10', 'C8', 'C9', 'S14', 'H13'], ['S8', ...F34], rm([...F67, ...F5J], 'D5', 'D6', 'D7'), ['D5', 'D6', 'D7', 'S12', 'H12', 'D13', 'C13', 'D14']], 3);
    st = ok(st, play(3, 'D5', 'D6', 'D7'));
    const d = decide(st, 0);
    expect(d?.type).toBe('play');
    expect((d as { cards: string[] }).cards.sort()).toEqual(['C8', 'C9', 'S10']);
  });

  it('① ♠10이 없으면 돼지를 깨느니 통과한다', () => {
    let st = mk([['H10', 'D10', 'C8', 'C9', 'S14', 'H13', 'S8'], ['H8', ...F34], rm([...F67, ...F5J], 'D5', 'D6', 'D7'), ['D5', 'D6', 'D7', 'H12', 'D13', 'C13', 'D14', 'S10']], 3);
    st = ok(st, play(3, 'D5', 'D6', 'D7'));
    expect(decide(st, 0)).toEqual(pass(0));
  });

  it('② 틀을 찢어서 받지 않는다 — 8·8·8이 있어도 싱글 5 위에는 8이 아닌 패로', () => {
    let st = mk([['S8', 'H8', 'C8', 'S12', 'C9', 'H14'], ['H10', ...F34], ['D10', ...F67], rm(F5J, 'S5').concat(['D13', 'H13'])], 3);
    st = ok(st, play(3, 'H5'));
    expect(decide(st, 0)).toEqual(play(0, 'C9'));
  });

  it('② 막판에는 틀을 공격 카드로 써서 선을 잡고 남은 닐리리로 나간다', () => {
    let st = mk([['S8', 'H8', 'C8', 'S12', 'S13', 'H14'], ['H10', ...F34], ['D10', ...F67], rm(F5J, 'S5').concat(['D13', 'H13'])], 3);
    st = ok(st, play(3, 'H5'));
    expect(decide(st, 0)).toEqual(play(0, 'S8', 'H8', 'C8'));
  });

  it('② 사사끼(4·4·A)의 A를 싱글로 쓰지 않는다', () => {
    let st = mk([['S4', 'H4', 'S14', 'S8', 'H8', 'C9'], ['H10', ...rm(F34, 'S4', 'H4')], ['D10', ...F67], ['D12', ...F5J]], 3);
    st = ok(st, play(3, 'D12'));
    expect(decide(st, 0)).toEqual(pass(0));
  });

  it('③ 막판에 4와 Q가 남았으면 Q를 먼저 내서 선을 지킨다', () => {
    const st = mk([['S4', 'H12'], ['H10', 'C9'], ['D10', 'S8'], ['C3', 'D6']], 0);
    expect(decide(st, 0)).toEqual(play(0, 'H12'));
  });

  it('③ 막판에 틀과 한 장이 남았으면 틀을 먼저 낸다 (틀은 마지막에 낼 수 없음)', () => {
    const st = mk([['S7', 'H7', 'C7', 'S3'], ['H10', 'C9', 'D9'], ['D10', 'S8', 'H8'], ['C3', 'D6', 'H6']], 0);
    expect(decide(st, 0)).toEqual(play(0, 'S7', 'H7', 'C7'));
  });

  it('④ 불돼지가 아직 나올 수 있으면 흑돼지를 10 페어로 쓰지 않는다', () => {
    let st = mk([['S10', 'C10', 'S3', 'S5', 'S7', 'S9'], ['H10', ...rm(F34, 'S3')], ['D10', ...rm(F67, 'S7')], ['D8', 'H8', ...rm(F5J, 'S5')]], 3);
    expect(pigThreat(aiView(st, 0))).toBeGreaterThan(0);
    st = ok(st, play(3, 'D8', 'H8'));
    expect(decide(st, 0)).toEqual(pass(0));
  });

  it('④ 상대가 불돼지를 내면 흑돼지로 막는다', () => {
    let st = mk([['S10', 'C10', 'S3', 'S5', 'S7', 'S9'], ['S8', ...rm(F34, 'S3')], ['C8', ...rm(F67, 'S7')], ['H10', 'D10', ...rm(F5J, 'S5')]], 3);
    st = ok(st, play(3, 'H10', 'D10'));
    expect(st.window?.type).toBe('blackpig');
    expect(decide(st, 0)).toEqual({ type: 'blackPigSubmit', seat: 0 });
  });

  it('⑤ 네 번째 카드가 남아 있어 꽂힐 수 있으면 찼다를 아낀다', () => {
    // 0번이 5·5, 1번이 싱글 5를 냄, 남은 5 한 장은 다른 사람 손에
    let st = mk([['S5', 'H5', 'S8', 'H9', 'C12', 'C13', 'S14'], ['C5', 'H10', ...F34], ['D5', 'D10', ...F67], rm(F5J, 'S5', 'H5', 'C5', 'D5').concat(['D8', 'D9'])], 1);
    st = ok(st, play(1, 'C5'));
    expect(decide(st, 0)?.type).not.toBe('chatda');
  });

  it('⑤ 네 번째 카드가 이미 나왔으면 찼다로 확실히 선을 잡는다', () => {
    // 3·4·5·6 닐리리로 5 하나가 이미 나옴 → 다음에 누가 싱글 5를 내면 꽂힐 일이 없다
    let st = mk([['S5', 'H5', 'S8', 'H9', 'C12', 'C13', 'S14'], ['C3', 'C4', 'D5', 'C6', 'C5', 'H10', 'S9'], ['D10', ...rm(F34, 'C3', 'C4')], ['D8', 'C9', ...rm(F67, 'C6')]], 1);
    st = ok(st, play(1, 'C3', 'C4', 'D5', 'C6'));
    st = ok(st, pass(2)); st = ok(st, pass(3)); st = ok(st, pass(0));
    expect(st.trick.length).toBe(0);
    st = ok(st, play(1, 'C5'));
    expect(decide(st, 0)?.type).toBe('chatda');
  });
});
