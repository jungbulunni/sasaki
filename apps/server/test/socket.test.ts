// 실제 서버를 띄우고 4개의 네트워크 접속(가상 플레이어)이 게임을 끝까지 진행한다.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, Socket } from 'socket.io-client';
import { canBeat, classifyCombo, enumerateCombos } from '../../../packages/game-core/src/index';
import { TIMES } from '../src/room';
import { startServer } from '../src/index';

let server: Awaited<ReturnType<typeof startServer>>;
const url = () => `http://localhost:${server.port}`;

beforeAll(async () => {
  Object.assign(TIMES, { turn: 400, window: 120, autoPass: 120, revealPass: 20, revealSpecial: 30, revealPig: 40, revealEnd: 30, result: 150, countdown: 60 });
  server = await startServer(0);
});
afterAll(async () => { await server.close(); });

const ask = <T>(s: Socket, ev: string, p: unknown) => new Promise<T>((r) => s.emit(ev, p, r));

interface Bot { s: Socket; seat: number; token: string; last: any; leaks: string[]; views: number }

function bot(s: Socket, seat: number, token: string): Bot {
  const b: Bot = { s, seat, token, last: null, leaks: [], views: 0 };
  s.on('view', (v) => {
    b.last = v; b.views++;
    // 받은 데이터에 내 주패·판 위 카드 말고 다른 카드가 있으면 유출
    const own = new Set<string>(v.mine?.hand ?? []);
    const pub = new Set<string>((v.game?.trick ?? []).flatMap((p: any) => p.cards));
    for (const c of v.mine?.window?.cards ?? []) own.add(c);
    const json = JSON.stringify({ ...v, log: [] });
    for (const m of json.matchAll(/"([SHDC](?:1[0-4]|[3-9]))"/g)) if (!own.has(m[1]) && !pub.has(m[1])) b.leaks.push(m[1]);
    react(b, v);
  });
  return b;
}

let seq = 0;
function react(b: Bot, v: any) {
  const m = v.mine;
  const g = v.game;
  if (v.result && !v.result.ended && !v.result.ready.includes(b.seat)) { b.s.emit('ready'); return; }
  if (!m || !g) return;
  const id = `${b.seat}-${++seq}`;
  if (m.window) {
    setTimeout(() => b.s.emit('action', { type: Math.random() < 0.6 ? (m.window.type === 'kkotda' ? 'kkotda' : 'blackPigSubmit') : (m.window.type === 'kkotda' ? 'kkotdaPass' : 'blackPigPass'), id }), 5);
    return;
  }
  if (m.canRun && Math.random() < 0.2) { b.s.emit('action', { type: 'declareRun', id }); return; }
  if (m.canDdook && Math.random() < 0.3) { b.s.emit('action', { type: 'declareDdook', id }); return; }
  if (m.options.length && Math.random() < 0.5) { const o = m.options[0]; b.s.emit('action', { type: o.type, cards: o.cards, id }); return; }
  if (m.myTurn && !m.noPlay) {
    const top = g.trick.length ? classifyCombo(g.trick.at(-1).cards) : null;
    const plays = enumerateCombos(m.hand).filter((c) => canBeat(c, top) && !(['teul', 'sasaki', 'madae', 'bulpig'].includes(c.kind) && c.cards.length === m.hand.length));
    if (g.trick.length && (plays.length === 0 || Math.random() < 0.2)) b.s.emit('action', { type: 'pass', id });
    else if (plays.length) b.s.emit('action', { type: 'play', cards: plays[Math.floor(Math.random() * plays.length)].cards, id });
  }
}

async function openRoom(eggs: number) {
  const sockets = [0, 1, 2, 3].map(() => connect(url(), { transports: ['websocket'], forceNew: true }));
  await Promise.all(sockets.map((s) => new Promise((r) => s.on('connect', r))));
  const c: any = await ask(sockets[0], 'create', { nickname: '방장' });
  const joins: any[] = [c];
  for (let i = 1; i < 4; i++) joins.push(await ask(sockets[i], 'join', { code: c.code, nickname: `친구${i}` }));
  expect(joins.every((j) => j.ok)).toBe(true);
  sockets[0].emit('setEggs', eggs);
  await new Promise((r) => setTimeout(r, 30));
  return { code: c.code as string, sockets, joins };
}

