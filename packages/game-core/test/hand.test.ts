import { describe, expect, it } from 'vitest';
import { applyHandBatch, hasNoPlay, legalPlays, specialOptions, timeoutAction } from '../src/hand';
import { chatda, events, mureugi, ok, pass, play, rejected, setup } from './helpers';

describe('턴과 선', () => {
  it('선은 패스할 수 없다', () => {
    const st = setup([['S3'], ['S4'], ['S5'], ['S6']].map((h) => [...h, 'C14']));
    rejected(st, pass(0));
  });

  it('모든 상대가 패스하면 마지막 공격자가 새 선', () => {
    let st = setup([['S3', 'S7'], ['S4', 'H7'], ['S5', 'D7'], ['S6', 'C7']]);
    st = ok(st, play(0, 'S7'));
    st = ok(st, pass(1));
    st = ok(st, pass(2));
    st = ok(st, pass(3));
    expect(st.leaderSeat).toBe(0);
    expect(st.trick).toHaveLength(0);
  });

  it('패스했던 사람도 새 공격 후 다시 참여할 수 있다', () => {
    let st = setup([['S3', 'S12'], ['S4', 'S9'], ['S5', 'S13'], ['S6', 'H3']]);
    st = ok(st, play(0, 'S3'));
    st = ok(st, pass(1));
    st = ok(st, play(2, 'S5'));
    st = ok(st, pass(3));
    st = ok(st, pass(0));
    st = ok(st, play(1, 'S9')); // 패스했던 1번이 다시 참여
    expect(st.activeSeat).toBe(2);
  });

  it('차례가 아니면 낼 수 없고, 약한 조합도 낼 수 없다', () => {
    let st = setup([['S9', 'H3'], ['S4', 'S12'], ['S5'], ['S6']]);
    rejected(st, play(1, 'S4'));
    st = ok(st, play(0, 'S9'));
    rejected(st, play(1, 'S4'));
  });

  it('마지막 공격자가 완주했으면 다음 활동 좌석으로 통선', () => {
    let st = setup([['S8', 'S3'], ['S9'], ['S5', 'S6'], ['H5', 'H6', 'D10']], 0);
    st = ok(st, play(0, 'S8'));
    st = ok(st, play(1, 'S9')); // 1번 완주 (88 보유자 없음 → 즉시 확정)
    expect(st.finished).toEqual([1]);
    st = ok(st, pass(2));
    st = ok(st, pass(3));
    st = ok(st, pass(0));
    expect(st.leaderSeat).toBe(2);
  });
});

