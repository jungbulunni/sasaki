import { expect } from 'vitest';
import { CardId } from '../src/cards';
import { applyHandAction, createHand, HandAction, HandEvent, HandState } from '../src/hand';

/** 테스트용 판 만들기. 불(♥10, ♦10)이 지정되지 않았으면 0번·1번 자리에 붙인다. 달리기 단계는 건너뜀. */
export function setup(hands: CardId[][], leader = 0, skipRun = true): HandState {
  const h = hands.map((x) => [...x]);
  if (!h.flat().includes('H10')) h[0].push('H10');
  if (!h.flat().includes('D10')) h[1].push('D10');
  let st = createHand(h, leader);
  if (skipRun) st = ok(st, { type: 'windowTimeout' });
  return st;
}

let lastEvents: HandEvent[] = [];
export const events = () => lastEvents;

/** 행동이 성공해야 함 */
export function ok(st: HandState, a: HandAction): HandState {
  const r = applyHandAction(st, a);
  if (!r.ok) throw new Error(`거절됨(${a.type}): ${r.reason}`);
  lastEvents = r.events;
  return r.state;
}

/** 행동이 거절되어야 함 */
export function rejected(st: HandState, a: HandAction) {
  const r = applyHandAction(st, a);
  expect(r.ok, `${a.type} 은(는) 거절되어야 함`).toBe(false);
}

export const play = (seat: number, ...cards: CardId[]): HandAction => ({ type: 'play', seat, cards });
export const pass = (seat: number): HandAction => ({ type: 'pass', seat });
export const chatda = (seat: number, ...cards: CardId[]): HandAction => ({ type: 'chatda', seat, cards });
export const mureugi = (seat: number, ...cards: CardId[]): HandAction => ({ type: 'mureugi', seat, cards });
