import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CardId, createHand, enumerateCombos, canBeat, classifyCombo } from '../../../packages/game-core/src/index';
import { Room, TIMES } from '../src/room';

type V = ReturnType<Room['view']>;

function makeRoom(seed = 7) {
  const views: V[][] = [[], [], [], []];
  const notices: string[][] = [[], [], [], []];
  let expired = false;
  const room = new Room('TEST', {
    emit: (seat, ev, p) => (ev === 'view' ? views[seat].push(p as V) : notices[seat].push(p as string)),
    onExpire: () => { expired = true; },
  }, seed);
  const tokens = ['가', '나', '다', '라'].map((n) => {
    const r = room.join(n);
    if (!r.ok) throw new Error(r.reason);
    return r.token;
  });
  return { room, views, notices, tokens, isExpired: () => expired };
}

/** 게임 상태를 원하는 패로 바꿔치기 (규칙 시나리오용) */
function rig(room: Room, hands: CardId[][], leader = 0) {
  const h = createHand(hands, leader);
  h.phase = 'turn';
  room.hand = h;
  (room as any).changed();
}

const act = (room: Room, seat: number, type: string, cards?: CardId[]) => {
  room.submit(seat, { type, cards });
  vi.advanceTimersByTime(1);
};

/** 화면 정보에 들어 있는 카드가 전부 '내 주패' 또는 '판 위 공개 카드'인지 */
function assertNoLeak(room: Room, seat: number) {
  const v = room.view(seat);
  const json = JSON.stringify({ ...v, log: [] });
  const cards = [...json.matchAll(/"([SHDC](?:1[0-4]|[3-9]))"/g)].map((m) => m[1]);
  const mine = new Set(room.hand ? room.hand.hands[seat] : []);
  const pub = new Set((room.reveal?.plays ?? room.hand?.trick ?? []).flatMap((p) => p.combo.cards));
  if (room.lastHand) room.lastHand.trick.forEach((p) => p.combo.cards.forEach((c) => pub.add(c)));
  // 흑돼지 창의 ♠10♣10 표시는 본인 창일 때만 나옴
  for (const c of cards) expect(mine.has(c) || pub.has(c) || (c === 'S10' || c === 'C10') && room.hand?.window?.seat === seat, `${seat}번에게 ${c} 노출`).toBe(true);
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('입장', () => {
  it('4명이 모이면 방장이 시작, 5번째는 거절', () => {
    const { room } = makeRoom();
    expect(room.join('마').ok).toBe(false);
    expect(room.start(1)).toBe('방장만 시작할 수 있어요');
    expect(room.start(0)).toBeNull();
    expect(room.status).toBe('playing');
  });
  it('시작 후에는 같은 닉네임이어도 복귀 정보가 없으면 자리 접근 불가', () => {
    const { room } = makeRoom();
    room.start(0);
    room.disconnect(1);
    expect(room.join('나').ok).toBe(false);
  });
  it('같은 브라우저의 복귀 정보로는 자리를 되찾는다', () => {
    const { room, tokens } = makeRoom();
    room.start(0);
    room.disconnect(2);
    const r = room.join('아무거나', tokens[2]);
    expect(r.ok && r.seat).toBe(2);
  });
});

describe('정보 숨김', () => {
  it('누구에게도 다른 사람의 주패가 전송되지 않는다 (무작위 3판 진행 내내)', () => {
    const { room } = makeRoom(11);
    room.start(0);
    let steps = 0;
    while (room.match!.handNo <= 3 && room.status === 'playing' && steps++ < 4000) {
      for (let s = 0; s < 4; s++) assertNoLeak(room, s);
      const h = room.hand!;
      if (!room.reveal && !room.outcome && h.phase === 'turn' && Math.random() < 0.7) {
        const seat = h.activeSeat;
        const top = h.trick.at(-1)?.combo ?? null;
        const plays = enumerateCombos(h.hands[seat]).filter((c) => canBeat(c, top));
        if (plays.length) act(room, seat, 'play', plays[0].cards);
      }
      vi.advanceTimersByTime(500);
      if (room.outcome) [0, 1, 2, 3].forEach((s) => room.readyNext(s));
    }
    expect(room.match!.handNo).toBeGreaterThan(1);
  });

  it('찰 수 있음·꽂다 창의 주인은 본인에게만 보인다', () => {
    const { room } = makeRoom();
    room.start(0);
    rig(room, [['S8', 'S3', 'H10'], ['S9', 'D10'], ['H8', 'D8', 'H3'], ['C8', 'C3']]);
    act(room, 0, 'play', ['S8']);
    expect((room.view(2).mine as any).options).toHaveLength(1);
    expect((room.view(1).mine as any).options).toHaveLength(0);
    act(room, 2, 'chatda', ['H8', 'D8']);
    expect((room.view(3).mine as any).window?.type).toBe('kkotda');
    for (const s of [0, 1, 2]) {
      expect((room.view(s).mine as any).window).toBeNull();
      expect((room.view(s).game as any).phase).toBe('waiting');
    }
  });

  it('잠정 완주는 다른 사람에게 순위로 보이지 않는다', () => {
    const { room } = makeRoom();
    room.start(0);
    rig(room, [['S8', 'S3'], ['S9'], ['H8', 'D8', 'H10', 'H3'], ['D10', 'C3']]);
    act(room, 0, 'play', ['S8']);
    act(room, 1, 'play', ['S9']);
    const seat1 = (room.view(3).seats as any[])[1];
    expect(seat1.rank).toBeNull();
    expect(seat1.cardCount).toBe(0);
  });
});

describe('타이머', () => {
  it('달리기 5초가 지나면 자동으로 차례 시작, 8초 지나면 자동 행동', () => {
    const { room } = makeRoom();
    room.start(0);
    expect(room.hand!.phase).toBe('run-declare');
    vi.advanceTimersByTime(TIMES.window + 5);
    expect(room.hand!.phase).toBe('turn');
    const leader = room.hand!.activeSeat;
    const before = room.hand!.hands[leader].length;
    vi.advanceTimersByTime(TIMES.turn + 5);
    expect(room.hand!.hands[leader].length).toBe(before - 1); // 선은 가장 낮은 카드 자동 제출
  });

  it('시간 만료 시 선택해 둔 합법 조합을 자동 제출', () => {
    const { room } = makeRoom();
    room.start(0);
    rig(room, [['S3', 'S5', 'H10'], ['S9', 'H9', 'S4', 'D10'], ['S6'], ['S7']]);
    act(room, 0, 'play', ['S5']);
    room.select(1, ['S9']);
    vi.advanceTimersByTime(TIMES.turn + 5);
    expect(room.hand!.trick.at(-1)?.combo.cards).toEqual(['S9']);
  });

  it('낼 패가 없으면 2초 뒤 자동 패스', () => {
    const { room } = makeRoom();
    room.start(0);
    rig(room, [['S14', 'S3', 'H10'], ['S4', 'S9'], ['S6', 'D10'], ['S7']]);
    act(room, 0, 'play', ['S14']);
    expect((room.view(1).mine as any).noPlay).toBe(true);
    vi.advanceTimersByTime(TIMES.autoPass + 5);
    expect(room.hand!.passed).toContain(1);
  });

  it('찼다 후 꽂을 사람이 없으면 찬 카드를 2초 보여준 뒤 정리, 그동안 행동 불가', () => {
    const { room, notices } = makeRoom();
    room.start(0);
    rig(room, [['S8', 'S3', 'H10'], ['S9', 'D10'], ['H8', 'D8', 'H3'], ['C3']]);
    act(room, 0, 'play', ['S8']);
    act(room, 2, 'chatda', ['H8', 'D8']);
    expect((room.view(0).game as any).phase).toBe('reveal');
    expect((room.view(0).game as any).trick.at(-1).cards).toEqual(['H8', 'D8']);
    act(room, 2, 'play', ['H3']);
    expect(notices[2].at(-1)).toBe('카드를 정리하는 중이에요');
    vi.advanceTimersByTime(TIMES.revealSpecial);
    expect((room.view(0).game as any).phase).toBe('turn');
    expect((room.view(0).game as any).trick).toHaveLength(0);
  });

  it('꽂다는 카드가 판에 놓인 채 2초 보인 뒤 정리', () => {
    const { room } = makeRoom();
    room.start(0);
    rig(room, [['S8', 'S3', 'H10'], ['S9', 'D10'], ['H8', 'D8', 'H3'], ['C8', 'C3']]);
    act(room, 0, 'play', ['S8']);
    act(room, 2, 'chatda', ['H8', 'D8']);
    act(room, 3, 'kkotda');
    const g = room.view(1).game as any;
    expect(g.phase).toBe('reveal');
    expect(g.trick.at(-1)).toMatchObject({ cards: ['C8'], via: 'kkotda' });
    expect(g.revealLeader).toBe(3);
    vi.advanceTimersByTime(TIMES.revealSpecial - 10);
    expect((room.view(1).game as any).phase).toBe('reveal');
    vi.advanceTimersByTime(20);
    expect((room.view(1).game as any).activeSeat).toBe(3);
  });

  it('불돼지·흑돼지는 3초 보여준 뒤 정리', () => {
    const { room } = makeRoom();
    room.start(0);
    rig(room, [['H10', 'D10', 'S3'], ['S4', 'H4'], ['S10', 'C10', 'S5'], ['S6']]);
    act(room, 0, 'play', ['H10', 'D10']);
    act(room, 2, 'blackPigSubmit');
    expect((room.view(0).game as any).phase).toBe('reveal');
    vi.advanceTimersByTime(TIMES.revealPig - 10);
    expect((room.view(0).game as any).phase).toBe('reveal');
    vi.advanceTimersByTime(20);
    expect((room.view(0).game as any).activeSeat).toBe(2);
  });

  it('모두 패스해서 정리될 때는 1초', () => {
    const { room } = makeRoom();
    room.start(0);
    rig(room, [['S7', 'S3', 'H10'], ['S4', 'H7'], ['S5', 'D7', 'D10'], ['S6', 'C7']]);
    act(room, 0, 'play', ['S7']);
    act(room, 1, 'pass'); act(room, 2, 'pass'); act(room, 3, 'pass');
    expect((room.view(0).game as any).phase).toBe('reveal');
    vi.advanceTimersByTime(TIMES.revealPass + 5);
    expect((room.view(0).game as any).activeSeat).toBe(0);
  });

  it('재접속해도 진행 중인 차례 시간은 늘어나지 않는다', () => {
    const { room, tokens } = makeRoom();
    room.start(0);
    vi.advanceTimersByTime(TIMES.window + 5);
    const at = room.deadline!.at;
    const seat = room.hand!.activeSeat;
    vi.advanceTimersByTime(3000);
    room.disconnect(seat);
    room.join('', tokens[seat]);
    expect(room.deadline!.at).toBe(at);
  });

  it('네 명 모두 나가면 멈추고, 59분 뒤 돌아오면 남은 시간으로 재개, 아무도 안 오면 1시간 뒤 방 폐기', () => {
    const { room, tokens, isExpired } = makeRoom();
    room.start(0);
    vi.advanceTimersByTime(TIMES.window + 5);
    vi.advanceTimersByTime(3000);
    const left = room.deadline!.at - Date.now();
    const handLen = room.hand!.hands.map((x) => x.length);
    [0, 1, 2, 3].forEach((s) => room.disconnect(s));
    vi.advanceTimersByTime(59 * 60_000);
    expect(room.hand!.hands.map((x) => x.length)).toEqual(handLen); // 멈춰 있었음
    room.join('', tokens[1]);
    expect(room.deadline!.at - Date.now()).toBe(left);
    expect(isExpired()).toBe(false);
    room.disconnect(1);
    vi.advanceTimersByTime(TIMES.emptyRoom + 5);
    expect(isExpired()).toBe(true);
  });
});

describe('판 결과와 다음 판', () => {
  it('결과 화면 후 모두 "다시 한 판 더"를 누르면 3초 카운트다운 후 다음 판', () => {
    const { room } = makeRoom();
    room.start(0);
    rig(room, [['S5'], ['S6'], ['H10', 'S3'], ['D10', 'C3']]); // 흑팀(0·1) 1·2등 → 즉시 종료
    act(room, 0, 'play', ['S5']);
    act(room, 1, 'play', ['S6']);
    expect(room.outcome).not.toBeNull();
    vi.advanceTimersByTime(TIMES.revealEnd + 5);
    expect(room.view(0).result).not.toBeNull();
    [0, 1, 2, 3].forEach((s) => room.readyNext(s));
    vi.advanceTimersByTime(TIMES.countdown + 5);
    expect(room.match!.handNo).toBe(2);
    expect(room.view(0).result).toBeNull();
  });

  it('아무도 안 눌러도 결과 10초 + 3초 뒤 다음 판', () => {
    const { room } = makeRoom();
    room.start(0);
    rig(room, [['S5'], ['S6'], ['H10', 'S3'], ['D10', 'C3']]);
    act(room, 0, 'play', ['S5']);
    act(room, 1, 'play', ['S6']);
    vi.advanceTimersByTime(TIMES.revealEnd + TIMES.result + TIMES.countdown + 10);
    expect(room.match!.handNo).toBe(2);
  });

  it('같은 서버 처리 단위의 무르기와 찼다: 무르기 우선', () => {
    const { room } = makeRoom();
    room.start(0);
    rig(room, [['S8', 'S3', 'H10'], ['S9', 'S4', 'D10'], ['H8', 'D8', 'H3'], ['H9', 'D9', 'C3']]);
    act(room, 0, 'play', ['S8']);
    act(room, 1, 'play', ['S9']);
    room.submit(3, { type: 'chatda', cards: ['H9', 'D9'] });
    room.submit(2, { type: 'mureugi', cards: ['H8', 'D8'] });
    vi.advanceTimersByTime(1);
    expect(room.hand!.leaderSeat).toBe(2);
    expect(room.hand!.hands[1]).toContain('S9');
  });

  it('같은 행동 ID 중복 제출은 한 번만 처리', () => {
    const { room } = makeRoom();
    room.start(0);
    rig(room, [['S3', 'S5', 'H10'], ['S9', 'S4', 'D10'], ['S6'], ['S7']]);
    room.submit(0, { type: 'play', cards: ['S3'], id: 'x1' });
    room.submit(0, { type: 'play', cards: ['S3'], id: 'x1' });
    vi.advanceTimersByTime(1);
    expect(room.hand!.trick).toHaveLength(1);
  });
});

void classifyCombo;

describe('AI 자리', () => {
  function aiRoom() {
    const views: number[] = [0, 0, 0, 0];
    const room = new Room('AIRM', { emit: (seat, ev) => { if (ev === 'view') views[seat]++; }, onExpire: () => {} }, 5);
    const a = room.join('가선') as { ok: true; seat: number; token: string };
    const b = room.join('친구') as { ok: true; seat: number; token: string };
    return { room, views, tokens: [a.token, b.token] };
  }

  it('방장만 빈 자리에 AI를 넣고 뺄 수 있고, 2명 + AI 2명으로 시작', () => {
    const { room } = aiRoom();
    expect(room.addAi(1)).toBe('방장만 AI를 넣을 수 있어요');
    expect(room.addAi(0)).toBeNull();
    expect(room.addAi(0)).toBeNull();
    expect(room.addAi(0)).toBe('빈 자리가 없어요');
    room.removeAi(0, 3);
    expect(room.seats[3]).toBeNull();
    room.addAi(0);
    expect(room.seats.filter((s) => s?.ai)).toHaveLength(2);
    expect(room.start(0)).toBeNull();
  });

  it('AI에게는 화면 정보를 보내지 않는다', () => {
    const { room, views } = aiRoom();
    room.addAi(0); room.addAi(0);
    room.start(0);
    vi.advanceTimersByTime(20_000);
    expect(views[2] + views[3]).toBe(0);
    expect(views[0]).toBeGreaterThan(0);
  });

  it('AI는 사람처럼 1~4초 안에 자기 차례 카드를 낸다 (8초 시간 초과 전)', () => {
    const { room } = aiRoom();
    room.addAi(0); room.addAi(0);
    room.start(0);
    rig(room, [['S5', 'S9', 'H10'], ['S6', 'S12', 'D10'], ['S3', 'S8', 'S4'], ['S7', 'C3']], 2);
    vi.advanceTimersByTime(1000);
    expect(room.hand!.trick).toHaveLength(0); // 바로 내지 않음
    vi.advanceTimersByTime(3000);
    expect(room.hand!.trick).toHaveLength(1);
    expect(room.hand!.trick[0].seat).toBe(2);
  });

  it('접속이 끊긴 사람 자리는 AI가 대신 플레이', () => {
    const { room } = aiRoom();
    room.addAi(0); room.addAi(0);
    room.start(0);
    rig(room, [['S5', 'S9', 'H10'], ['S6', 'S12', 'D10'], ['S3', 'S8'], ['S7', 'C3']], 1);
    room.disconnect(1);
    vi.advanceTimersByTime(4000);
    expect(room.hand!.trick[0]?.seat).toBe(1);
  });

  it('돌아오면 대기 중이던 AI 행동은 취소되고 조작권은 사람에게', () => {
    const { room, tokens } = aiRoom();
    room.addAi(0); room.addAi(0);
    room.start(0);
    rig(room, [['S5', 'S9', 'H10'], ['S6', 'S12', 'D10'], ['S3', 'S8'], ['S7', 'C3']], 1);
    room.disconnect(1);
    vi.advanceTimersByTime(500);
    room.join('', tokens[1]);
    vi.advanceTimersByTime(4500);
    expect(room.hand!.trick).toHaveLength(0); // AI가 내지 않았고, 사람 8초는 아직 남음
    vi.advanceTimersByTime(4000);
    expect(room.hand!.trick[0]?.seat).toBe(1); // 8초 시간 초과 자동 제출
  });

  it('사람 2명이 가만히 있어도 AI와 함께 여러 판이 진행된다', () => {
    const { room } = aiRoom();
    room.addAi(0); room.addAi(0);
    room.setEggs(0, 30);
    room.start(0);
    for (let i = 0; i < 2000 && room.match!.handNo < 3 && room.status === 'playing'; i++) vi.advanceTimersByTime(1000);
    expect(room.match!.handNo >= 3 || room.status === 'ended').toBe(true);
  });
});

describe('자리 바꾸기', () => {
  it('대기실: 방장만 자리를 섞을 수 있고, 방장·복귀 정보는 사람을 따라간다', () => {
    const { room, tokens } = makeRoom(3);
    expect(room.shuffleSeats(1)).toBe('대기실에서는 방장만 자리를 섞을 수 있어요');
    const before = room.seats.map((s) => s!.nickname);
    let changed = false;
    for (let i = 0; i < 10 && !changed; i++) { room.shuffleSeats(room.host); changed = room.seats.some((s, k) => s!.nickname !== before[k]); }
    expect(changed).toBe(true);
    expect(room.seats[room.host]!.nickname).toBe('가'); // 방장은 그대로 '가'
    const r = room.join('', tokens[2]); // '다'의 복귀 정보
    expect(r.ok && room.seats[r.seat]!.nickname).toBe('다');
  });

  it('판 결과 화면: 누구나 누를 수 있고, 다음 판에 섞이며 알·선이 사람을 따라간다', () => {
    const { room } = makeRoom(9);
    room.start(0);
    rig(room, [['S5'], ['S6'], ['H10', 'S3'], ['D10', 'C3']]); // '가'(0번) 1등
    act(room, 0, 'play', ['S5']);
    act(room, 1, 'play', ['S6']);
    vi.advanceTimersByTime(TIMES.revealEnd + 5);
    const eggsByName = Object.fromEntries(room.seats.map((s, i) => [s!.nickname, room.match!.players[i].eggs]));
    expect(room.shuffleSeats(2)).toBeNull();
    expect((room.view(0).result as any).shufflePending).toBe(true);
    [0, 1, 2, 3].forEach((s) => room.readyNext(s));
    vi.advanceTimersByTime(TIMES.countdown + 5);
    expect(room.match!.handNo).toBe(2);
    room.seats.forEach((s, i) => expect(room.match!.players[i].eggs).toBe(eggsByName[s!.nickname]));
    expect(room.seats[room.hand!.leaderSeat]!.nickname).toBe('가'); // 직전 1등이 선
    expect(room.shufflePending).toBe(false);
  });
});

describe('AI 숨김', () => {
  it('대기실에서는 AI 표시, 게임 중에는 누가 AI인지 보내지 않는다', () => {
    const room = new Room('HIDE', { emit: () => {}, onExpire: () => {} }, 2);
    room.join('가선'); room.join('친구');
    room.addAi(0); room.addAi(0);
    expect((room.view(0).seats as any[]).filter((s) => s.ai)).toHaveLength(2);
    room.start(0);
    const json = JSON.stringify(room.view(0).seats);
    expect(json.includes('"ai"')).toBe(false);
  });
});
