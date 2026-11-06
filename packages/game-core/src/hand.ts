// 한 판(hand) 진행 엔진 — 순수 함수. 서버가 이 함수만 호출해서 상태를 바꾼다.
// 자리 번호 0→1→2→3→0 순서를 '반시계 방향'으로 정의한다.

import { BLACK_CARDS, CardId, clone, FIRE_CARDS, isFire, ownerOf, pigSeatOf, rankOf, sortHand } from './cards';
import { canBeat, classifyCombo, Combo, ComboKind, enumerateCombos } from './combos';

export type HandPhase = 'run-declare' | 'ddook-declare' | 'turn' | 'kkotda-window' | 'blackpig-window' | 'hand-over';
export type PlayVia = 'play' | 'chatda' | 'mureugi' | 'kkotda' | 'blackpig';

export interface Play { seat: number; combo: Combo; via: PlayVia }

export interface MureugiChance { xSeat: number; xRank: number; ySeat: number; yCard: CardId }

export type HandWindow =
  | { type: 'kkotda'; seat: number; cards: CardId[]; baseSeat: number }
  | { type: 'blackpig'; seat: number; bulpigSeat: number };

export interface HandState {
  phase: HandPhase;
  hands: CardId[][];
  discard: CardId[];
  teamMode: 'fire-2v2' | 'pig-1v3';
  /** 분배 시점의 불 보유자 (2v2: 2명, 돼지: 1명) */
  fireOwners: number[];
  revealedFire: number[];
  runner: number | null;
  ddooker: number | null;
  multiplier: 1 | 2 | 4;
  leaderSeat: number;
  activeSeat: number;
  trick: Play[];
  passed: number[];
  /** 확정된 완주 순서 */
  finished: number[];
  /** 무르기로 취소될 수 있는 잠정 완주자 */
  provisional: number | null;
  mureugi: MureugiChance | null;
  window: HandWindow | null;
  /** 판 종료 시 1~4등 자리 */
  ranks: number[] | null;
  /** 1·2등 같은 팀으로 조기 종료 (3·4등 없음) */
  earlyEnd: boolean;
}

export type HandAction =
  | { type: 'declareRun'; seat: number }
  | { type: 'declareDdook'; seat: number }
  | { type: 'play'; seat: number; cards: CardId[] }
  | { type: 'pass'; seat: number }
  | { type: 'chatda'; seat: number; cards: CardId[] }
  | { type: 'mureugi'; seat: number; cards: CardId[] }
  | { type: 'kkotda'; seat: number }
  | { type: 'kkotdaPass'; seat: number }
  | { type: 'blackPigSubmit'; seat: number }
  | { type: 'blackPigPass'; seat: number }
  /** 서버 타이머 만료: 달리기·뚝·꽂다·흑돼지 창을 닫는다 */
  | { type: 'windowTimeout' };

export type HandEvent =
  | { type: 'played'; seat: number; via: PlayVia; cards: CardId[] }
  | { type: 'passed'; seat: number }
  | { type: 'fireAlarm'; seat: number }        // '불이야!'
  | { type: 'pig'; seat: number }              // '돼지!'
  | { type: 'blackPig'; seat: number }         // '흑돼지!'
  | { type: 'noKkot' }                         // '안 꽂아!' (익명)
  | { type: 'returned'; seat: number; card: CardId }
  | { type: 'finished'; seat: number; rank: number }
  | { type: 'finishCanceled'; seat: number }
  | { type: 'run'; seat: number }
  | { type: 'ddook'; seat: number }
  /** cleared: 치우기 직전 판 위 카드 (화면에서 잠깐 보여주기용) */
  | { type: 'trickCleared'; leader: number; cleared: Play[] }
  | { type: 'handOver'; ranks: number[]; early: boolean };

export type HandResult = { ok: true; state: HandState; events: HandEvent[] } | { ok: false; reason: string };

// ───────────────────────── 시작 ─────────────────────────