describe('자리 바꾸기 (네트워크)', () => {
  it('자리를 섞어도 각자 화면에는 자기 이름·자기 자리가 그대로 보인다', async () => {
    const { sockets } = await openRoom(5);
    const latest: any[] = [null, null, null, null];
    sockets.forEach((s, i) => s.on('view', (v) => { latest[i] = v; }));
    for (let k = 0; k < 5; k++) { await ask(sockets[0], 'shuffle', null); await new Promise((r) => setTimeout(r, 40)); }
    const names = ['방장', '친구1', '친구2', '친구3'];
    latest.forEach((v, i) => expect(v.seats[v.me].nickname).toBe(names[i]));
    await ask(sockets[0], 'start', null);
    await new Promise((r) => setTimeout(r, 80));
    latest.forEach((v, i) => { expect(v.seats[v.me].nickname).toBe(names[i]); expect(v.mine.hand).toHaveLength(12); });
    sockets.forEach((s) => s.close());
  }, 20_000);
});

describe('사람 2명 + AI 2명', () => {
  it('두 사람이 접속해 AI 둘과 게임을 끝까지 진행, 유출 없음', async () => {
    const sockets = [0, 1].map(() => connect(url(), { transports: ['websocket'], forceNew: true }));
    await Promise.all(sockets.map((s) => new Promise((r) => s.on('connect', r))));
    const c: any = await ask(sockets[0], 'create', { nickname: '방장' });
    const j: any = await ask(sockets[1], 'join', { code: c.code, nickname: '친구' });
    const a1: any = await ask(sockets[0], 'addAi', null);
    const a2: any = await ask(sockets[0], 'addAi', null);
    expect([a1.ok, a2.ok]).toEqual([true, true]);
    sockets[0].emit('setEggs', 4);
    await new Promise((r) => setTimeout(r, 30));
    const bots = [bot(sockets[0], c.seat, c.token), bot(sockets[1], j.seat, j.token)];
    const started: any = await ask(sockets[0], 'start', null);
    expect(started.ok).toBe(true);
    const deadline = Date.now() + 150_000;
    while (Date.now() < deadline && !bots[0].last?.result?.ended) await new Promise((r) => setTimeout(r, 200));
    expect(bots[0].last.result.ended).toBe(true);
    for (const b of bots) expect(b.leaks).toEqual([]);
    console.log(`  사람2+AI2 방 ${c.code}: ${bots[0].last.game.handNo}판, AI 이름 ${bots[0].last.seats.filter((x: any) => x.ai).map((x: any) => x.nickname).join(', ')}`);
    sockets.forEach((s) => s.close());
  }, 160_000);
});

describe('4인 실시간 접속', () => {
  it('네 명이 각자 접속해 게임을 끝까지 진행, 주패 유출 없음', async () => {
    const { code, sockets, joins } = await openRoom(8);
    const bots = sockets.map((s, i) => bot(s, joins[i].seat, joins[i].token));
    const started: any = await ask(sockets[0], 'start', null);
    expect(started.ok).toBe(true);
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline && !bots[0].last?.result?.ended) await new Promise((r) => setTimeout(r, 100));
    expect(bots[0].last.status).toBe('ended');
    expect(bots[0].last.result.standings).toHaveLength(4);
    for (const b of bots) expect(b.leaks, `${b.seat}번 자리 유출`).toEqual([]);
    console.log(`  방 ${code}: ${bots[0].last.game.handNo}판 진행, 화면 갱신 ${bots.reduce((a, b) => a + b.views, 0)}회, 유출 0건`);
    sockets.forEach((s) => s.close());
  }, 100_000);

  it('게임 중 접속이 끊긴 사람은 같은 브라우저 정보로 같은 자리에 돌아온다', async () => {
    const { sockets, joins, code } = await openRoom(10);
    const bots = sockets.map((s, i) => bot(s, joins[i].seat, joins[i].token));
    await ask(sockets[0], 'start', null);
    await new Promise((r) => setTimeout(r, 300));
    const handBefore = bots[2].last.mine.hand.length;
    sockets[2].close();
    await new Promise((r) => setTimeout(r, 100));
    expect(bots[0].last.seats[2].connected).toBe(false);
    // 닉네임만으로는 못 들어옴
    const stranger = connect(url(), { transports: ['websocket'], forceNew: true });
    await new Promise((r) => stranger.on('connect', r));
    const bad: any = await ask(stranger, 'join', { code, nickname: '친구2' });
    expect(bad.ok).toBe(false);
    // 복귀 정보로 돌아옴
    const back: any = await ask(stranger, 'join', { code, nickname: '', token: joins[2].token });
    expect(back).toMatchObject({ ok: true, seat: 2 });
    await new Promise((r) => setTimeout(r, 60));
    expect(bots[0].last.seats[2].connected).toBe(true);
    void handBefore;
    stranger.close();
    sockets.forEach((s) => s.close());
  }, 20_000);
});