describe('찼다 · 꽂다', () => {
  const base = () => setup([['S8', 'S3', 'S5'], ['S9', 'S4', 'S6'], ['H8', 'D8', 'H3'], ['C8', 'C3', 'C4']]);

  it('싱글 8 → 88 찼다 → 남은 8 꽂다: 꽂은 사람이 선', () => {
    let st = ok(base(), play(0, 'S8'));
    st = ok(st, chatda(2, 'H8', 'D8')); // 순서 밖에서
    expect(st.phase).toBe('kkotda-window');
    expect(st.window).toMatchObject({ type: 'kkotda', seat: 3 });
    st = ok(st, { type: 'kkotda', seat: 3 });
    expect(st.leaderSeat).toBe(3);
    expect(st.hands[3]).not.toContain('C8');
  });

  it('꽂다를 통과하면 익명 "안 꽂아!" 후 찬 사람이 선', () => {
    let st = ok(base(), play(0, 'S8'));
    st = ok(st, chatda(2, 'H8', 'D8'));
    st = ok(st, { type: 'kkotdaPass', seat: 3 });
    expect(events()).toContainEqual({ type: 'noKkot' });
    expect(st.leaderSeat).toBe(2);
  });

  it('꽂다 5초 시간 만료도 통과와 같다', () => {
    let st = ok(base(), play(0, 'S8'));
    st = ok(st, chatda(2, 'H8', 'D8'));
    st = ok(st, { type: 'windowTimeout' });
    expect(st.leaderSeat).toBe(2);
  });

  it('자기가 낸 카드는 찰 수 없고, 다른 숫자 페어로도 찰 수 없다', () => {
    let st = setup([['S8', 'H8', 'D8', 'S3'], ['S9'], ['H9', 'D9'], ['C3']]);
    st = ok(st, play(0, 'S8'));
    rejected(st, chatda(0, 'H8', 'D8'));
    rejected(st, chatda(2, 'H9', 'D9'));
  });

  it('찼다 확정 후에는 같은 찼다를 또 할 수 없다 (중복 사용 없음)', () => {
    let st = ok(base(), play(0, 'S8'));
    const r = applyHandBatch(st, [chatda(2, 'H8', 'D8'), chatda(2, 'H8', 'D8')]);
    expect(r.rejected).toHaveLength(1);
    const all = [...r.state.discard, ...r.state.hands.flat(), ...r.state.trick.flatMap((p) => p.combo.cards)];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('쌍카 찼다', () => {
  it('4-5-6 닐리리 → 44-55-66 찼다 → 남은 4-5-6 꽂다', () => {
    let st = setup([['S4', 'S5', 'S6', 'S3'], ['S12'], ['H4', 'D4', 'H5', 'D5', 'H6', 'D6', 'H3'], ['C4', 'C5', 'C6', 'C3']]);
    st = ok(st, play(0, 'S4', 'S5', 'S6'));
    st = ok(st, chatda(2, 'H4', 'D4', 'H5', 'D5', 'H6', 'D6'));
    expect(st.window).toMatchObject({ type: 'kkotda', seat: 3 });
    st = ok(st, { type: 'kkotda', seat: 3 });
    expect(st.leaderSeat).toBe(3);
    expect(st.hands[3]).toEqual(['C3']);
  });

  it('7-8-9 등 다른 3장 닐리리에도 똑같이 적용', () => {
    let st = setup([['S7', 'S8', 'S9', 'S3'], ['S12'], ['H7', 'D7', 'H8', 'D8', 'H9', 'D9', 'H3'], ['C3']]);
    st = ok(st, play(0, 'S7', 'S8', 'S9'));
    st = ok(st, chatda(2, 'H7', 'D7', 'H8', 'D8', 'H9', 'D9'));
    expect(st.leaderSeat).toBe(2); // 남은 7·8·9를 모두 가진 사람 없음 → 꽂다 창 없음
  });

  it('3장보다 긴 닐리리: 4~9 닐리리에 445566778899 로 찼다', () => {
    const pairs = ['H4', 'D4', 'H5', 'D5', 'H6', 'D6', 'H7', 'D7', 'H8', 'D8', 'H9', 'D9'];
    let st = setup([['S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S3'], ['S12'], [...pairs, 'H3'], ['C3']]);
    st = ok(st, play(0, 'S4', 'S5', 'S6', 'S7', 'S8', 'S9'));
    st = ok(st, chatda(2, ...pairs));
    expect(st.leaderSeat).toBe(2);
  });

  it('더 긴 쌍카를 가졌으면 해당 숫자 부분만 사용 (전부 내면 거절)', () => {
    let st = setup([['S4', 'S5', 'S6', 'S3'], ['S12'], ['H4', 'D4', 'H5', 'D5', 'H6', 'D6', 'H7', 'D7'], ['C3']]);
    st = ok(st, play(0, 'S4', 'S5', 'S6'));
    rejected(st, chatda(2, 'H4', 'D4', 'H5', 'D5', 'H6', 'D6', 'H7', 'D7'));
    st = ok(st, chatda(2, 'H4', 'D4', 'H5', 'D5', 'H6', 'D6'));
    expect(st.hands[2]).toEqual(['H7', 'D7']);
  });
});

describe('무르기', () => {
  const base = () => setup([['S8', 'S3'], ['S9', 'S4'], ['H8', 'D8', 'H3'], ['H9', 'D9', 'C3', 'C12']]);

  it('8 → 9 → 88 무르기: 9는 주인에게 돌아가고 무른 사람이 선', () => {
    let st = ok(base(), play(0, 'S8'));
    st = ok(st, play(1, 'S9'));
    st = ok(st, mureugi(2, 'H8', 'D8'));
    expect(st.hands[1]).toContain('S9');
    expect(st.leaderSeat).toBe(2);
  });

  it('8 → 9 → 99 찼다 확정 후 88 무르기는 거절', () => {
    let st = ok(base(), play(0, 'S8'));
    st = ok(st, play(1, 'S9'));
    st = ok(st, chatda(3, 'H9', 'D9'));
    rejected(st, mureugi(2, 'H8', 'D8'));
  });

  it('[확정] 카드가 두 번 나가면 무르기 불가, 패스는 세지 않음', () => {
    let st = setup([['S8', 'S3'], ['S9', 'S4'], ['S10', 'H3'], ['H8', 'D8', 'C3']]);
    st = ok(st, play(0, 'S8'));
    st = ok(st, play(1, 'S9'));
    const afterPlay = ok(st, play(2, 'S10'));
    rejected(afterPlay, mureugi(3, 'H8', 'D8'));
    const afterPass = ok(st, pass(2));
    const r = ok(afterPass, mureugi(3, 'H8', 'D8')); // 9 뒤에 패스만 → 아직 가능
    expect(r.hands[1]).toContain('S9');
  });

  it('같은 처리 단위에서 무르기와 찼다가 겹치면 무르기 우선', () => {
    let st = ok(base(), play(0, 'S8'));
    st = ok(st, play(1, 'S9'));
    const r = applyHandBatch(st, [chatda(3, 'H9', 'D9'), mureugi(2, 'H8', 'D8')]);
    expect(r.rejected.map((x) => x.action.type)).toEqual(['chatda']);
    expect(r.state.leaderSeat).toBe(2);
  });

  it('다른 처리 단위에서는 먼저 확정된 행동 우선', () => {
    let st = ok(base(), play(0, 'S8'));
    st = ok(st, play(1, 'S9'));
    const first = applyHandBatch(st, [chatda(3, 'H9', 'D9')]);
    const second = applyHandBatch(first.state, [mureugi(2, 'H8', 'D8')]);
    expect(second.rejected).toHaveLength(1);
    expect(second.state.leaderSeat).toBe(3);
  });

  it('마지막 9로 완주했어도 무르기로 9가 돌아오면 완주 취소', () => {
    let st = setup([['S8', 'S3'], ['S9'], ['H8', 'D8', 'H10', 'H3'], ['D10', 'C3']]);
    st = ok(st, play(0, 'S8'));
    st = ok(st, play(1, 'S9'));
    expect(st.provisional).toBe(1);
    expect(st.finished).toEqual([]);
    st = ok(st, mureugi(2, 'H8', 'D8'));
    expect(events()).toContainEqual({ type: 'finishCanceled', seat: 1 });
    expect(st.hands[1]).toEqual(['S9']);
    expect(st.provisional).toBeNull();
  });

  it('잠정 완주는 다음 카드가 나오면 확정된다', () => {
    let st = setup([['S8', 'S3'], ['S9'], ['H8', 'D8', 'H10', 'H3'], ['D10', 'C3']]);
    st = ok(st, play(0, 'S8'));
    st = ok(st, play(1, 'S9'));
    st = ok(st, play(2, 'H10'));
    expect(st.finished).toEqual([1]);
  });

  it('패스만 이어지면 잠정 상태 유지, 더미를 치울 때 확정 → 통선', () => {
    let st = setup([['S8', 'S3'], ['S9'], ['H8', 'D8', 'H10', 'H3'], ['D10', 'C3']]);
    st = ok(st, play(0, 'S8'));
    st = ok(st, play(1, 'S9'));
    st = ok(st, pass(2));
    expect(st.provisional).toBe(1);
    st = ok(st, pass(3));
    st = ok(st, pass(0));
    expect(st.finished).toEqual([1]);
    expect(st.leaderSeat).toBe(2);
  });

  it('무를 수 있는 사람이 없으면 마지막 카드 완주는 즉시 확정', () => {
    let st = setup([['S8', 'S3'], ['S9'], ['H8', 'H3', 'H10'], ['D8', 'C3', 'D10']]);
    st = ok(st, play(0, 'S8'));
    st = ok(st, play(1, 'S9'));
    expect(st.finished).toEqual([1]);
  });

  it('[확정] 싱글 → 패스 → 다른 싱글이어도 무르기로 찰 수 있다', () => {
    let st = setup([['S8', 'S3'], ['S4'], ['S9', 'H3'], ['H8', 'D8', 'C3']]);
    st = ok(st, play(0, 'S8'));
    st = ok(st, pass(1));
    st = ok(st, play(2, 'S9'));
    st = ok(st, mureugi(3, 'H8', 'D8'));
    expect(st.hands[2]).toContain('S9');
    expect(st.leaderSeat).toBe(3);
  });

  it('[확정] 무르기로 찬 뒤에도 남은 네 번째 카드로 꽂다 가능', () => {
    let st = setup([['S8', 'S3'], ['S9', 'S4'], ['H8', 'D8', 'H3'], ['C8', 'C3']]);
    st = ok(st, play(0, 'S8'));
    st = ok(st, play(1, 'S9'));
    st = ok(st, mureugi(2, 'H8', 'D8'));
    expect(st.window).toMatchObject({ type: 'kkotda', seat: 3 });
    st = ok(st, { type: 'kkotda', seat: 3 });
    expect(st.leaderSeat).toBe(3);
  });

  it('[확정] 꽂다 5초 선택 중에는 다음 턴이 시작되지 않는다', () => {
    let st = setup([['S8', 'S3'], ['S9', 'S4'], ['H8', 'D8', 'H3'], ['C8', 'C3']]);
    st = ok(st, play(0, 'S8'));
    st = ok(st, chatda(2, 'H8', 'D8'));
    rejected(st, play(2, 'H3'));
    rejected(st, play(3, 'C3'));
  });

  it('[확정] 쌍카 찼다 뒤 남은 카드가 여러 사람에게 흩어져 있으면 꽂다 없음', () => {
    let st = setup([['S4', 'S5', 'S6', 'S3'], ['C4', 'S12'], ['H4', 'D4', 'H5', 'D5', 'H6', 'D6', 'H3'], ['C5', 'C6', 'C3']]);
    st = ok(st, play(0, 'S4', 'S5', 'S6'));
    st = ok(st, chatda(2, 'H4', 'D4', 'H5', 'D5', 'H6', 'D6'));
    expect(st.window).toBeNull();
    expect(st.leaderSeat).toBe(2);
  });
});

describe('완주와 특수 행동', () => {
  it('찼다로 완주해도 꽂다 기회 유지, 찼다 완주 순위 유지', () => {
    let st = setup([['S8', 'S3'], ['S4'], ['H8', 'D8'], ['C8', 'C3']]);
    st = ok(st, play(0, 'S8'));
    st = ok(st, chatda(2, 'H8', 'D8'));
    expect(st.finished).toEqual([2]);
    st = ok(st, { type: 'kkotda', seat: 3 });
    expect(st.finished).toEqual([2]);
    expect(st.leaderSeat).toBe(3);
  });

  it('찼다로 완주하고 꽂다가 없으면 완주자 다음 좌석으로 통선', () => {
    let st = setup([['S8', 'S3'], ['S4'], ['H8', 'D8'], ['C3']]);
    st = ok(st, play(0, 'S8'));
    st = ok(st, chatda(2, 'H8', 'D8'));
    expect(st.leaderSeat).toBe(3);
  });

  it('꽂다로 완주하면 꽂은 사람 다음 좌석으로 통선', () => {
    let st = setup([['S8', 'S3'], ['S4'], ['H8', 'D8', 'H3'], ['C8']]);
    st = ok(st, play(0, 'S8'));
    st = ok(st, chatda(2, 'H8', 'D8'));
    st = ok(st, { type: 'kkotda', seat: 3 });
    expect(st.finished).toEqual([3]);
    expect(st.leaderSeat).toBe(0);
  });
});

describe('불돼지 · 흑돼지', () => {
  it('[확정] 싱글 10 위에 ♥10♦10은 찼다가 아니라 불돼지 (꽂다 기회 없음)', () => {
    let st = setup([['S10', 'S3'], ['H10', 'D10', 'S4'], ['C10', 'S5'], ['S6']]);
    st = ok(st, play(0, 'S10'));
    rejected(st, chatda(1, 'H10', 'D10'));
    expect(specialOptions(st, 1)).toEqual([]);
    st = ok(st, play(1, 'H10', 'D10')); // 자기 차례에 불돼지로
    expect(events()).toContainEqual({ type: 'pig', seat: 1 });
    expect(st.window?.type).not.toBe('kkotda');
    expect(st.leaderSeat).toBe(1);
  });

  it('[확정] ♥10♦10으로 차기(무르기)도 불가', () => {
    let st = setup([['S10', 'S3'], ['S11', 'S4'], ['H10', 'D10', 'S5'], ['C10', 'S6']]);
    st = ok(st, play(0, 'S10'));
    st = ok(st, play(1, 'S11'));
    expect(specialOptions(st, 2)).toEqual([]);
    rejected(st, mureugi(2, 'H10', 'D10'));
  });

  it('불 한 장과 흑 10을 함께 가졌으면 흑 10을 먼저 써서 찰 수 있다', () => {
    let st = setup([['S10', 'S3'], ['H10', 'D10', 'C10', 'S4'], ['S5'], ['S6']]);
    st = ok(st, play(0, 'S10'));
    const o = specialOptions(st, 1);
    expect(o).toHaveLength(1);
    expect(o[0].cards).toContain('C10');
  });

  const pigHands = () => [['H10', 'D10', 'S3'], ['S4', 'H4'], ['S10', 'C10', 'S5'], ['S6', 'H6']];

  it('불돼지 후 흑돼지 보유자에게 선택 창, 시간 초과 시 자동 통과 → 불돼지 제출자 선', () => {
    let st = setup(pigHands());
    expect(st.teamMode).toBe('pig-1v3');
    st = ok(st, play(0, 'H10', 'D10'));
    expect(events()).toContainEqual({ type: 'pig', seat: 0 });
    expect(st.window).toMatchObject({ type: 'blackpig', seat: 2 });
    rejected(st, play(1, 'S4', 'H4')); // 다른 조합은 막을 수 없음
    st = ok(st, { type: 'windowTimeout' });
    expect(st.leaderSeat).toBe(0);
  });

  it('흑돼지 제출 시 흑돼지 제출자가 선', () => {
    let st = ok(setup(pigHands()), play(0, 'H10', 'D10'));
    st = ok(st, { type: 'blackPigSubmit', seat: 2 });
    expect(events()).toContainEqual({ type: 'blackPig', seat: 2 });
    expect(st.leaderSeat).toBe(2);
  });

  it('흑돼지 보유자가 없으면 바로 불돼지 제출자가 선', () => {
    let st = setup([['H10', 'D10', 'S3'], ['S10', 'H4'], ['C10', 'S5'], ['S6']]);
    st = ok(st, play(0, 'H10', 'D10'));
    expect(st.leaderSeat).toBe(0);
  });

  it('[확정] 불돼지는 마지막 카드로 낼 수 없다', () => {
    const st = setup([['H10', 'D10'], ['S4', 'H4'], ['S10', 'C10', 'S5'], ['S6']]);
    rejected(st, play(0, 'H10', 'D10'));
  });

  it('흑돼지를 아껴 평소 10 페어로 쓸 수 있다', () => {
    let st = setup([['S9', 'H9', 'S3'], ['S10', 'C10', 'S4'], ['S5'], ['S6']]);
    st = ok(st, play(0, 'S9', 'H9'));
    st = ok(st, play(1, 'S10', 'C10'));
    expect(st.trick.at(-1)?.combo.kind).toBe('pair');
  });
});

describe('달리기 · 뚝', () => {
  const hands = () => [['H10', 'S3'], ['D10', 'S4'], ['S5'], ['S6']];

  it('불 보유자 달리기 → 불 공개·교환, ×2 → 반대편 뚝 ×4', () => {
    let st = setup(hands(), 0, false);
    rejected(st, { type: 'declareRun', seat: 2 });
    st = ok(st, { type: 'declareRun', seat: 0 });
    expect(st.multiplier).toBe(2);
    expect(st.revealedFire.sort()).toEqual([0, 1]);
    expect(st.hands[0]).toContain('D10');
    expect(st.hands[1]).toContain('H10');
    rejected(st, { type: 'declareDdook', seat: 1 }); // 같은 편은 불가
    st = ok(st, { type: 'declareDdook', seat: 3 });
    expect(st.multiplier).toBe(4);
    expect(st.phase).toBe('turn');
  });

  it('달리기가 없으면 일반판, 불 카드를 내면 "불이야!" 후 소유자 공개', () => {
    let st = setup(hands());
    st = ok(st, play(0, 'H10'));
    expect(events()).toContainEqual({ type: 'fireAlarm', seat: 0 });
    expect(st.revealedFire).toEqual([0]);
  });

  it('돼지가 달리면 두 불 모두 공개, 교환 없음', () => {
    let st = setup([['H10', 'D10', 'S3'], ['S4'], ['S5'], ['S6']], 0, false);
    st = ok(st, { type: 'declareRun', seat: 0 });
    expect(st.hands[0]).toEqual(['H10', 'D10', 'S3']);
    expect(st.revealedFire).toEqual([0]);
  });
});

describe('[확정] 틀 이상은 마지막에 낼 수 없다', () => {
  it('틀·사사끼·마대로 완주하려 하면 거절, 나눠 내면 가능', () => {
    for (const cards of [['S7', 'H7', 'D7'], ['S4', 'H4', 'D14'], ['S9', 'H9', 'D9', 'C9']]) {
      let st = setup([cards, ['S3', 'H10'], ['S5', 'D10'], ['S6']]);
      rejected(st, play(0, ...cards));
      st = ok(st, play(0, cards[0]));
    }
  });
  it('주패가 남으면 틀은 낼 수 있다', () => {
    const st = setup([['S7', 'H7', 'D7', 'S3'], ['S4'], ['S5'], ['S6']]);
    ok(st, play(0, 'S7', 'H7', 'D7'));
  });
  it('마지막에 낼 수 없는 조합은 "낼 수 있는 패" 목록에서도 빠진다', () => {
    let st = setup([['S3', 'H14'], ['S7', 'H7', 'D7', 'D10'], ['S5'], ['S6']]);
    // 1번 주패: 7 7 7 ♦10 → 틀은 가능(♦10이 남음)
    st = ok(st, play(0, 'H14'));
    expect(legalPlays(st, 1).some((c) => c.kind === 'teul')).toBe(true);
    let st2 = setup([['S3', 'H14', 'H10'], ['S7', 'H7', 'D7'], ['S5', 'D10'], ['S6']]);
    st2 = ok(st2, play(0, 'H14'));
    expect(legalPlays(st2, 1)).toEqual([]); // 틀로는 완주 불가 → 낼 패 없음
    expect(hasNoPlay(st2)).toBe(true);
  });
  it('시간 만료 시에도 마지막 틀은 자동 제출하지 않는다', () => {
    let st = setup([['S3', 'H14', 'H10'], ['S7', 'H7', 'D7'], ['S5', 'D10'], ['S6']]);
    st = ok(st, play(0, 'H14'));
    expect(timeoutAction(st, 1, ['S7', 'H7', 'D7'])).toEqual(pass(1));
  });
});

describe('[확정] 마지막에 낼 수 있는 강한 조합', () => {
  it('쌍카로 완주 가능', () => {
    let st = setup([['S4', 'H4', 'S5', 'H5', 'S6', 'H6'], ['S3', 'H10'], ['C3', 'D10'], ['D3']]);
    st = ok(st, play(0, 'S4', 'H4', 'S5', 'H5', 'S6', 'H6'));
    expect(st.finished).toEqual([0]);
  });
  it('흑돼지로 불돼지를 막으면서 완주 가능', () => {
    let st = setup([['H10', 'D10', 'S3'], ['S10', 'C10'], ['S5'], ['S6']]);
    st = ok(st, play(0, 'H10', 'D10'));
    st = ok(st, { type: 'blackPigSubmit', seat: 1 });
    expect(st.finished).toEqual([1]);
  });
  it('쌍카 찼다로 완주 가능', () => {
    let st = setup([['S4', 'S5', 'S6', 'S3'], ['S12'], ['H4', 'D4', 'H5', 'D5', 'H6', 'D6'], ['C3']]);
    st = ok(st, play(0, 'S4', 'S5', 'S6'));
    st = ok(st, chatda(2, 'H4', 'D4', 'H5', 'D5', 'H6', 'D6'));
    expect(st.finished).toEqual([2]);
  });
});

describe('[확정] 낼 수 있는 패가 없을 때', () => {
  it('더 강한 조합이 하나도 없으면 자동 패스 대상', () => {
    let st = setup([['S14', 'S3'], ['S4', 'S9'], ['S6'], ['S7']]);
    st = ok(st, play(0, 'S14'));
    expect(hasNoPlay(st)).toBe(true); // 1번: A 위에 낼 싱글 없음 (불 ♦10도 A보다 낮음)
  });
  it('낼 수 있는 패가 하나라도 있으면 자동 패스하지 않음', () => {
    let st = setup([['S5', 'S3'], ['S4', 'S9'], ['S6'], ['S7']]);
    st = ok(st, play(0, 'S5'));
    expect(hasNoPlay(st)).toBe(false);
  });
  it('틀·마대·불돼지로 이길 수 있으면 낼 패가 있는 것', () => {
    let st = setup([['S14', 'S3'], ['S4', 'H4', 'D4'], ['S6'], ['S7']]);
    st = ok(st, play(0, 'S14'));
    expect(hasNoPlay(st)).toBe(false);
  });
  it('[확정] 낼 카드가 없어도 찰 수 있으면 자동 패스하지 않음', () => {
    let st = setup([['S9', 'S3'], ['H9', 'D9', 'S4'], ['S6', 'D10'], ['S7']]);
    st = ok(st, play(0, 'S9'));
    // 1번: 9 위에 낼 싱글 없음, 페어는 싱글 위에 못 냄 → 하지만 99로 찰 수 있음
    expect(legalPlays(st, 1)).toEqual([]);
    expect(hasNoPlay(st)).toBe(false);
  });
  it('선은 항상 낼 수 있음', () => {
    expect(hasNoPlay(setup([['S3'], ['S4'], ['S5'], ['S6']]))).toBe(false);
  });
});

describe('8초 시간 만료 기본 행동', () => {
  it('선택한 카드가 합법이면 그대로 제출', () => {
    let st = setup([['S3', 'S5'], ['S4', 'S9'], ['S6'], ['S7']]);
    st = ok(st, play(0, 'S5'));
    expect(timeoutAction(st, 1, ['S9'])).toEqual(play(1, 'S9'));
  });
  it('합법 선택이 없으면 패스', () => {
    let st = setup([['S3', 'S14'], ['S4', 'S9'], ['S6'], ['S7']]);
    st = ok(st, play(0, 'S14'));
    expect(timeoutAction(st, 1, ['S4'])).toEqual(pass(1));
  });
  it('선이면 패스 대신 가장 낮은 카드', () => {
    const st = setup([['S9', 'S5'], ['S4'], ['S6'], ['S7']]);
    expect(timeoutAction(st, 0)).toEqual(play(0, 'S5'));
  });
});

describe('판 종료', () => {
  it('세 번째 완주가 확정되면 판 종료, 남은 사람은 자동 4등', () => {
    // 불팀 = 0·2번, 흑팀 = 1·3번 → 1·2등(3번, 0번)이 다른 팀이라 계속 진행
    let st = setup([['D10'], ['S4', 'S14', 'D3'], ['S6', 'H10'], ['S7']], 1);
    st = ok(st, play(1, 'S4'));
    st = ok(st, play(2, 'S6'));
    st = ok(st, play(3, 'S7'));
    st = ok(st, play(0, 'D10'));
    expect(st.finished).toEqual([3, 0]);
    expect(st.phase).toBe('turn');
    st = ok(st, play(1, 'S14'));
    st = ok(st, pass(2));
    st = ok(st, play(1, 'D3'));
    expect(st.phase).toBe('hand-over');
    expect(st.ranks).toEqual([3, 0, 1, 2]);
    expect(st.earlyEnd).toBe(false);
  });

  it('[확정] 2대2에서 1·2등이 같은 팀이면 바로 판 종료', () => {
    // 불팀 = 2·3번, 흑팀 = 0·1번
    let st = setup([['S5'], ['S6'], ['H10', 'S3'], ['D10', 'C3']], 0);
    st = ok(st, play(0, 'S5'));
    st = ok(st, play(1, 'S6'));
    expect(st.phase).toBe('hand-over');
    expect(st.earlyEnd).toBe(true);
    expect(st.ranks!.slice(0, 2)).toEqual([0, 1]);
    expect(events()).toContainEqual({ type: 'handOver', ranks: st.ranks, early: true });
  });

  it('2등이 무르기로 취소될 수 있으면 확정될 때까지 기다린다', () => {
    let st = setup([['S5'], ['S6'], ['H10', 'H5', 'D5'], ['D10', 'C3']], 0);
    st = ok(st, play(0, 'S5'));
    st = ok(st, play(1, 'S6'));
    expect(st.phase).toBe('turn');
    expect(st.provisional).toBe(1);
    st = ok(st, mureugi(2, 'H5', 'D5'));
    expect(st.hands[1]).toEqual(['S6']);
    expect(st.phase).toBe('turn');
  });

  it('[확정] 돼지가 1등이면 바로 판 종료', () => {
    let st = setup([['H10', 'D10', 'S9'], ['S3', 'C4'], ['S4', 'C5'], ['S5', 'C6']], 0);
    st = ok(st, play(0, 'H10', 'D10')); // 흑돼지 없음 → 다시 돼지 선
    st = ok(st, play(0, 'S9'));
    expect(st.phase).toBe('hand-over');
    expect(st.ranks![0]).toBe(0);
    expect(st.earlyEnd).toBe(true);
  });

  it('[확정] 돼지가 2등이면(물판) 바로 판 종료', () => {
    let st = setup([['H10', 'D10', 'S3', 'S13'], ['S12'], ['S4', 'C5'], ['S5', 'C6']], 0);
    st = ok(st, play(0, 'H10', 'D10')); // 흑돼지 없음 → 돼지가 다시 선
    st = ok(st, play(0, 'S3'));
    st = ok(st, play(1, 'S12')); // 흑 1번 1등
    st = ok(st, pass(2));
    st = ok(st, pass(3));
    st = ok(st, play(0, 'S13')); // 돼지 2등 완주 → 물판
    expect(st.phase).toBe('hand-over');
    expect(st.ranks!.slice(0, 2)).toEqual([1, 0]);
  });

  it('돼지 판에서 흑팀이 1·2등이어도 돼지가 남아 있으면 계속 (돼지 3등/4등에 따라 결과가 달라짐)', () => {
    let st = setup([['S5'], ['S6'], ['H10', 'D10', 'S3'], ['C3', 'C4']], 0);
    st = ok(st, play(0, 'S5'));
    st = ok(st, play(1, 'S6'));
    expect(st.finished).toEqual([0, 1]);
    expect(st.phase).toBe('turn');
  });
});