export function createHand(hands: CardId[][], leaderSeat: number): HandState {
  const pig = pigSeatOf(hands);
  return {
    phase: 'run-declare',
    hands: hands.map((h) => [...h]),
    discard: [],
    teamMode: pig === null ? 'fire-2v2' : 'pig-1v3',
    fireOwners: pig === null ? FIRE_CARDS.map((f) => ownerOf(hands, f)).sort() : [pig],
    revealedFire: [],
    runner: null,
    ddooker: null,
    multiplier: 1,
    leaderSeat,
    activeSeat: leaderSeat,
    trick: [],
    passed: [],
    finished: [],
    provisional: null,
    mureugi: null,
    window: null,
    ranks: null,
    earlyEnd: false,
  };
}

/**
 * 마지막 카드(완주하는 제출)로 낼 수 없는 조합 (2026-11-04 확정: 틀 이상은 마지막에 낼 수 없음).
 * 쌍카, 흑돼지로 불돼지 막기, 쌍카 찼다는 마지막에 써서 완주 가능 (확정).
 */
export const NO_FINISH_KINDS: ComboKind[] = ['teul', 'sasaki', 'madae', 'bulpig'];

/** 이 카드를 내면 주패가 비는데, 그 조합이 마지막에 낼 수 없는 종류인가 */
export function isFinishBlocked(st: HandState, seat: number, cards: CardId[]): boolean {
  const combo = classifyCombo(cards);
  return !!combo && NO_FINISH_KINDS.includes(combo.kind) && cards.length === st.hands[seat].length;
}

export function teamOf(st: HandState, seat: number): 'fire' | 'black' | 'pig' {
  if (st.teamMode === 'pig-1v3') return st.fireOwners[0] === seat ? 'pig' : 'black';
  return st.fireOwners.includes(seat) ? 'fire' : 'black';
}

// ───────────────────────── 도우미 ─────────────────────────

const isActive = (st: HandState, s: number) => st.hands[s].length > 0;
const topPlay = (st: HandState): Play | null => st.trick[st.trick.length - 1] ?? null;
const countRank = (hand: CardId[], r: number) => hand.filter((c) => rankOf(c) === r).length;

function nextActive(st: HandState, from: number): number | null {
  for (let i = 1; i <= 4; i++) {
    const s = (from + i) % 4;
    if (isActive(st, s)) return s;
  }
  return null;
}

function hasCards(hand: CardId[], cards: CardId[]) {
  return new Set(cards).size === cards.length && cards.every((c) => hand.includes(c));
}

function removeCards(st: HandState, seat: number, cards: CardId[]) {
  st.hands[seat] = st.hands[seat].filter((c) => !cards.includes(c));
}

function reveal(st: HandState, seat: number) {
  if (!st.revealedFire.includes(seat)) st.revealedFire.push(seat);
}

function pushPlay(st: HandState, ev: HandEvent[], seat: number, cards: CardId[], via: PlayVia) {
  removeCards(st, seat, cards);
  const combo = classifyCombo(cards)!;
  st.trick.push({ seat, combo, via });
  ev.push({ type: 'played', seat, via, cards: [...cards] });
  if (combo.kind === 'bulpig') {
    reveal(st, seat);
    ev.push({ type: 'pig', seat });
  } else if (st.runner === null && cards.some(isFire)) {
    reveal(st, seat);
    ev.push({ type: 'fireAlarm', seat });
  }
}

function confirmFinish(st: HandState, ev: HandEvent[], seat: number) {
  if (st.finished.includes(seat)) return;
  st.finished.push(seat);
  ev.push({ type: 'finished', seat, rank: st.finished.length });
}

/** 무르기 기회를 닫고 잠정 완주자를 확정 */
function closeMureugi(st: HandState, ev: HandEvent[]) {
  st.mureugi = null;
  if (st.provisional !== null) {
    const s = st.provisional;
    st.provisional = null;
    confirmFinish(st, ev, s);
  }
}

/** 세 번째 완주가 확정되면 판 종료 */
function checkHandEnd(st: HandState, ev: HandEvent[]): boolean {
  // 알을 주고받는 결과가 정해지는 순간 판 종료 (2026-11-04 확정)
  //  - 2대2: 1등의 같은 팀 사람이 완주한 순간 (2등 ±2, 3등 ±1)
  //  - 돼지: 돼지가 완주한 순간 (1등 승리, 2·3등 물판)
  //  - 그 외: 세 번째 완주 (남은 사람 자동 4등)
  const f = st.finished;
  const early = f.length < 3 && f.length > 0 && (
    st.teamMode === 'pig-1v3'
      ? f.includes(st.fireOwners[0])
      : f.slice(1).some((s) => teamOf(st, s) === teamOf(st, f[0]))
  );
  if (f.length < 3 && !early) return false;
  const rest = [0, 1, 2, 3].filter((s) => !st.finished.includes(s));
  st.ranks = [...st.finished, ...rest];
  st.earlyEnd = early;
  st.phase = 'hand-over';
  st.window = null;
  st.mureugi = null;
  ev.push({ type: 'handOver', ranks: [...st.ranks], early });
  return true;
}

