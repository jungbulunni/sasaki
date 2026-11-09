// 전체 게임(여러 판) 관리: 분배, 선 결정, 정산 반영, 배려판·탈락·최종 순위

import { CardId, clone, deal, ownerOf, pigSeatOf, Rng } from './cards';
import { createHand, HandState } from './hand';
import { settleHand, SettleOutput } from './settlement';

export interface MatchPlayer { nickname: string; eggs: number; careUsed: boolean }

export interface MatchState {
  players: MatchPlayer[];
  buried: number;
  handNo: number;
  status: 'playing' | 'ended';
  /** 다음 판(또는 진행 중인 판)이 배려판이면 그 대상 자리 */
  careSeat: number | null;
  lastWinner: number | null;
  endReason: null | 'eliminated' | 'multiple-care';
  eliminated: number[];
}

export function createMatch(nicknames: string[], startEggs: number): MatchState {
  if (nicknames.length !== 4) throw new Error('사사끼는 4명이 필요합니다');
  if (!Number.isInteger(startEggs) || startEggs <= 0) throw new Error('시작 알은 양의 정수여야 합니다');
  return {
    players: nicknames.map((nickname) => ({ nickname, eggs: startEggs, careUsed: false })),
    buried: 0, handNo: 0, status: 'playing', careSeat: null, lastWinner: null, endReason: null, eliminated: [],
  };
}

/** 첫 판 선: 한국 시간 06:00~18:00 → ♥3 소유자, 18:00~06:00 → ♠3 소유자 */
export function firstLeader(hands: CardId[][], hourKST: number): number {
  return ownerOf(hands, hourKST >= 6 && hourKST < 18 ? 'H3' : 'S3');
}

/** 첫 판은 돼지가 나오지 않을 때까지 다시 섞는다 */
export function dealForHand(isFirst: boolean, rng: Rng): CardId[][] {
  for (;;) {
    const hands = deal(rng);
    if (!isFirst || pigSeatOf(hands) === null) return hands;
  }
}

/** 다음 판 시작. hourKST 는 첫 판 선 결정에만 쓰인다. */
export function startHand(m: MatchState, rng: Rng, hourKST: number, presetHands?: CardId[][]): { match: MatchState; hand: HandState } {
  if (m.status !== 'playing') throw new Error('게임이 끝났습니다');
  const match = clone(m);
  const isFirst = match.handNo === 0;
  const hands = presetHands ?? dealForHand(isFirst, rng);
  const leader = isFirst ? firstLeader(hands, hourKST) : match.careSeat ?? match.lastWinner!;
  if (match.careSeat !== null) match.players[match.careSeat].careUsed = true;
  match.handNo += 1;
  return { match, hand: createHand(hands, leader) };
}

export interface HandOutcome {
  settlement: SettleOutput;
  /** 배려판 대상이었던 사람이 살아남았는지 (배려판이 아니면 null) */
  careSurvived: boolean | null;
}

/** 판 종료 후 정산과 배려판·탈락 판정 */
export function finishHand(m: MatchState, hand: HandState): { match: MatchState; outcome: HandOutcome } {
  if (hand.phase !== 'hand-over' || !hand.ranks) throw new Error('판이 아직 끝나지 않았습니다');
  const match = clone(m);
  const s = settleHand({
    teamMode: hand.teamMode, fireOwners: hand.fireOwners, ranks: hand.ranks, multiplier: hand.multiplier,
    eggs: match.players.map((p) => p.eggs), buried: match.buried,
  });
  match.players.forEach((p, i) => (p.eggs = s.eggs[i]));
  match.buried = s.buried;
  match.lastWinner = hand.ranks[0];

  const careSeat = match.careSeat;
  match.careSeat = null;
  // 배려판: 이번 판에서 알을 1개 이상 얻어야 생존 (물판·손해는 탈락)
  const careSurvived = careSeat === null ? null : s.deltas[careSeat] > 0;

  // 2026-11-09 확정: 알을 정확히 다 내서 0알이 되면 탈락이 아니라 0알로 계속 플레이한다.
  // 내야 할 알이 가진 알보다 많을 때(마이너스가 될 때)만 배려판 대상.
  const short = [0, 1, 2, 3].filter((i) => s.shortage[i]);
  const eliminated = [0, 1, 2, 3].filter((i) =>
    (i === careSeat && careSurvived === false) ||           // 배려판에서 알을 못 얻음
    (short.includes(i) && match.players[i].careUsed));      // 배려판을 이미 쓴 사람이 또 부족
  const candidates = short.filter((i) => !eliminated.includes(i));

  if (eliminated.length > 0) {
    match.status = 'ended'; match.endReason = 'eliminated'; match.eliminated = eliminated;
  } else if (candidates.length >= 2) {
    match.status = 'ended'; match.endReason = 'multiple-care';
  } else if (candidates.length === 1) {
    match.careSeat = candidates[0];
  }
  return { match, outcome: { settlement: s, careSurvived } };
}

/** 최종 순위: 보유 알 기준, 동점은 공동 순위 (예: 1,1,3,4) */
export function finalStandings(m: MatchState): { seat: number; nickname: string; eggs: number; place: number }[] {
  const rows = m.players.map((p, seat) => ({ seat, nickname: p.nickname, eggs: p.eggs, place: 0 }));
  rows.sort((a, b) => b.eggs - a.eggs);
  rows.forEach((r, i) => (r.place = i > 0 && rows[i - 1].eggs === r.eggs ? rows[i - 1].place : i + 1));
  return rows;
}
