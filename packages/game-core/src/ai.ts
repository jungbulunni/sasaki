// AI 플레이어 — "적당히 하는 사람" 수준.
// 원칙: 자기 주패와 모두가 볼 수 있는 정보(판 위 카드, 남은 장수, 공개된 불)만 사용한다.
// 다른 사람의 주패는 절대 읽지 않는다 (aiView 로 걸러낸 정보만 판단에 씀).

import { CardId, rankOf, Rng } from './cards';
import { canBeat, Combo, ComboKind, enumerateCombos } from './combos';
import { HandAction, HandState, NO_FINISH_KINDS, Play, specialOptions, teamOf } from './hand';

const STRONG: ComboKind[] = ['teul', 'sasaki', 'madae', 'bulpig'];

/** AI가 볼 수 있는 정보만 담은 요약 */
export interface AiView {
  seat: number;
  hand: CardId[];
  phase: HandState['phase'];
  activeSeat: number;
  trick: Play[];
  counts: number[];
  fireOwner: boolean;
  canDdook: boolean;
  window: { type: 'kkotda' | 'blackpig'; cards: CardId[]; baseSeat: number | null } | null;
  options: { type: 'chatda' | 'mureugi'; cards: CardId[] }[];
  /** 불이 공개된 자리 (모두에게 보이는 정보) */
  revealedFire: number[];
}

export function aiView(st: HandState, seat: number): AiView {
  return {
    seat,
    hand: [...st.hands[seat]],
    phase: st.phase,
    activeSeat: st.activeSeat,
    trick: st.trick,
    counts: st.hands.map((h) => h.length),
    fireOwner: st.fireOwners.includes(seat),
    canDdook: st.phase === 'ddook-declare' && st.runner !== null && teamOf(st, seat) !== teamOf(st, st.runner),
    window: st.window && st.window.seat === seat
      ? { type: st.window.type, cards: st.window.type === 'kkotda' ? st.window.cards : [], baseSeat: st.window.type === 'kkotda' ? st.window.baseSeat : null }
      : null,
    options: specialOptions(st, seat),
    revealedFire: [...st.revealedFire],
  };
}

/** 주패 힘 점수: 달리기·뚝 판단용 */
function handStrength(hand: CardId[]): number {
  const byRank = new Map<number, number>();
  for (const c of hand) byRank.set(rankOf(c), (byRank.get(rankOf(c)) ?? 0) + 1);
  let s = 0;
  for (const [r, n] of byRank) {
    if (r === 14) s += 2 * n;
    else if (r === 13) s += n;
    if (n === 3) s += 3;
    if (n === 4) s += 6;
  }
  if (hand.includes('H10') && hand.includes('D10')) s += 6;
  return s;
}