/** 더미를 치우고 seat 에게 선. seat 가 이미 완주했으면 다음 활동자에게 통선 */
function giveLead(st: HandState, ev: HandEvent[], seat: number) {
  const cleared = clone(st.trick);
  for (const p of st.trick) st.discard.push(...p.combo.cards);
  st.trick = [];
  st.passed = [];
  st.mureugi = null;
  st.window = null;
  const leader = isActive(st, seat) ? seat : nextActive(st, seat)!;
  st.leaderSeat = leader;
  st.activeSeat = leader;
  st.phase = 'turn';
  ev.push({ type: 'trickCleared', leader, cleared });
}

function someoneCanMureugi(st: HandState, m: MureugiChance) {
  return [0, 1, 2, 3].some((s) => s !== m.xSeat && countRank(st.hands[s], m.xRank) >= 2);
}

/** 찼다 대상이 되는 숫자들 (싱글: 그 숫자, 닐리리: 연속 숫자 전부) */
function targetRanks(target: Play): number[] {
  if (target.combo.kind === 'single') return [target.combo.top];
  const lo = target.combo.top - target.combo.length + 1;
  return Array.from({ length: target.combo.length }, (_, i) => lo + i);
}

/** 찼다 카드가 대상에 맞는지: 대상 숫자마다 정확히 2장 */
/** ♥10♦10 두 장은 언제나 불돼지 — 찼다·차기 카드로 쓸 수 없다 (2026-11-05 확정) */
const isBulpigPair = (cards: CardId[]) => cards.length === 2 && cards.includes('H10') && cards.includes('D10');

/** 같은 숫자 카드 중 찼다용 두 장 고르기: 불 두 장이 함께 묶이지 않게 흑 10을 먼저 쓴다 */
function pickTwo(hand: CardId[], r: number): CardId[] {
  return hand.filter((c) => rankOf(c) === r).sort((a, b) => Number(isFire(a)) - Number(isFire(b))).slice(0, 2);
}

function validChatdaCards(target: Play, cards: CardId[]): boolean {
  if (target.combo.kind !== 'single' && target.combo.kind !== 'nilliri') return false;
  if (isBulpigPair(cards)) return false;
  const ranks = targetRanks(target);
  if (cards.length !== ranks.length * 2) return false;
  return ranks.every((r) => cards.filter((c) => rankOf(c) === r).length === 2);
}

/** 찼다(무르기 포함) 공통 처리 → 꽂다 창 또는 선 */
function doChatda(st: HandState, ev: HandEvent[], seat: number, cards: CardId[], target: Play, via: PlayVia): void {
  pushPlay(st, ev, seat, cards, via);
  if (!isActive(st, seat)) confirmFinish(st, ev, seat);
  if (checkHandEnd(st, ev)) return;

  // 꽂다: 대상 숫자마다 남은 네 번째 카드를 한 사람이 모두 갖고 있으면 기회
  const ranks = targetRanks(target);
  for (let s = 0; s < 4; s++) {
    if (s === seat || !isActive(st, s)) continue;
    const picks = ranks.map((r) => st.hands[s].find((c) => rankOf(c) === r));
    if (picks.every((c) => c !== undefined)) {
      st.phase = 'kkotda-window';
      st.window = { type: 'kkotda', seat: s, cards: picks as CardId[], baseSeat: seat };
      return;
    }
  }
  giveLead(st, ev, seat);
}

// ───────────────────────── 행동 처리 ─────────────────────────

