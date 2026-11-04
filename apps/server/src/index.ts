// 실시간 서버: 화면 파일을 내려주고, Socket.IO로 방·행동을 주고받는다.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { makeRoomCode, Room } from './room';

const here = dirname(fileURLToPath(import.meta.url));
const PAGE = [join(here, '../../web/dist/online.html'), join(here, '../web/dist/online.html'), join(process.cwd(), 'apps/web/dist/online.html')].find(existsSync);

export function startServer(port = Number(process.env.PORT) || 3000) {
  const rooms = new Map<string, Room>();
  const http = createServer((req, res) => {
    if (req.url === '/health') { res.writeHead(200).end('ok'); return; }
    if (!PAGE) { res.writeHead(500).end('online.html 이 없습니다. 먼저 npm run build 를 실행하세요.'); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
    res.end(readFileSync(PAGE));
  });
  const io = new Server(http, { pingInterval: 10000, pingTimeout: 8000 });
  const socketsBySeat = new Map<string, string>(); // `${code}:${seat}` → socket.id

  function getRoom(code: string) {
    const c = String(code || '').toUpperCase();
    let room = rooms.get(c);
    return room;
  }

  function createRoom() {
    const code = makeRoomCode((c) => rooms.has(c));
    const room: Room = new Room(code, {
      emit: (seat, event, payload) => {
        const id = socketsBySeat.get(`${code}:${seat}`);
        if (id) io.to(id).emit(event, payload);
      },
      onExpire: () => { room.destroy(); rooms.delete(code); },
    });
    rooms.set(code, room);
    return room;
  }

  io.on('connection', (socket) => {
    let room: Room | null = null;
    let seat = -1;

    const attach = (r: Room, nickname: string, token: string | undefined, ack: (x: unknown) => void) => {
      if (room) return ack({ ok: false, reason: '이미 방에 들어와 있어요' });
      const res = r.join(nickname, token);
      if (!res.ok) return ack(res);
      const old = socketsBySeat.get(`${r.code}:${res.seat}`);
      if (old && old !== socket.id) io.sockets.sockets.get(old)?.disconnect(true); // 같은 자리 다른 창은 끊기
      room = r; seat = res.seat;
      socketsBySeat.set(`${r.code}:${seat}`, socket.id);
      ack({ ok: true, code: r.code, seat, token: res.token });
      r.broadcast();
    };

    socket.on('create', (p: { nickname?: string }, ack) => attach(createRoom(), String(p?.nickname ?? ''), undefined, ack));
    socket.on('join', (p: { code?: string; nickname?: string; token?: string }, ack) => {
      const r = getRoom(String(p?.code ?? ''));
      if (!r) return ack({ ok: false, reason: '방을 찾을 수 없어요. 코드를 확인해 주세요.' });
      attach(r, String(p?.nickname ?? ''), p?.token, ack);
    });
    socket.on('setEggs', (n: number) => room?.setEggs(seat, Number(n)));
    socket.on('addAi', (_: unknown, ack?: (x: unknown) => void) => { const err = room?.addAi(seat); ack?.({ ok: !err, reason: err }); });
    socket.on('removeAi', (target: number) => room?.removeAi(seat, Number(target)));
    socket.on('start', (_: unknown, ack?: (x: unknown) => void) => { const err = room?.start(seat); ack?.({ ok: !err, reason: err }); });
    socket.on('action', (a: { type: string; cards?: string[]; id?: string }) => room?.submit(seat, a));
    socket.on('select', (cards: string[]) => room?.select(seat, cards));
    socket.on('ready', () => room?.readyNext(seat));
    socket.on('rematch', () => room?.rematch(seat));
    socket.on('disconnect', () => {
      if (!room) return;
      const key = `${room.code}:${seat}`;
      if (socketsBySeat.get(key) === socket.id) { socketsBySeat.delete(key); room.disconnect(seat); }
    });
  });

  return new Promise<{ port: number; close: () => Promise<void>; rooms: Map<string, Room> }>((resolve) => {
    http.listen(port, () => {
      const addr = http.address();
      const p = typeof addr === 'object' && addr ? addr.port : port;
      resolve({ port: p, rooms, close: () => new Promise((r) => { for (const rm of rooms.values()) rm.destroy(); io.close(() => r()); }) });
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startServer().then(({ port }) => console.log(`사사끼 서버 실행 중: http://localhost:${port}`));
}
