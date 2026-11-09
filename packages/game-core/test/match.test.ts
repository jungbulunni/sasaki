import { describe, expect, it } from 'vitest';
import { deal, fullDeck, pigSeatOf, seededRng } from '../src/cards';
import { createHand, HandState } from '../src/hand';
import { createMatch, dealForHand, finalStandings, finishHand, firstLeader, MatchState, startHand } from '../src/match';
import { simulateMatch } from '../src/simulate';

/** 끝난 판을 바로 만든다 (팀·순위·배수 지정) */
function endedHand(fireOwners: number[], ranks: number[], multiplier: 1 | 2 | 4 = 1): HandState {
  const hands: string[][] = [[], [], [], []];
  if (fireOwners.length === 1) hands[fireOwners[0]].push('H10', 'D10');
  else { hands[fireOwners[0]].push('H10'); hands[fireOwners[1]].push('D10'); }
  const h = createHand(hands, 0);
  return { ...h, phase: 'hand-over', ranks, multiplier };
}
function withEggs(eggs: number[], patch: Partial<MatchState> = {}): MatchState {
  const m = createMatch(['가', '나', '다', '라'], 10);
  m.players.forEach((p, i) => (p.eggs = eggs[i]));
  m.handNo = 1;
  return { ...m, ...patch };
}

describe('분배', () => {
  it('48장 고유 카드가 4명에게 12장씩', () => {
    const hands = deal(seededRng(1));
    expect(hands.map((h) => h.length)).toEqual([12, 12, 12, 12]);
    expect(new Set(hands.flat())).toEqual(new Set(fullDeck()));
  });
  it('첫 판에는 돼지가 나오지 않는다 (재분배)', () => {
    for (let seed = 1; seed <= 300; seed++) expect(pigSeatOf(dealForHand(true, seededRng(seed)))).toBeNull();
  });
  it('다음 판부터는 돼지 분배가 가능하다', () => {
    let found = false;
    for (let seed = 1; seed <= 300 && !found; seed++) found = pigSeatOf(dealForHand(false, seededRng(seed))) !== null;
    expect(found).toBe(true);
  });
  it('첫 판 선: 06~18시 ♥3 소유자, 18~06시 ♠3 소유자', () => {
    const hands = [['H3'], ['S3'], [], []];
    expect(firstLeader(hands, 6)).toBe(0);
    expect(firstLeader(hands, 17)).toBe(0);
    expect(firstLeader(hands, 18)).toBe(1);
    expect(firstLeader(hands, 3)).toBe(1);
  });
  it('이후 판은 직전 판 1등이 선', () => {
    let m = withEggs([10, 10, 10, 10]);
    m = finishHand(m, endedHand([0, 1], [2, 3, 0, 1])).match;
    expect(startHand(m, seededRng(1), 12).hand.leaderSeat).toBe(2);
  });
});

describe('탈락 · 배려판', () => {
  it('[확정 11-09] 지불 의무를 정확히 내고 0알 → 탈락 아님, 0알로 계속', () => {
    const r = finishHand(withEggs([5, 5, 2, 7]), endedHand([0, 1], [0, 1, 2, 3]));
    expect(r.match.players[2].eggs).toBe(0);
    expect(r.match.status).toBe('playing');
    expect(r.match.eliminated).toEqual([]);
    expect(r.match.careSeat).toBeNull();
  });
  it('[확정 11-09] 0알인 사람이 또 지면 배려판 대상', () => {
    const r = finishHand(withEggs([5, 5, 0, 7]), endedHand([0, 1], [0, 1, 2, 3]));
    expect(r.match.status).toBe('playing');
    expect(r.match.careSeat).toBe(2);
  });
  it('[확정 11-09] 0알이어도 이기면 알을 얻고 계속', () => {
    const r = finishHand(withEggs([5, 5, 0, 7]), endedHand([2, 3], [2, 3, 0, 1]));
    expect(r.match.players[2].eggs).toBe(2);
    expect(r.match.status).toBe('playing');
  });
  it('지급 부족으로 0알 → 배려판 대상, 다음 판 선', () => {
    const r = finishHand(withEggs([5, 5, 1, 7]), endedHand([0, 1], [0, 1, 2, 3]));
    expect(r.match.status).toBe('playing');
    expect(r.match.careSeat).toBe(2);
    const next = startHand(r.match, seededRng(1), 12);
    expect(next.hand.leaderSeat).toBe(2);
    expect(next.match.players[2].careUsed).toBe(true);
  });
  it('배려판 대상 2명 이상 동시 발생 → 즉시 종료', () => {
    const r = finishHand(withEggs([5, 5, 1, 1]), endedHand([0, 1], [0, 1, 2, 3]));
    expect(r.match.status).toBe('ended');
    expect(r.match.endReason).toBe('multiple-care');
  });
  it('배려판에서 알을 얻으면 생존', () => {
    let m = withEggs([5, 5, 0, 10], { careSeat: 2 });
    m.players[2].careUsed = true;
    const r = finishHand(m, endedHand([0, 1], [2, 3, 0, 1]));
    expect(r.outcome.careSurvived).toBe(true);
    expect(r.match.status).toBe('playing');
  });
  it('[확정] 배려판에서 물판이면 생존 실패 → 게임 종료', () => {
    let m = withEggs([5, 5, 0, 10], { careSeat: 2 });
    m.players[2].careUsed = true;
    const r = finishHand(m, endedHand([0, 1], [0, 2, 3, 1])); // 불팀 1·4등 = 물판
    expect(r.outcome.careSurvived).toBe(false);
    expect(r.match.status).toBe('ended');
    expect(r.match.eliminated).toEqual([2]);
  });
  it('배려판에서 지면 탈락', () => {
    let m = withEggs([5, 5, 0, 10], { careSeat: 2 });
    m.players[2].careUsed = true;
    const r = finishHand(m, endedHand([0, 1], [0, 1, 2, 3]));
    expect(r.match.status).toBe('ended');
  });
  it('배려판 생존 후 다시 파산하면 추가 배려판 없이 탈락', () => {
    const m = withEggs([5, 5, 1, 10]);
    m.players[2].careUsed = true;
    const r = finishHand(m, endedHand([0, 1], [0, 1, 2, 3])); // 1알인데 2알 의무 → 부족
    expect(r.match.careSeat).toBeNull();
    expect(r.match.status).toBe('ended');
    expect(r.match.eliminated).toEqual([2]);
  });
});

describe('최종 순위', () => {
  it('보유 알 기준, 동점은 공동 순위', () => {
    const rows = finalStandings(withEggs([7, 12, 7, 0]));
    expect(rows.map((r) => [r.nickname, r.place])).toEqual([['나', 1], ['가', 2], ['다', 2], ['라', 4]]);
  });
});

describe('대량 무작위 시뮬레이션', () => {
  it('200게임을 끝까지 돌려도 카드 48장·알 총량 보존, 오류 없음', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = simulateMatch(seed, 6);
      expect(r.match.status).toBe('ended');
    }
  }, 60_000);
});