export function applyHandAction(prev: HandState, action: HandAction): HandResult {
  const st: HandState = clone(prev);
  const ev: HandEvent[] = [];
  const fail = (reason: string): HandResult => ({ ok: false, reason });
  const done = (): HandResult => ({ ok: true, state: st, events: ev });

  if (st.phase === 'hand-over') return fail('판이 이미 끝났습니다');

  switch (action.type) {
    // ── 달리기 · 뚝 ──
    case 'declareRun': {
      if (st.phase !== 'run-declare') return fail('달리기 선언 시간이 아닙니다');
      if (!st.fireOwners.includes(action.seat)) return fail('불 보유자만 달릴 수 있습니다');
      st.runner = action.seat;
      st.multiplier = 2;
      for (const s of st.fireOwners) reveal(st, s);
      if (st.teamMode === 'fire-2v2') {
        // 두 불 보유자가 서로의 불 카드를 교환
        const [a, b] = st.fireOwners;
        const fa = st.hands[a].find(isFire)!;
        const fb = st.hands[b].find(isFire)!;
        st.hands[a] = st.hands[a].map((c) => (c === fa ? fb : c));
        st.hands[b] = st.hands[b].map((c) => (c === fb ? fa : c));
      }
      st.phase = 'ddook-declare';
      ev.push({ type: 'run', seat: action.seat });
      return done();
    }
    case 'declareDdook': {
      if (st.phase !== 'ddook-declare') return fail('뚝 선언 시간이 아닙니다');
      if (teamOf(st, action.seat) === teamOf(st, st.runner!)) return fail('반대편만 뚝을 선언할 수 있습니다');
      st.ddooker = action.seat;
      st.multiplier = 4;
      st.phase = 'turn';
      ev.push({ type: 'ddook', seat: action.seat });
      return done();
    }

    // ── 일반 제출 ──
    case 'play': {
      if (st.phase !== 'turn') return fail('지금은 카드를 낼 수 없습니다');
      if (action.seat !== st.activeSeat) return fail('자기 차례가 아닙니다');
      if (!hasCards(st.hands[action.seat], action.cards)) return fail('주패에 없는 카드입니다');
      const combo = classifyCombo(action.cards);
      if (!combo) return fail('허용되지 않는 조합입니다');
      const top = topPlay(st);
      if (!canBeat(combo, top?.combo ?? null)) return fail('현재 공격보다 강하지 않습니다');
      if (isFinishBlocked(st, action.seat, action.cards)) return fail('틀 이상의 조합은 마지막에 낼 수 없습니다');

      closeMureugi(st, ev); // 새 카드가 나오면 이전 무르기 기회 종료
      if (checkHandEnd(st, ev)) return done();

      // 무르기 기회: 싱글 위에 싱글 한 장이 나온 경우 (중간 패스는 상관없음)
      pushPlay(st, ev, action.seat, action.cards, 'play');
      st.passed = [];
      if (combo.kind === 'single' && top && top.via === 'play' && top.combo.kind === 'single') {
        st.mureugi = { xSeat: top.seat, xRank: top.combo.top, ySeat: action.seat, yCard: action.cards[0] };
      }
      if (!isActive(st, action.seat)) {
        if (st.mureugi && st.mureugi.ySeat === action.seat && someoneCanMureugi(st, st.mureugi)) {
          st.provisional = action.seat; // 무르기로 돌아올 수 있으므로 잠정
        } else confirmFinish(st, ev, action.seat);
      }
      if (checkHandEnd(st, ev)) return done();

      if (combo.kind === 'bulpig') {
        const holder = [0, 1, 2, 3].find((s) => s !== action.seat && BLACK_CARDS.every((c) => st.hands[s].includes(c)));
        if (holder !== undefined) {
          st.phase = 'blackpig-window';
          st.window = { type: 'blackpig', seat: holder, bulpigSeat: action.seat };
        } else giveLead(st, ev, action.seat);
        return done();
      }
      st.activeSeat = nextActive(st, action.seat)!;
      return done();
    }

    case 'pass': {
      if (st.phase !== 'turn') return fail('지금은 통과할 수 없습니다');
      if (action.seat !== st.activeSeat) return fail('자기 차례가 아닙니다');
      const top = topPlay(st);
      if (!top) return fail('선은 통과할 수 없습니다');
      // 패스는 '턴이 지나간 것'으로 세지 않는다 → 무르기 기회 유지 (2026-11-04 확정)
      st.passed.push(action.seat);
      ev.push({ type: 'passed', seat: action.seat });
      const others = [0, 1, 2, 3].filter((s) => s !== top.seat && isActive(st, s));
      if (others.every((s) => st.passed.includes(s))) {
        closeMureugi(st, ev); // 더미를 치우면 무르기 기회 종료, 잠정 완주 확정
        if (checkHandEnd(st, ev)) return done();
        giveLead(st, ev, top.seat);
      } else st.activeSeat = nextActive(st, action.seat)!;
      return done();
    }

    // ── 찼다 (순서 밖) ──
    case 'chatda': {
      if (st.phase !== 'turn') return fail('지금은 찰 수 없습니다');
      const top = topPlay(st);
      if (!top || top.via !== 'play') return fail('찰 대상이 없습니다');
      if (top.seat === action.seat) return fail('자기가 낸 카드는 찰 수 없습니다');
      if (!hasCards(st.hands[action.seat], action.cards)) return fail('주패에 없는 카드입니다');
      if (!validChatdaCards(top, action.cards)) return fail('찼다 조건에 맞지 않습니다');
      closeMureugi(st, ev);
      if (checkHandEnd(st, ev)) return done();
      doChatda(st, ev, action.seat, action.cards, top, 'chatda');
      return done();
    }

    // ── 무르기: 직전 싱글 뒤에 한 장이 나왔을 때, 그 한 장을 돌려보내고 찬다 ──
    case 'mureugi': {
      const m = st.mureugi;
      if (st.phase !== 'turn' || !m) return fail('무르기 기회가 없습니다');
      if (action.seat === m.xSeat) return fail('자기가 낸 카드는 무를 수 없습니다');
      if (!hasCards(st.hands[action.seat], action.cards)) return fail('주패에 없는 카드입니다');
      if (action.cards.length !== 2 || !action.cards.every((c) => rankOf(c) === m.xRank))
        return fail('무르기 조건에 맞지 않습니다');
      if (isBulpigPair(action.cards)) return fail('불돼지는 자기 차례에만 낼 수 있습니다');
      st.trick.pop();
      st.hands[m.ySeat].push(m.yCard);
      ev.push({ type: 'returned', seat: m.ySeat, card: m.yCard });
      if (st.provisional === m.ySeat) {
        st.provisional = null;
        ev.push({ type: 'finishCanceled', seat: m.ySeat });
      }
      st.mureugi = null;
      doChatda(st, ev, action.seat, action.cards, topPlay(st)!, 'mureugi');
      return done();
    }

    // ── 꽂다 창 ──
    case 'kkotda': {
      const w = st.window;
      if (st.phase !== 'kkotda-window' || w?.type !== 'kkotda' || w.seat !== action.seat) return fail('꽂을 수 없습니다');
      pushPlay(st, ev, w.seat, w.cards, 'kkotda');
      if (!isActive(st, w.seat)) confirmFinish(st, ev, w.seat);
      if (checkHandEnd(st, ev)) return done();
      giveLead(st, ev, w.seat);
      return done();
    }
    case 'kkotdaPass': {
      const w = st.window;
      if (st.phase !== 'kkotda-window' || w?.type !== 'kkotda' || w.seat !== action.seat) return fail('꽂다 대상이 아닙니다');
      ev.push({ type: 'noKkot' });
      giveLead(st, ev, w.baseSeat);
      return done();
    }

    // ── 흑돼지 창 ──
    case 'blackPigSubmit': {
      const w = st.window;
      if (st.phase !== 'blackpig-window' || w?.type !== 'blackpig' || w.seat !== action.seat) return fail('흑돼지를 낼 수 없습니다');
      pushPlay(st, ev, w.seat, [...BLACK_CARDS], 'blackpig');
      ev.push({ type: 'blackPig', seat: w.seat });
      if (!isActive(st, w.seat)) confirmFinish(st, ev, w.seat);
      if (checkHandEnd(st, ev)) return done();
      giveLead(st, ev, w.seat);
      return done();
    }
    case 'blackPigPass': {
      const w = st.window;
      if (st.phase !== 'blackpig-window' || w?.type !== 'blackpig' || w.seat !== action.seat) return fail('흑돼지 대상이 아닙니다');
      giveLead(st, ev, w.bulpigSeat);
      return done();
    }

    case 'windowTimeout': {
      if (st.phase === 'run-declare') { st.phase = 'turn'; return done(); }
      if (st.phase === 'ddook-declare') { st.phase = 'turn'; return done(); }
      const w = st.window;
      if (w?.type === 'kkotda') { ev.push({ type: 'noKkot' }); giveLead(st, ev, w.baseSeat); return done(); }
      if (w?.type === 'blackpig') { giveLead(st, ev, w.bulpigSeat); return done(); }
      return fail('닫을 창이 없습니다');
    }
  }
}

