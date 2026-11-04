// 콘솔 시뮬레이터: 무작위로 행동하는 4명이 전체 게임을 끝까지 진행하면서
// 매 행동마다 '카드 48장 보존'과 '알 총량 보존'을 검사한다.
// 실행: npm run simulate -- [게임 수] [시작 알]

import { seededRng, Rng, CardId } from './cards';
import { applyHandAction, HandAction, HandState, legalPlays, specialOptions } from './hand';
import { createMatch, finishHand, startHand, MatchState, finalStandings } from './match';

function cardCount(h: HandState) {
  const all: CardId[] = [...h.discard, ...h.hands.flat(), ...h.trick.flatMap((p) => p.combo.cards)];
  if (all.length !== 48 || new Set(all).size !== 48) throw new Error(`카드 보존 위반: ${all.length}장`);
}

function pick<T>(arr: T[], rng: Rng): T { return arr[Math.floor(rng() * arr.length)]; }

/** 무작위 플레이어 한 명의 다음 행동 */
function randomAction(h: HandState, rng: Rng): HandAction {
  if (h.phase === 'run-declare') return rng() < 0.15 ? { type: 'declareRun', seat: pick(h.fireOwners, rng) } : { type: 'windowTimeout' };
  if (h.phase === 'ddook-declare') {
    const opp = [0, 1, 2, 3].filter((s) => !h.fireOwners.includes(s));
    return rng() < 0.3 ? { type: 'declareDdook', seat: pick(opp, rng) } : { type: 'windowTimeout' };
  }
  if (h.window?.type === 'kkotda') return rng() < 0.5 ? { type: 'kkotda', seat: h.window.seat } : { type: 'kkotdaPass', seat: h.window.seat };
  if (h.window?.type === 'blackpig') return rng() < 0.5 ? { type: 'blackPigSubmit', seat: h.window.seat } : { type: 'windowTimeout' };
  // 순서 밖 특수 행동
  for (let s = 0; s < 4; s++) {
    for (const o of specialOptions(h, s)) if (rng() < 0.4) return { type: o.type, seat: s, cards: o.cards };
  }
  const seat = h.activeSeat;
  const plays = legalPlays(h, seat);
  if (h.trick.length > 0 && (plays.length === 0 || rng() < 0.25)) return { type: 'pass', seat };
  return { type: 'play', seat, cards: pick(plays, rng).cards };
}

export function simulateMatch(seed: number, startEggs = 10) {
  const rng = seededRng(seed);
  let match: MatchState = createMatch(['가', '나', '다', '라'], startEggs);
  const total = startEggs * 4;
  let hands = 0;
  let actions = 0;
  while (match.status === 'playing' && hands < 500) {
    const s = startHand(match, rng, Math.floor(rng() * 24));
    match = s.match;
    let h = s.hand;
    while (h.phase !== 'hand-over') {
      const r = applyHandAction(h, randomAction(h, rng));
      if (!r.ok) throw new Error(`시드 ${seed}: 무작위 행동이 거절됨 — ${r.reason}`);
      h = r.state;
      cardCount(h);
      if (++actions > 1e6) throw new Error('무한 루프 의심');
    }
    match = finishHand(match, h).match;
    const sum = match.players.reduce((a, p) => a + p.eggs, 0) + match.buried;
    if (sum !== total) throw new Error(`시드 ${seed}: 알 보존 위반 ${sum} ≠ ${total}`);
    if (match.players.some((p) => p.eggs < 0)) throw new Error('음수 알 발생');
    hands++;
  }
  return { match, hands, actions };
}

if (process.argv[1]?.endsWith('simulate.ts')) {
  const games = Number(process.argv[2] ?? 200);
  const eggs = Number(process.argv[3] ?? 10);
  let totalHands = 0;
  let reasons: Record<string, number> = {};
  for (let g = 1; g <= games; g++) {
    const r = simulateMatch(g, eggs);
    totalHands += r.hands;
    const k = r.match.endReason ?? 'unfinished';
    reasons[k] = (reasons[k] ?? 0) + 1;
    if (g === 1) {
      console.log(`[예시] 1번 게임: ${r.hands}판, 행동 ${r.actions}회`);
      for (const row of finalStandings(r.match)) console.log(`  ${row.place}위 ${row.nickname} ${row.eggs}알`);
    }
  }
  console.log(`\n${games}게임 완주, 총 ${totalHands}판 — 카드·알 보존 위반 0건`);
  console.log('종료 사유:', reasons);
}
