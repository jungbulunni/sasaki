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
  window: { type: 'kkotda' | 'blackpig' } | null;
  options: { type: 'chatda' | 'mureugi'; cards: CardId[] }[];
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
    window: st.window && st.window.seat === seat ? { type: st.window.type } : null,
    options: specialOptions(st, seat),
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
  if (v.window?.type === 'kkotda') return { type: 'kkotda', seat }; // 꽂으면 선을 가져가니 거의 항상 이득
  if (v.window?.type === 'blackpig') return rng() < 0.85 ? { type: 'blackPigSubmit', seat } : { type: 'blackPigPass', seat };
  if (v.phase !== 'turn') return null;

  // 찰 수 있으면 대부분 찬다 (선을 가져오는 좋은 기회)
  const opt = v.options[0];
  if (opt && rng() < 0.85) return { type: opt.type, seat, cards: opt.cards };

  if (v.activeSeat !== seat) return null;
  const plays = legal(v);
  if (!plays.length) return null;

  const others = v.counts.filter((_, i) => i !== seat && v.counts[i] > 0);
  const danger = others.some((n) => n <= 2); // 누가 곧 나갈 것 같으면 강하게
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
