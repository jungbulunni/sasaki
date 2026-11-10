// AI 플레이어 — "적당히 하는 사람" 수준 + 팀플레이.
// 원칙: 자기 주패와 모두가 볼 수 있는 정보(판 위 카드, 남은 장수, 공개된 불)만 사용한다.
// 다른 사람의 주패는 절대 읽지 않는다 (aiView 로 걸러낸 정보만 판단에 씀).

import { CardId, isFire, rankOf, Rng, seededRng } from './cards';
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
  /** 이미 판 위에 나왔다가 치워진 카드 (모두가 본 정보) */
  discard: CardId[];
  /** 모두가 알게 된 돼지 자리 (불돼지를 냈거나, 돼지가 달려서 불 두 장을 보였거나, 불 두 장을 모두 낸 사람) */
  pigSeat: number | null;
  /** 이미 완주한 자리 */
  finished: number[];
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
    discard: [...st.discard],
    pigSeat: publicPig(st),
    finished: [...st.finished, ...(st.provisional !== null ? [st.provisional] : [])],
  };
}

function publicPig(st: HandState): number | null {
  if (st.teamMode !== 'pig-1v3') return null;
  const pig = st.fireOwners[0];
  if (!st.revealedFire.includes(pig)) return null;
  // 달리기로 두 장을 다 보였거나, 손에 불이 하나도 안 남았으면(두 장 다 냄) 모두가 안다
  return st.runner === pig || !st.hands[pig].some(isFire) ? pig : null;
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

/**
 * 자리마다 '나와 같은 편일 확률' (공개 정보 + 내 주패만으로 계산).
 *  - 내가 불 두 장(돼지) → 모두 상대
 *  - 내가 불 한 장 → 다른 불 주인이 같은 편. 공개되면 확실, 아니면 나머지 셋 중 하나
 *  - 내가 불이 없음 → 불이 없는 다른 사람이 같은 편 (돼지 판이면 돼지 빼고 모두 같은 편)
 */
export function mateProbs(v: AiView): number[] {
  const p = [0, 0, 0, 0];
  const others = [0, 1, 2, 3].filter((s) => s !== v.seat);
  const myFire = v.hand.filter(isFire).length;
  if (myFire === 2) return p;
  if (v.pigSeat !== null) { // 돼지가 공개됨 → 나는 흑팀, 돼지 빼고 모두 같은 편
    for (const s of others) p[s] = s === v.pigSeat ? 0 : 1;
    return p;
  }
  const shown = v.revealedFire.filter((s) => s !== v.seat);
  if (myFire === 1) {
    if (shown.length) { p[shown[0]] = 1; return p; }
    for (const s of others) p[s] = 1 / 3;
    return p;
  }
  // 나는 불이 없음
  if (shown.length >= 2) { for (const s of others) p[s] = shown.includes(s) ? 0 : 1; return p; }
  if (shown.length === 1) {
    // 공개된 사람은 상대. 나머지 둘은 반반 (그 사람이 돼지면 둘 다 같은 편이라 조금 더 높게)
    for (const s of others) p[s] = s === shown[0] ? 0 : 0.6;
    return p;
  }
  for (const s of others) p[s] = 0.4;
  return p;
}

/** 확실한 같은 편 (2대2에서 한 명, 돼지 판 흑팀이면 여럿일 수 있어 첫 번째) */
function knownTeammate(v: AiView): number | null {
  const p = mateProbs(v);
  const live = [0, 1, 2, 3].filter((s) => p[s] >= 0.99);
  return live.length ? live.find((s) => v.counts[s] > 0) ?? live[0] : null;
}

/** 상대가 곧 나갈 것 같은지 (같은 편일 확률이 높은 사람은 빼고 본다) */
function opponentDanger(v: AiView, probs: number[]): boolean {
  return [0, 1, 2, 3].some((s) => s !== v.seat && v.counts[s] > 0 && v.counts[s] <= 2 && probs[s] < 0.5);
}

/** 아직 아무도 못 본 카드 (내 주패도 제외) — 다른 세 사람 손에 나뉘어 있음 */
function unseenCards(v: AiView): CardId[] {
  const seen = seenCards(v);
  const all: CardId[] = [];
  for (const su of ['S', 'H', 'D', 'C']) for (let r = 3; r <= 14; r++) all.push(`${su}${r}`);
  return all.filter((c) => !seen.has(c) && !v.hand.includes(c));
}

// ───── 다른 사람 주패 상상하기 ─────
// 아직 안 나온 카드를 남은 장수대로 무작위로 나눠 보는 것을 여러 번 반복해서 확률을 어림한다.
// (같은 상황에서는 같은 결과가 나오도록 상황마다 고정된 난수를 쓴다)
const SAMPLES = 40;

function rankCounts(cards: CardId[]): number[] {
  const n = new Array(15).fill(0);
  for (const c of cards) n[rankOf(c)]++;
  return n;
}

/** 이 랭크 개수로 판 위 패를 같은 종류(또는 틀)로 이길 수 있는지 — 0: 못 이김, 1: 같은 종류로, 0.5: 틀로만 */
function beatLevel(n: number[], top: Combo): number {
  const run = (L: number, need: number) => {
    for (let t = top.top + 1; t <= 14; t++) {
      let ok = true;
      for (let r = t - L + 1; r <= t; r++) if (r < 3 || n[r] < need) { ok = false; break; }
      if (ok) return true;
    }
    return false;
  };
  let same = false;
  if (top.kind === 'single') for (let r = top.top + 1; r <= 14 && !same; r++) same = n[r] >= 1;
  else if (top.kind === 'pair') for (let r = top.top + 1; r <= 14 && !same; r++) same = n[r] >= 2;
  else if (top.kind === 'nilliri') same = run(top.length, 1);
  else if (top.kind === 'ssangka') same = run(top.length, 2);
  else if (top.kind === 'teul') for (let r = top.top + 1; r <= 14 && !same; r++) same = n[r] >= 3;
  if (same) return 1;
  if (top.kind === 'single' || top.kind === 'pair' || top.kind === 'nilliri') return n.some((x) => x >= 3) ? 0.5 : 0;
  return 0;
}

/** 이 주패 전체를 한 번에 내서 판 위 패를 이기고 바로 완주할 수 있는지 */
function finishesOver(hand: CardId[], top: Combo): boolean {
  const n = rankCounts(hand);
  const ranks: number[] = [];
  for (let r = 3; r <= 14; r++) if (n[r]) ranks.push(r);
  const consecutive = ranks.every((r, i) => i === 0 || r === ranks[i - 1] + 1);
  const hi = ranks.at(-1) ?? 0;
  if (hi <= top.top) return false;
  switch (top.kind) {
    case 'single': return hand.length === 1;
    case 'pair': return hand.length === 2 && ranks.length === 1;
    case 'nilliri': return hand.length === top.length && ranks.length === hand.length && consecutive;
    case 'ssangka': return ranks.length === top.length && ranks.every((r) => n[r] === 2) && consecutive;
    default: return false;
  }
}

/** 다른 세 사람 주패를 한 번 상상해서 나눠 본다 */
function imagineOthers(v: AiView, unseen: CardId[], rng: Rng): CardId[][] {
  const deck = [...unseen];
  for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  const hands: CardId[][] = [[], [], [], []];
  let k = 0;
  for (let s = 0; s < 4; s++) if (s !== v.seat) { hands[s] = deck.slice(k, k + v.counts[s]); k += v.counts[s]; }
  return hands;
}

function situationRng(v: AiView, tag: string): Rng {
  const key = `${tag}|${v.seat}|${v.hand.slice().sort().join('')}|${v.counts.join(',')}|${v.trick.map((p) => p.combo.cards.join('')).join('/')}`;
  return seededRng(Math.floor(stableRoll(key) * 4294967296));
}

/** 같은 편이 받아치기 좋은(가능하면 그걸로 바로 완주할) 패 고르기 */
function bestFeed(v: AiView, mate: number, plays: Combo[]): Combo | null {
  const cands = plays.filter((c) => !STRONG.includes(c.kind) && c.cards.length < v.hand.length);
  if (!cands.length) return null;
  const unseen = unseenCards(v);
  const rng = situationRng(v, 'feed');
  const worlds = Array.from({ length: SAMPLES }, () => imagineOthers(v, unseen, rng)[mate]);
  // 사람은 끝까지 페어·닐리리를 들고 있는 경우가 많다 — 실제 대전에서 잰 비율만큼 그런 모양에 무게를 더 준다
  // (남은 2장이 페어: 무작위 약 6% → 실제 약 14%, 남은 3장: 페어+1장 18%→29%, 닐리리 3%→7%)
  const weight = (h: CardId[]) => {
    const u = new Set(h.map(rankOf)).size;
    if (h.length === 2) return u === 1 ? 2.3 : 1;
    if (h.length === 3) { const r = h.map(rankOf).sort((a, b) => a - b); return u === 2 ? 1.6 : u === 3 && r[2] - r[0] === 2 ? 2.5 : 1; }
    return 1;
  };
  const ws = worlds.map(weight), total = ws.reduce((a, b) => a + b, 0);
  let best: Combo | null = null, bestScore = -Infinity;
  for (const c of cands) {
    let can = 0, out = 0;
    worlds.forEach((h, i) => {
      if (finishesOver(h, c)) out += ws[i];
      if (beatLevel(rankCounts(h), c) === 1) can += ws[i];
    });
    const score = (out * 3 + can) / total - c.top * 0.02 - breakCost(v.hand, c) / 30 + c.cards.length * 0.03;
    if (can > 0 && score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

/** 내 주패를 다 내는 데 걸릴 대략의 차례 수 (같은 숫자 묶음 1번, 한 장짜리 연속 3개 이상은 닐리리 1번) */
function turnsToOut(hand: CardId[]): number {
  const n = rankCounts(hand);
  let turns = 0, run = 0;
  for (let r = 3; r <= 15; r++) {
    if (r <= 14 && n[r]) turns++;
    if (r <= 14 && n[r] === 1) run++;
    else { if (run >= 3) turns -= run - 1; run = 0; }
  }
  return turns;
}

/** 같은 편 대신 내가 선을 가져오는 게 더 나은지 (left: 가로챈 뒤 남는 내 주패) */
function takeLeadFromMate(v: AiView, mate: number, left: CardId[]): boolean {
  if (left.length === 0) return true;
  const mine = turnsToOut(left);
  const mateCards = v.counts[mate];
  if (mateCards <= 2) return mine <= 1;               // 같은 편이 곧 나갈 것 같으면 양보 (내가 바로 나갈 수 있을 때만 가져옴)
  if (mine <= 1) return true;                          // 선만 잡으면 바로 나갈 수 있음
  return mine + 1 <= Math.ceil(mateCards / 2);         // 내가 같은 편보다 확실히 빨리 나갈 수 있음
}

/**
 * 같은 편이 싱글 r 보다 높은 카드를 한 장이라도 들고 있을 확률.
 * 안 나온 카드가 무작위로 나뉘어 있다고 보고 계산 (초기하분포).
 */
export function mateBeatsSingle(v: AiView, mate: number, r: number): number {
  const unseen = unseenCards(v);
  const U = unseen.length, m = Math.min(v.counts[mate], U);
  const H = unseen.filter((c) => rankOf(c) > r).length;
  if (m <= 0) return 0;
  let none = 1; // 높은 카드가 하나도 없을 확률 = C(U-H, m) / C(U, m)
  for (let i = 0; i < m; i++) none *= Math.max(0, U - H - i) / (U - i);
  return 1 - none;
}

const countRank = (hand: CardId[], r: number) => hand.filter((c) => rankOf(c) === r).length;

/** 모두가 본 카드 (치워진 더미 + 지금 더미) */
function seenCards(v: AiView): Set<CardId> {
  return new Set([...v.discard, ...v.trick.flatMap((p) => p.combo.cards)]);
}

/**
 * 찼다로 낸 숫자 r 의 '네 번째 카드'를 상대가 들고 있어서 꽂다를 당할 확률.
 * 48장을 모두 나눠 주므로, 판 위에 안 나왔고 내 주패에도 없으면 반드시 다른 누군가가 들고 있다.
 * 그 사람이 확실한 같은 편일 수 있으면 그만큼 위험이 줄어든다.
 */
function kkotRisk(v: AiView, r: number): number {
  const seen = seenCards(v);
  const fourthGone = ['S', 'H', 'D', 'C'].every((s) => seen.has(`${s}${r}`) || v.hand.includes(`${s}${r}`));
  if (fourthGone) return 0;
  const mate = knownTeammate(v);
  const holders = [0, 1, 2, 3].filter((s) => s !== v.seat && v.counts[s] > 0);
  const total = holders.reduce((a, s) => a + v.counts[s], 0);
  if (!total) return 0;
  const enemy = holders.filter((s) => s !== mate).reduce((a, s) => a + v.counts[s], 0);
  return enemy / total;
}

/**
 * 찼다(차기)를 할 가치가 있는지 — 아낄 이유가 있으면 아낀다.
 *  - 다 내거나 거의 다 내게 되면 무조건 찬다
 *  - 낮은 페어는 찰수록 이득 (주패를 털고 선까지 잡음)
 *  - K·A 같은 높은 페어는 나중에 판을 잡을 힘이므로 아낀다
 *  - 네 번째 카드가 아직 안 나왔으면 꽂다를 당해 높은 페어를 날릴 수 있으므로 크게 아낀다
 *  - 같은 숫자 3·4장(틀·마대)을 깨게 되면 아낀다
 *  - 쌍카(연속 페어)의 일부면 아낀다
 *  - 확실한 같은 편이 낸 카드면 아낀다 (같은 편의 흐름을 끊지 않음)
 *  - 상대가 곧 나갈 것 같으면 선을 잡으러 적극적으로 찬다 (그래도 꽂다 위험은 따진다)
 */
function chatdaWorth(v: AiView, opt: { cards: CardId[] }, danger: boolean): number {
  const left = v.hand.length - opt.cards.length;
  if (left === 0) return 1; // 찼다로 완주하면 꽂다와 상관없음
  if (opt.cards.length > 2) return danger ? 0.95 : 0.8; // 쌍카 찼다 (꽂다는 한 사람이 남은 카드를 모두 가져야 해서 드묾)
  const r = rankOf(opt.cards[0]);
  const risk = kkotRisk(v, r);
  if (left <= 2) return r >= 13 && risk > 0.5 && !danger ? 0.5 : 1;

  let p = 0.95;
  // 페어 자체의 가치: 높을수록 아낌
  if (r >= 14) p *= 0.3;
  else if (r === 13) p *= 0.4;
  else if (r >= 11) p *= 0.7;
  else if (r >= 9) p *= 0.88;
  // 꽂다 위험: 높은 페어일수록 꽂다를 당하면 손해가 큼
  const loss = r >= 13 ? 0.95 : r >= 11 ? 0.7 : r >= 9 ? 0.45 : 0.25;
  p *= 1 - risk * loss;

  const n = countRank(v.hand, r);
  if (n === 4) p *= 0.15;
  else if (n === 3) p *= 0.3;
  if (countRank(v.hand, r - 1) >= 2 && countRank(v.hand, r + 1) >= 2) p *= 0.4;
  else if ((countRank(v.hand, r - 1) >= 2 && countRank(v.hand, r - 2) >= 2) || (countRank(v.hand, r + 1) >= 2 && countRank(v.hand, r + 2) >= 2)) p *= 0.5;
  const mate = knownTeammate(v);
  const mu = v.options.find((o) => o.type === 'mureugi');
  const target = mu && opt === mu ? v.trick.at(-2)?.seat : v.trick.at(-1)?.seat;
  // 같은 편일 것 같은 사람(50% 이상)이 낸 카드는 덜 찬다
  const probs = mateProbs(v);
  if (target !== undefined && probs[target] >= 0.5 && probs[target] < 0.99) p *= 1 - probs[target] * 0.6;
  if (danger) p = Math.max(p, 0.85 * (1 - risk * (r >= 13 ? 0.6 : 0.3)));
  // 확실한 같은 편이 낸 카드는 보통 차지 않는다 (같은 편의 선을 뺏는 셈).
  // 단, 내가 선을 가져오는 게 팀에 더 유리하면 양보하지 않고 가져온다
  if (mate !== null && target === mate) {
    const left = v.hand.filter((c) => !opt.cards.includes(c));
    p = takeLeadFromMate(v, mate, left) ? Math.max(p, 0.9) : p * 0.05;
  }
  return p;
}

/** 꽂다를 할 가치가 있는지 */
function kkotdaWorth(v: AiView, danger: boolean): number {
  const cards = v.window!.cards;
  if (v.hand.length - cards.length <= 1) return 1;
  let p = 0.9;
  const mate = knownTeammate(v);
  if (mate !== null && v.window!.baseSeat === mate) { // 같은 편이 이미 선을 잡음 → 보통은 뺏지 않지만, 내가 가져오는 게 유리하면 가져옴
    const left = v.hand.filter((c) => !cards.includes(c));
    if (takeLeadFromMate(v, mate, left)) return 0.95;
    p *= 0.05;
  }
  if (cards.length === 1) {
    const r = rankOf(cards[0]);
    const has = (x: number) => countRank(v.hand, x) > 0;
    if ((has(r - 1) && has(r + 1)) || (has(r - 1) && has(r - 2)) || (has(r + 1) && has(r + 2))) p *= 0.5; // 닐리리 재료
    if (r === 14) p *= 0.6;
    else if (r === 13) p *= 0.8;
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
  const probs = mateProbs(v);
  const danger = opponentDanger(v, probs); // 상대가 곧 나갈 것 같으면 강하게
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

  // 이걸로 다 내고 완주할 수 있으면 무조건 (팀에도 가장 좋음)
  const out = plays.find((c) => c.cards.length === v.hand.length);
  if (out) return { type: 'play', seat, cards: out.cards };

  const mate = knownTeammate(v);
  const mateLive = mate !== null && v.counts[mate] > 0;
  const mateDone = mate !== null && v.finished.includes(mate); // 같은 편이 이미 나감 → 나도 빨리 나가야 함
  const mateNearOut = mateLive && v.counts[mate!] <= 2;
  const endgame = v.hand.length <= 4 || mateDone;
  const top = v.trick.at(-1);

  if (top) {
    const by = top.seat;
    // ① 같은 편이 낸 패 위에는 공격 카드(틀·사사끼·마대·불돼지)를 쓰지 않는다 — 같은 편의 공격을 낭비하는 셈.
    //    같은 편 패 위에 보통 패를 덮는 건 오히려 상대가 받기 어렵게 막아 주는 효과가 있어서 그대로 둔다
    //    (시뮬레이션으로 확인: 같은 편 위를 무조건 통과하면 팀 성적이 떨어짐).
    const byLikelyMate = probs[by] >= 0.99 || (probs[by] >= 0.5 && stableRoll(`m|${situation}`) < probs[by]);
    if (byLikelyMate && v.counts[by] > 0 && !danger) {
      const normal = plays.filter((c) => !STRONG.includes(c.kind));
      if (!normal.length) return { type: 'pass', seat };
      plays.splice(0, plays.length, ...normal);
    }
  }

  // ⑤ 내가 선이고 상대 중 누가 1장만 남았으면, 한 장으로는 받을 수 없는 페어·닐리리 등으로 시작한다
  //    (2장 남은 상대에게 싱글로 시작하는 것도 시험했지만 오히려 손해라 넣지 않음)
  if (!top) {
    const oppWith = (n: number) => [0, 1, 2, 3].some((s2) => s2 !== seat && v.counts[s2] === n && probs[s2] < 0.5);
    if (oppWith(1)) {
      const multi = plays.filter((c) => c.cards.length >= 2 && !STRONG.includes(c.kind)).sort((a, b) => a.top - b.top || b.cards.length - a.cards.length);
      if (multi.length) return { type: 'play', seat, cards: multi[0].cards };
    }
  }

  // ④ 내가 선이고 같은 편이 3장 이하 남았으면, 같은 편 주패를 상상해 보고 받기 좋은 패를 내 준다
  //    (예: 2장 남음 → 페어일 확률이 높으니 낮은 페어, 3장 남음 → 닐리리일 것 같으면 낮은 닐리리)
  if (!top && mateLive && v.counts[mate!] <= 3 && !danger) {
    const feed = bestFeed(v, mate!, plays);
    if (feed) return { type: 'play', seat, cards: feed.cards };
  }
  if (!top && mateNearOut && !danger) {
    const singles = plays.filter((c) => c.kind === 'single').sort((a, b) => a.top - b.top);
    const pairs = plays.filter((c) => c.kind === 'pair').sort((a, b) => a.top - b.top);
    const feed = v.counts[mate!] === 2 && pairs.length && pairs[0].top <= 9 ? pairs[0] : singles[0];
    if (feed) return { type: 'play', seat, cards: feed.cards };
  }

  // 상대가 같은 편을 막고 있고 같은 편이 곧 나갈 것 같으면, 선을 되찾으려고 강한 패도 쓴다
  // 같은 편이 직접 넘길 수 있을 것 같으면(남은 카드 계산) 굳이 강한 패를 쓰지 않는다
  const mateCanHandle = !!top && mateLive && top.combo.kind === 'single' && mateBeatsSingle(v, mate!, top.combo.top) >= 0.8;
  const rescue = !!top && mateNearOut && probs[top.seat] < 0.5 && !mateCanHandle;
  const weak = plays.filter((c) => !STRONG.includes(c.kind));
  const pool = weak.length && !(rescue && weak.every((c) => c.top < 12)) ? weak : (danger || endgame || rescue ? plays : []);
  if (!pool.length) return v.trick.length ? { type: 'pass', seat } : { type: 'play', seat, cards: plays[0].cards };

  // 선: 낮은 숫자부터, 같은 높이면 많이 털어내는 쪽
  // 받아치기: 이길 수 있는 가장 약한 패
  const score = (c: Combo) => c.top * 10 - c.cards.length * (v.trick.length ? 0 : 4) + breakCost(v.hand, c);
  pool.sort((a, b) => score(a) - score(b));
  const pick = pool[0];

  // 받아치는데 A·K 같은 높은 패를 초반에 쓰게 되면 가끔 아낀다
  if (v.trick.length && !danger && !endgame && !rescue && pick.top >= 13 && rng() < 0.45) return { type: 'pass', seat };
  return { type: 'play', seat, cards: pick.cards };
}

/**
 * 이 패를 내면 남은 주패의 좋은 모양이 깨지는 정도 (점수가 클수록 피함).
 *  - 페어에서 한 장만 빼면 찰 기회가 사라짐
 *  - 같은 숫자 3·4장(틀·마대)을 쪼개면 큰 손해
 */
function breakCost(hand: CardId[], c: Combo) {
  let cost = 0;
  const used = new Map<number, number>();
  for (const x of c.cards) used.set(rankOf(x), (used.get(rankOf(x)) ?? 0) + 1);
  for (const [r, u] of used) {
    const n = countRank(hand, r);
    if (u >= n) continue;
    if (n >= 3) cost += n === 4 ? 60 : 35;
    else if (n === 2 && u === 1) cost += 18;
  }
  return cost;
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

/** 재치있는 AI 닉네임 (5자 이내, 겹치지 않게 넉넉히) */
export const AI_NAMES = [
  '눈치백단', '패스장인', '꽂고본다', '돼지사냥꾼', '타짜꿈나무', '찰까말까', '뚝심이', '알부자',
  '선잡이', '포커페이스', '무르지마', '불꽃손', '카드요정', '패를숨긴자', '셔플마스터', '에이스헌터',
  '킹메이커', '퀸의미소', '잭팟각', '한판만더', '오늘은딴다', '손이운다', '눈빛대화', '침착한척',
  '표정관리중', '속으로울어', '이판사판', '일단내고봄', '생각중', '고민은짧게', '야무진손끝', '묵직한한방',
  '쫄지마세요', '기세등등', '승부사기질', '느긋냥이', '졸린판다', '수상한토끼', '낮잠자는곰', '배고픈다람',
  '겁없는삐약', '춤추는펭귄', '노래오리', '뒤뚱뒤뚱', '꼬마타짜', '막내에이스', '동네고수', '골목대장',
  '알까기왕', '달걀한판', '황금알', '알뜰살뜰', '빈손출발', '계란말이', '반숙장인', '노른자위',
  '흰자의반란', '분홍꿀꿀이', '왕관쓴돼지', '돼지저금통', '삼겹살소년', '꿀꿀선생', '꿀꿀무사', '흑돼지박사',
  '불돼지주의', '돼지꿈꿨어', '쌍카요정', '틀깨기달인', '마대각', '사사끼장인', '닐리리맘보', '닐리리야',
  '연속박수', '페어찬양', '싱글벙글', '둘이서한쌍', '찼다전문가', '꽂기선수', '꽂아드림', '안꽂아요',
  '무르기금지', '무르면반칙', '통과의달인', '통과만세', '선은내꺼', '선빵필승', '뚝뚝떨어져', '달려라하니',
  '달리기선수', '전력질주', '느림보거북', '마라톤각', '완주가목표', '꼴찌는싫어', '일등예약', '행운의네잎',
  '럭키세븐', '칠칠맞아', '팔자좋은패', '구사일생', '십년감수', '오늘의운세', '대박기원', '쪽박방지',
  '심장쫄깃', '손바닥땀', '긴장백배', '침묵의고수', '무표정장인', '미소천사', '장난꾸러기', '능청맞은',
  '엉뚱발랄', '허세가득', '작전타임', '계산완료', '수읽기중', '머리굴리기', '전략가', '한수앞',
  '두수앞', '묘수풀이', '꼼수는없다', '정공법', '카드뒤집개', '밤샘한판', '새벽의고수', '월요병환자',
  '금요일밤', '퇴근후한판', '점심내기', '커피내기', '라면내기', '떡볶이내기',
];