/** 같은 기회에는 같은 결정을 내리도록 하는 고정 난수 (상황이 바뀔 때마다 다시 굴려 결국 차버리는 일 방지) */
function stableRoll(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** 공개 정보만으로 확실히 알 수 있는 같은 편 (2대2) */
function knownTeammate(v: AiView): number | null {
  const myFire = v.hand.some((c) => c === 'H10' || c === 'D10');
  const others = v.revealedFire.filter((s) => s !== v.seat);
  if (myFire && others.length === 1 && !(v.hand.includes('H10') && v.hand.includes('D10'))) return others[0];
  if (!myFire && others.length === 2) return [0, 1, 2, 3].find((s) => s !== v.seat && !others.includes(s)) ?? null;
  return null;
}

const countRank = (hand: CardId[], r: number) => hand.filter((c) => rankOf(c) === r).length;

/**
 * 찼다(차기)를 할 가치가 있는지 — 아낄 이유가 있으면 확률적으로 아낀다.
 *  - 다 내거나 거의 다 내게 되면 무조건 찬다
 *  - 같은 숫자 3·4장(틀·마대)을 깨게 되면 아낀다
 *  - 쌍카(연속 페어)의 일부면 아낀다
 *  - 확실한 같은 편이 낸 카드면 아낀다 (같은 편의 흐름을 끊지 않음)
 *  - A·K 페어는 강한 페어로 남겨두기도 한다
 *  - 상대가 곧 나갈 것 같으면 선을 잡으러 적극적으로 찬다
 */
function chatdaWorth(v: AiView, opt: { cards: CardId[] }, danger: boolean): number {
  const left = v.hand.length - opt.cards.length;
  if (left <= 2) return 1;
  const top = v.trick.at(-1);
  if (opt.cards.length > 2) return danger ? 0.95 : 0.8; // 쌍카 찼다
  const r = rankOf(opt.cards[0]);
  let p = 0.92;
  const n = countRank(v.hand, r);
  if (n === 4) p *= 0.15;
  else if (n === 3) p *= 0.3;
  if (countRank(v.hand, r - 1) >= 2 && countRank(v.hand, r + 1) >= 2) p *= 0.4;
  else if ((countRank(v.hand, r - 1) >= 2 && countRank(v.hand, r - 2) >= 2) || (countRank(v.hand, r + 1) >= 2 && countRank(v.hand, r + 2) >= 2)) p *= 0.5;
  const mate = knownTeammate(v);
  const target = v.options.find((o) => o.type === 'mureugi') && opt === v.options.find((o) => o.type === 'mureugi')
    ? v.trick.at(-2)?.seat : top?.seat;
  if (mate !== null && target === mate) p *= 0.25;
  if (r >= 13) p *= 0.75;
  if (danger) p = Math.max(p, 0.85);
  return p;
}

/** 꽂다를 할 가치가 있는지 */
function kkotdaWorth(v: AiView, danger: boolean): number {
  const cards = v.window!.cards;
  if (v.hand.length - cards.length <= 1) return 1;
  let p = 0.9;
  const mate = knownTeammate(v);
  if (mate !== null && v.window!.baseSeat === mate) p *= 0.25; // 같은 편이 이미 선을 잡음
  if (cards.length === 1) {
    const r = rankOf(cards[0]);
    const has = (x: number) => countRank(v.hand, x) > 0;
    if ((has(r - 1) && has(r + 1)) || (has(r - 1) && has(r - 2)) || (has(r + 1) && has(r + 2))) p *= 0.5; // 닐리리 재료
    if (r === 14) p *= 0.7;
  }
  if (danger) p = Math.max(p, 0.85);
  return p;
}

const legal = (v: AiView): Combo[] => {
  const top = v.trick.at(-1)?.combo ?? null;
  return enumerateCombos(v.hand).filter((c) => canBeat(c, top) && !(NO_FINISH_KINDS.includes(c.kind) && c.cards.length === v.hand.length));
};

/**
 * 지금 이 AI가 할 행동. 할 일이 없으면 null (기다림).
 * 낼 패가 전혀 없을 때는 null → 서버의 2초 자동 패스에 맡긴다 (사람과 똑같이 보이게).
 */
export function aiDecide(v: AiView, rng: Rng): HandAction | null {
  const seat = v.seat;
  if (v.phase === 'run-declare') {
    if (v.fireOwner && handStrength(v.hand) >= 11 && rng() < 0.7) return { type: 'declareRun', seat };
    return null;
  }
  if (v.phase === 'ddook-declare') {
    if (v.canDdook && handStrength(v.hand) >= 10 && rng() < 0.6) return { type: 'declareDdook', seat };
    return null;
  }
  const others = v.counts.filter((_, i) => i !== seat && v.counts[i] > 0);
  const danger = others.some((n) => n <= 2); // 누가 곧 나갈 것 같으면 강하게
  const situation = `${seat}|${v.hand.slice().sort().join('')}|${v.trick.map((p) => p.combo.cards.join('')).join('/')}`;

  if (v.window?.type === 'kkotda') {
    return stableRoll(`k|${situation}`) < kkotdaWorth(v, danger) ? { type: 'kkotda', seat } : { type: 'kkotdaPass', seat };
  }
  if (v.window?.type === 'blackpig') return rng() < 0.85 ? { type: 'blackPigSubmit', seat } : { type: 'blackPigPass', seat };
  if (v.phase !== 'turn') return null;

  // 찼다·차기: 전략적으로 판단 (같은 기회에는 같은 결정)
  for (const opt of v.options) {
    if (stableRoll(`c|${opt.type}|${situation}`) < chatdaWorth(v, opt, danger)) return { type: opt.type, seat, cards: opt.cards };
  }

  if (v.activeSeat !== seat) return null;
  const plays = legal(v);
  // 낼 패가 없을 때: 찰 수 있지만 아끼기로 했으면 직접 패스 (아니면 서버의 2초 자동 패스)
  if (!plays.length) return v.options.length && v.trick.length ? { type: 'pass', seat } : null;

  const endgame = v.hand.length <= 4;
  const weak = plays.filter((c) => !STRONG.includes(c.kind));
  const pool = weak.length ? weak : (danger || endgame ? plays : []);
  if (!pool.length) return v.trick.length ? { type: 'pass', seat } : { type: 'play', seat, cards: plays[0].cards };

  // 선: 낮은 숫자부터, 같은 높이면 많이 털어내는 쪽
  // 받아치기: 이길 수 있는 가장 약한 패
  const score = (c: Combo) => c.top * 10 - c.cards.length * (v.trick.length ? 0 : 4) + (breaksPair(v.hand, c) ? 6 : 0);
  pool.sort((a, b) => score(a) - score(b));
  const pick = pool[0];

  // 받아치는데 A·K 같은 높은 패를 초반에 쓰게 되면 가끔 아낀다
  if (v.trick.length && !danger && !endgame && pick.top >= 13 && rng() < 0.45) return { type: 'pass', seat };
  return { type: 'play', seat, cards: pick.cards };
}

/** 싱글로 내면 페어(찰 기회)가 깨지는지 */
function breaksPair(hand: CardId[], c: Combo) {
  if (c.kind !== 'single') return false;
  return hand.filter((x) => rankOf(x) === c.top).length >= 2;
}

/** 사람처럼 보이는 반응 시간 (밀리초) */
export function aiDelay(a: HandAction, rng: Rng): number {
  const between = (lo: number, hi: number) => Math.round(lo + (hi - lo) * (rng() + rng()) / 2);
  switch (a.type) {
    case 'chatda': case 'mureugi': return between(700, 1800);
    case 'kkotda': case 'blackPigSubmit': case 'blackPigPass': return between(800, 2200);
    case 'declareRun': case 'declareDdook': return between(1200, 3500);
    case 'pass': return between(1200, 3000);
    default: return between(1300, 3800);
  }
}

/** 재치있는 AI 닉네임 (8자 이내) */
export const AI_NAMES = ['눈치백단', '패스장인', '꽂고본다', '돼지사냥꾼', '타짜꿈나무', '찰까말까', '뚝심이', '알부자', '선잡이', '포커페이스', '무르지마', '불꽃손'];