/**
 * 같은 서버 처리 단위(한 번에 도착한 행동 묶음)를 처리.
 * 무르기와 찼다가 동시에 오면 무르기를 먼저 처리하고, 나머지는 도착 순서대로.
 * 앞의 행동으로 무효가 된 행동은 거절된다.
 */
export function applyHandBatch(st: HandState, actions: HandAction[]) {
  const ordered = [...actions.filter((a) => a.type === 'mureugi'), ...actions.filter((a) => a.type !== 'mureugi')];
  const events: HandEvent[] = [];
  const rejected: { action: HandAction; reason: string }[] = [];
  let state = st;
  for (const a of ordered) {
    const r = applyHandAction(state, a);
    if (r.ok) { state = r.state; events.push(...r.events); }
    else rejected.push({ action: a, reason: r.reason });
  }
  return { state, events, rejected };
}

// ───────────────────────── 조회 ─────────────────────────

/** 지금 이 사람이 차례에 낼 수 있는 조합 */
export function legalPlays(st: HandState, seat: number): Combo[] {
  if (st.phase !== 'turn' || st.activeSeat !== seat) return [];
  const top = topPlay(st)?.combo ?? null;
  return enumerateCombos(st.hands[seat]).filter((c) => canBeat(c, top) && !isFinishBlocked(st, seat, c.cards));
}

/**
 * 차례인데 낼 수 있는 패가 하나도 없는지 (2026-11-04 확정: 본인에게만 안내 후 2초 뒤 자동 패스).
 * 선은 항상 낼 수 있으므로 해당 없음.
 */
export function hasNoPlay(st: HandState): boolean {
  // 찰 수 있는 사람(찼다·차기)은 자동 패스하지 않는다 (2026-11-04 확정)
  return st.phase === 'turn' && st.trick.length > 0 && legalPlays(st, st.activeSeat).length === 0
    && specialOptions(st, st.activeSeat).length === 0;
}

export const AUTO_PASS_MS = 2000;

/** 지금 가능한 순서 밖 행동 (찼다·무르기) */
export function specialOptions(st: HandState, seat: number): { type: 'chatda' | 'mureugi'; cards: CardId[] }[] {
  const out: { type: 'chatda' | 'mureugi'; cards: CardId[] }[] = [];
  if (st.phase !== 'turn') return out;
  const hand = st.hands[seat];
  const top = topPlay(st);
  if (top && top.via === 'play' && top.seat !== seat && (top.combo.kind === 'single' || top.combo.kind === 'nilliri')) {
    const cards = targetRanks(top).flatMap((r) => pickTwo(hand, r));
    if (validChatdaCards(top, cards)) out.push({ type: 'chatda', cards });
  }
  const m = st.mureugi;
  if (m && m.xSeat !== seat) {
    const cards = pickTwo(hand, m.xRank);
    if (cards.length === 2 && !isBulpigPair(cards)) out.push({ type: 'mureugi', cards });
  }
  return out;
}

/**
 * 8초 시간 만료 시 기본 행동: 선택한 카드가 합법이면 제출, 아니면 패스.
 * 선이라 패스할 수 없으면 가장 낮은 싱글. (전략적 AI는 M4에서 교체)
 */
export function timeoutAction(st: HandState, seat: number, selected: CardId[] = []): HandAction {
  const combo = selected.length ? classifyCombo(selected) : null;
  const top = topPlay(st)?.combo ?? null;
  if (combo && hasCards(st.hands[seat], selected) && canBeat(combo, top) && !isFinishBlocked(st, seat, selected)) return { type: 'play', seat, cards: selected };
  if (top) return { type: 'pass', seat };
  return { type: 'play', seat, cards: [sortHand(st.hands[seat])[0]] };
}
