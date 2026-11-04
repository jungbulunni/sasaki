// 게임방 하나: 좌석, 타이머, 서버 권위 판정, 플레이어별 화면 정보.
// 판정은 모두 game-core가 하고, 이 파일은 "언제·누구에게 무엇을 보여줄지"만 다룬다.

import { createHash, randomBytes } from 'node:crypto';
import {
  aiDecide, aiDelay, aiView, AI_NAMES, applyHandBatch, AUTO_PASS_MS, CardId, classifyCombo, createMatch, finalStandings, finishHand, HandAction,
  HandEvent, HandOutcome, HandState, hasNoPlay, MatchState, Play, seededRng, sortHand, specialOptions, startHand,
  teamOf, timeoutAction, Rng,
} from '../../../packages/game-core/src/index';

export const TIMES = {
  turn: 8000,          // 자기 차례
  window: 5000,        // 달리기·뚝·꽂다·흑돼지
  autoPass: AUTO_PASS_MS, // 낼 패 없음 → 자동 패스
  revealPass: 1000,    // 모두 패스해서 판 정리
  revealSpecial: 2000, // 찼다·꽂다 후 판 정리
  revealPig: 3000,     // 불돼지·흑돼지 후 판 정리
  revealEnd: 2000,     // 판 끝난 직후 마지막 카드
  result: 10000,       // 결과 화면 후 자동으로 다음 판 카운트다운 시작
  countdown: 3000,     // 3-2-1
  emptyRoom: 3600_000, // 모두 나간 뒤 방 보존 1시간
};

const CLIENT_ACTIONS = new Set(['play', 'pass', 'chatda', 'mureugi', 'kkotda', 'kkotdaPass', 'blackPigSubmit', 'blackPigPass', 'declareRun', 'declareDdook']);

type DeadlineKind = 'turn' | 'autopass' | 'window' | 'run' | 'ddook' | 'reveal' | 'next';
interface Deadline { kind: DeadlineKind; key: string; at: number; total: number }

interface SeatInfo {
  nickname: string;
  tokenHash: string;
  connected: boolean;
  selection: CardId[];
  recentActionIds: string[];
  /** 처음부터 AI인 자리 */
  ai: boolean;
  /** 자리가 바뀌어도 변하지 않는 사람 고유 번호 (연결 관리용) */
  pid: string;
}

export type PublicEvent = Exclude<HandEvent, { type: 'returned' } | { type: 'trickCleared' }>
  | { type: 'trickCleared'; leader: number }
  | { type: 'handStart'; handNo: number; leader: number; careSeat: number | null }
  | { type: 'joined'; seat: number } | { type: 'left'; seat: number } | { type: 'back'; seat: number }
  | { type: 'shuffleRequested'; seat: number } | { type: 'seatsShuffled' };

export interface RoomCallbacks {
  emit(seat: number, event: 'view' | 'notice', payload: unknown): void;
  onExpire(): void;
}

const hash = (t: string) => createHash('sha256').update(t).digest('hex');

export function kstHour(now = Date.now()): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hourCycle: 'h23' }).format(new Date(now))) % 24;
}

export class Room {
  seats: (SeatInfo | null)[] = [null, null, null, null];
  status: 'lobby' | 'playing' | 'ended' = 'lobby';
  host = 0;
  startEggs = 10;
  match: MatchState | null = null;
  hand: HandState | null = null;
  lastHand: HandState | null = null;
  outcome: HandOutcome | null = null;
  handRev = 0;
  reveal: { plays: Play[]; until: number } | null = null;
  deadline: Deadline | null = null;
  nextAt = 0;
  ready = new Set<number>();
  pigRevealed = false;
  log: { n: number; ev: PublicEvent }[] = [];
  private logN = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private expiry: ReturnType<typeof setTimeout> | null = null;
  private pausedAt: number | null = null;
  private queue: { seat: number; action: HandAction }[] = [];
  private flushScheduled = false;
  private rng: Rng;
  private aiTimers = new Map<number, ReturnType<typeof setTimeout>>();

  constructor(public code: string, private cb: RoomCallbacks, seed = randomBytes(4).readUInt32LE()) {
    this.rng = seededRng(seed);
  }

  // ───────── 입장 · 퇴장 ─────────

  /** 새로 들어오기 또는 같은 브라우저의 복귀 정보(token)로 자리 되찾기 */
  join(nickname: string, token?: string): { ok: true; seat: number; token: string; pid: string } | { ok: false; reason: string } {
    if (token) {
      const s = this.seats.findIndex((x) => x?.tokenHash === hash(token));
      if (s >= 0) {
        const seat = this.seats[s]!;
        const wasAway = !seat.connected;
        seat.connected = true;
        if (wasAway && this.status === 'playing') this.pushLog({ type: 'back', seat: s });
        this.resumeIfPaused();
        this.scheduleAi(); // 복귀 즉시 조작권은 사람에게: 대기 중이던 AI 행동 취소
        this.broadcast();
        return { ok: true, seat: s, token, pid: seat.pid };
      }
    }
    if (this.status !== 'lobby') return { ok: false, reason: '이미 시작한 게임입니다. 같은 브라우저에서만 다시 들어올 수 있어요.' };
    const name = nickname.trim().slice(0, 8);
    if (!name) return { ok: false, reason: '닉네임을 입력해 주세요' };
    if (this.seats.some((x) => x?.nickname === name)) return { ok: false, reason: '같은 닉네임이 이미 있어요' };
    const free = this.seats.findIndex((x) => x === null);
    if (free < 0) return { ok: false, reason: '방이 가득 찼어요 (4명)' };
    const t = randomBytes(16).toString('hex');
    const pid = randomBytes(8).toString('hex');
    this.seats[free] = { nickname: name, tokenHash: hash(t), connected: true, selection: [], recentActionIds: [], ai: false, pid };
    if (this.humans().length === 1) this.host = free;
    this.clearExpiry();
    this.broadcast();
    return { ok: true, seat: free, token: t, pid };
  }

  disconnect(seat: number) {
    const s = this.seats[seat];
    if (!s) return;
    if (this.status === 'lobby') {
      this.seats[seat] = null;
      if (this.host === seat) this.host = this.humans()[0] ?? 0;
    } else {
      s.connected = false;
      if (this.status === 'playing') this.pushLog({ type: 'left', seat });
    }
    if (!this.seats.some((x) => x?.connected && !x.ai)) this.pauseAll();
    else this.scheduleAi(); // 나간 사람 자리는 AI가 대신
    this.broadcast();
  }

  /** 모두 나가면 게임 일시정지, 1시간 뒤 방 폐기 */
  private pauseAll() {
    if (this.status === 'playing' && this.pausedAt === null) {
      this.pausedAt = Date.now();
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.clearAiTimers();
    }
    this.clearExpiry();
    this.expiry = setTimeout(() => this.cb.onExpire(), TIMES.emptyRoom);
  }

  private resumeIfPaused() {
    this.clearExpiry();
    if (this.pausedAt === null) return;
    const shift = Date.now() - this.pausedAt;
    this.pausedAt = null;
    if (this.deadline) this.deadline.at += shift; // 남은 시간 그대로 유지
    if (this.reveal) this.reveal.until += shift;
    if (this.nextAt) this.nextAt += shift;
    this.arm();
    this.scheduleAi();
  }

  private clearExpiry() {
    if (this.expiry) clearTimeout(this.expiry);
    this.expiry = null;
  }

  destroy() {
    this.clearAiTimers();
    if (this.timer) clearTimeout(this.timer);
    this.clearExpiry();
  }

  // ───────── 시작 ─────────

  seatOfPid(pid: string): number {
    return this.seats.findIndex((x) => x?.pid === pid);
  }

  shufflePending = false;

  /**
   * 자리 바꾸기: 앉는 순서(차례 순서)를 무작위로 섞는다.
   *  - 대기실: 방장이 누르면 바로 섞음
   *  - 판 결과 화면: 누구나 누를 수 있고, 다음 판 시작 때 섞임 (한 번만)
   */
  shuffleSeats(seat: number): string | null {
    if (!this.seats[seat] || this.seats[seat]!.ai) return '자리를 바꿀 수 없어요';
    if (this.status === 'lobby') {
      if (seat !== this.host) return '대기실에서는 방장만 자리를 섞을 수 있어요';
      this.permuteSeats();
      this.broadcast();
      return null;
    }
    if (!this.outcome || this.match?.status !== 'playing') return '판 결과 화면에서만 자리를 바꿀 수 있어요';
    if (this.shufflePending) return null;
    this.shufflePending = true;
    this.pushLog({ type: 'shuffleRequested', seat });
    this.broadcast();
    return null;
  }

  /** 자리를 무작위로 섞고, 자리 번호로 기록된 정보(알, 선, 배려판 대상, 방장)도 함께 옮긴다 */
  private permuteSeats() {
    const order = [0, 1, 2, 3];
    for (let i = 3; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    // order[새 자리] = 원래 자리
    const newOf = (old: number) => order.indexOf(old);
    this.seats = order.map((o) => this.seats[o]);
    this.host = newOf(this.host);
    if (this.match) {
      this.match.players = order.map((o) => this.match!.players[o]);
      if (this.match.careSeat !== null) this.match.careSeat = newOf(this.match.careSeat);
      if (this.match.lastWinner !== null) this.match.lastWinner = newOf(this.match.lastWinner);
    }
    this.ready.clear();
    this.log = [];
    this.pushLog({ type: 'seatsShuffled' });
  }

  private humans() {
    return [0, 1, 2, 3].filter((i) => this.seats[i] && !this.seats[i]!.ai);
  }

  /** 대기실: 빈 자리에 AI 넣기 (방장만) */
  addAi(seat: number): string | null {
    if (seat !== this.host || this.status !== 'lobby') return '방장만 AI를 넣을 수 있어요';
    const free = this.seats.findIndex((x) => x === null);
    if (free < 0) return '빈 자리가 없어요';
    const used = new Set(this.seats.map((x) => x?.nickname));
    const names = AI_NAMES.filter((n) => !used.has(n));
    const name = names[Math.floor(this.rng() * names.length)] ?? `AI${free + 1}`;
    this.seats[free] = { nickname: name, tokenHash: '', connected: true, selection: [], recentActionIds: [], ai: true, pid: randomBytes(8).toString('hex') };
    this.broadcast();
    return null;
  }

  removeAi(seat: number, target: number) {
    if (seat !== this.host || this.status !== 'lobby' || !this.seats[target]?.ai) return;
    this.seats[target] = null;
    this.broadcast();
  }

  /** AI가 조작하는 자리: AI 자리 또는 게임 중 접속이 끊긴 사람 자리 */
  private controlled(i: number) {
    const s = this.seats[i];
    return !!s && (s.ai || (this.status === 'playing' && !s.connected));
  }

  private clearAiTimers() {
    for (const t of this.aiTimers.values()) clearTimeout(t);
    this.aiTimers.clear();
  }

  /** 상태가 바뀔 때마다 AI 자리의 다음 행동을 사람 같은 반응 시간 뒤로 예약 */
  private scheduleAi() {
    this.clearAiTimers();
    if (!this.hand || this.reveal || this.outcome || this.pausedAt !== null || this.status !== 'playing') return;
    const rev = this.handRev;
    for (let i = 0; i < 4; i++) {
      if (!this.controlled(i)) continue;
      const a = aiDecide(aiView(this.hand, i), this.rng);
      if (!a) continue;
      this.aiTimers.set(i, setTimeout(() => {
        this.aiTimers.delete(i);
        if (this.handRev !== rev || !this.controlled(i)) return; // 그 사이 상황이 바뀌었으면 취소
        this.submit(i, a as { type: string; cards?: CardId[] });
      }, aiDelay(a, this.rng)));
    }
  }

  /** 게임이 끝난 뒤 같은 사람들로 대기실로 돌아가기 */
  rematch(seat: number) {
    if (seat !== this.host || this.status !== 'ended') return;
    this.status = 'lobby';
    this.match = null; this.hand = null; this.lastHand = null; this.outcome = null;
    this.reveal = null; this.deadline = null; this.nextAt = 0; this.log = [];
    this.seats = this.seats.map((x) => (x && x.connected ? x : null));
    if (!this.seats[this.host] || this.seats[this.host]!.ai) this.host = this.humans()[0] ?? 0;
    this.broadcast();
  }

  setEggs(seat: number, eggs: number) {
    if (seat !== this.host || this.status !== 'lobby') return;
    if (Number.isInteger(eggs) && eggs >= 1 && eggs <= 999) this.startEggs = eggs;
    this.broadcast();
  }

  start(seat: number): string | null {
    if (seat !== this.host) return '방장만 시작할 수 있어요';
    if (this.status !== 'lobby') return '이미 시작했어요';
    if (this.seats.some((x) => !x)) return '4명이 모여야 시작할 수 있어요';
    this.match = createMatch(this.seats.map((x) => x!.nickname), this.startEggs);
    this.status = 'playing';
    this.beginHand();
    return null;
  }

  private beginHand() {
    if (this.shufflePending) { this.shufflePending = false; this.permuteSeats(); }
    const s = startHand(this.match!, this.rng, kstHour());
    this.match = s.match;
    this.hand = s.hand;
    this.lastHand = null;
    this.outcome = null;
    this.reveal = null;
    this.nextAt = 0;
    this.ready.clear();
    this.pigRevealed = false;
    this.seats.forEach((x) => x && (x.selection = []));
    this.pushLog({ type: 'handStart', handNo: this.match.handNo, leader: this.hand.leaderSeat, careSeat: this.match.careSeat });
    this.changed();
  }

  // ───────── 행동 ─────────

  /** 클라이언트 행동은 같은 처리 단위로 모아서(무르기 우선) 처리 */
  submit(seat: number, action: { type: string; cards?: CardId[]; id?: string }) {
    const s = this.seats[seat];
    if (!s || this.status !== 'playing' || !this.hand) return;
    if (!CLIENT_ACTIONS.has(action.type)) return;
    if (action.id) {
      if (s.recentActionIds.includes(action.id)) return; // 중복 제출 무시
      s.recentActionIds = [...s.recentActionIds.slice(-30), action.id];
    }
    const a = { ...action, seat } as HandAction;
    delete (a as { id?: string }).id;
    this.queue.push({ seat, action: a });
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      setImmediate(() => this.flush());
    }
  }

  select(seat: number, cards: CardId[]) {
    const s = this.seats[seat];
    if (s && Array.isArray(cards)) s.selection = cards.filter((c) => typeof c === 'string').slice(0, 12);
  }

  readyNext(seat: number) {
    if (!this.outcome || this.reveal || this.match?.status !== 'playing') return;
    this.ready.add(seat);
    const humans = [0, 1, 2, 3].filter((i) => this.seats[i]?.connected && !this.seats[i]!.ai);
    if (humans.every((i) => this.ready.has(i))) this.nextAt = Math.min(this.nextAt, Date.now() + TIMES.countdown);
    this.arm();
    this.broadcast();
  }

  private flush() {
    this.flushScheduled = false;
    const batch = this.queue;
    this.queue = [];
    if (!this.hand || this.hand.phase === 'hand-over') return;
    if (this.reveal) {
      for (const b of batch) this.cb.emit(b.seat, 'notice', '카드를 정리하는 중이에요');
      return;
    }
    this.applyBatch(batch.map((b) => b.action), batch);
  }

  private applyBatch(actions: HandAction[], from?: { seat: number }[]) {
    const r = applyHandBatch(this.hand!, actions);
    r.rejected.forEach((x) => {
      const seat = (x.action as { seat?: number }).seat;
      if (seat !== undefined && from) this.cb.emit(seat, 'notice', x.reason);
    });
    if (r.rejected.length === actions.length) return;
    this.hand = r.state;
    this.handleEvents(r.events);
    this.changed();
  }

  private handleEvents(events: HandEvent[]) {
    for (const e of events) {
      if (e.type === 'returned') continue;
      if (e.type === 'pig' || (e.type === 'run' && this.hand!.teamMode === 'pig-1v3')) this.pigRevealed = true;
      if (e.type === 'trickCleared') {
        const vias = e.cleared.map((p) => p.via);
        const pig = e.cleared.some((p) => p.combo.kind === 'bulpig' || p.via === 'blackpig');
        const special = vias.some((v) => v === 'chatda' || v === 'mureugi' || v === 'kkotda');
        const dur = pig ? TIMES.revealPig : special ? TIMES.revealSpecial : TIMES.revealPass;
        this.reveal = { plays: e.cleared, until: Date.now() + dur };
        this.pushLog({ type: 'trickCleared', leader: e.leader });
        continue;
      }
      this.pushLog(e as PublicEvent);
    }
    if (this.hand!.phase === 'hand-over' && !this.outcome) {
      this.lastHand = this.hand;
      const f = finishHand(this.match!, this.hand!);
      this.match = f.match;
      this.outcome = f.outcome;
      const pig = this.hand!.trick.some((p) => p.combo.kind === 'bulpig' || p.via === 'blackpig');
      this.reveal = { plays: this.hand!.trick, until: Date.now() + (pig ? TIMES.revealPig : TIMES.revealEnd) };
      if (this.match.status === 'ended') this.status = 'ended';
    }
  }

  private pushLog(ev: PublicEvent) {
    this.log.push({ n: ++this.logN, ev });
    if (this.log.length > 80) this.log.shift();
  }

  // ───────── 타이머 ─────────

  private changed() {
    this.handRev++;
    this.arm();
    this.scheduleAi();
    this.broadcast();
  }

  private want(): { kind: DeadlineKind; key: string; total: number; fire: () => void } | null {
    const h = this.hand;
    if (!h) return null;
    if (this.reveal) {
      return { kind: 'reveal', key: `reveal:${this.handRev}`, total: this.reveal.until - Date.now(), fire: () => { this.reveal = null; this.changed(); } };
    }
    if (this.outcome) {
      if (this.match!.status !== 'playing') return null;
      if (!this.nextAt) this.nextAt = Date.now() + TIMES.result + TIMES.countdown;
      return { kind: 'next', key: `next:${this.nextAt}`, total: this.nextAt - Date.now(), fire: () => this.beginHand() };
    }
    const timeoutWin = () => this.applyBatch([{ type: 'windowTimeout' }]);
    if (h.phase === 'run-declare') return { kind: 'run', key: `run:${this.handRev}`, total: TIMES.window, fire: timeoutWin };
    if (h.phase === 'ddook-declare') return { kind: 'ddook', key: `ddook:${this.handRev}`, total: TIMES.window, fire: timeoutWin };
    if (h.window) return { kind: 'window', key: `window:${this.handRev}`, total: TIMES.window, fire: timeoutWin };
    if (h.phase === 'turn') {
      const seat = h.activeSeat;
      if (hasNoPlay(h)) return { kind: 'autopass', key: `autopass:${this.handRev}`, total: TIMES.autoPass, fire: () => this.applyBatch([{ type: 'pass', seat }]) };
      return {
        kind: 'turn', key: `turn:${this.handRev}`, total: TIMES.turn,
        fire: () => this.applyBatch([timeoutAction(this.hand!, seat, this.seats[seat]?.selection ?? [])]),
      };
    }
    return null;
  }

  /** 지금 상황에 맞는 마감 시각을 정한다. 같은 상황이면 기존 마감 시각을 유지(재접속해도 시간이 늘지 않음). */
  private arm() {
    if (this.pausedAt !== null) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const w = this.want();
    if (!w) { this.deadline = null; return; }
    if (this.deadline?.key !== w.key) {
      const at = w.kind === 'reveal' ? this.reveal!.until : w.kind === 'next' ? this.nextAt : Date.now() + w.total;
      this.deadline = { kind: w.kind, key: w.key, at, total: w.kind === 'next' ? TIMES.countdown : w.total };
    }
    const ms = Math.max(0, this.deadline!.at - Date.now());
    this.timer = setTimeout(() => { this.timer = null; this.deadline = null; w.fire(); }, ms);
  }

  // ───────── 화면 정보 (플레이어별) ─────────

  broadcast() {
    this.seats.forEach((s, i) => { if (s?.connected && !s.ai) this.cb.emit(i, 'view', this.view(i)); });
  }

  view(me: number) {
    const h = this.hand;
    const m = this.match;
    const now = Date.now();
    const seats = this.seats.map((s, i) => {
      // 누가 AI인지는 대기실에서만 알려준다 (게임 중에는 사람과 구분되지 않게)
      const base = { nickname: s?.nickname ?? null, connected: !!s?.connected, ai: this.status === 'lobby' ? !!s?.ai : undefined };
      if (!h || !m) return base;
      const revealed = h.revealedFire.includes(i);
      return {
        ...base,
        eggs: m.players[i].eggs,
        cardCount: h.hands[i].length,
        rank: h.finished.includes(i) ? h.finished.indexOf(i) + 1 : null,
        fire: revealed ? (h.teamMode === 'pig-1v3' && this.pigRevealed ? 'pig' : 'fire') : null,
        runner: h.runner === i,
        ddooker: h.ddooker === i,
        passed: h.phase === 'turn' && h.passed.includes(i),
      };
    });

    let game: unknown = null;
    let mine: unknown = null;
    let result: unknown = null;
    if (h && m) {
      const shownTrick = (this.reveal?.plays ?? h.trick).map((p) => ({ seat: p.seat, cards: p.combo.cards, kind: p.combo.kind, via: p.via }));
      const busy = !!this.reveal || !!this.outcome;
      const d = this.deadline;
      const isWindowMine = h.window?.seat === me;
      game = {
        handNo: m.handNo,
        multiplier: h.multiplier,
        buried: m.buried,
        careSeat: this.outcome ? null : m.careSeat,
        phase: this.outcome ? 'hand-over' : this.reveal ? 'reveal' : h.window ? 'waiting' : h.phase,
        activeSeat: !busy && h.phase === 'turn' ? h.activeSeat : null,
        leaderSeat: h.leaderSeat,
        runnerSeat: h.runner,
        trick: shownTrick,
        revealLeader: this.reveal && !this.outcome ? h.leaderSeat : null,
        // 꽂다·흑돼지 창: 누가 고민 중인지는 숨기고 기다리는 시간만 공개
        deadline: d
          ? { kind: d.kind === 'autopass' ? (h.activeSeat === me ? 'autopass' : 'turn') : d.kind, at: d.at, total: d.total, seat: d.kind === 'turn' || d.kind === 'autopass' ? h.activeSeat : null }
          : null,
      };
      const hand = sortHand(h.hands[me]);
      mine = {
        hand,
        selection: this.seats[me]?.selection ?? [],
        myTurn: !busy && h.phase === 'turn' && h.activeSeat === me,
        options: busy ? [] : specialOptions(h, me),
        noPlay: !busy && h.phase === 'turn' && h.activeSeat === me && hasNoPlay(h),
        canRun: !busy && h.phase === 'run-declare' && h.fireOwners.includes(me),
        canDdook: !busy && h.phase === 'ddook-declare' && teamOf(h, me) !== teamOf(h, h.runner!),
        window: !busy && isWindowMine ? { type: h.window!.type, cards: h.window!.type === 'kkotda' ? h.window!.cards : ['S10', 'C10'] } : null,
        team: teamOf(h, me),
      };
      if (this.outcome && this.lastHand && !this.reveal) {
        const lh = this.lastHand;
        const s = this.outcome.settlement;
        result = {
          kind: s.kind,
          winnerTeam: s.kind === 'win-2v2' ? teamOf(lh, lh.ranks![0]) : null,
          earlyEnd: lh.earlyEnd,
          decided: lh.finished.length,
          ranks: lh.ranks,
          teams: [0, 1, 2, 3].map((i) => teamOf(lh, i)),
          deltas: s.deltas,
          eggs: m.players.map((p) => p.eggs),
          multiplier: lh.multiplier,
          buried: m.buried,
          careSurvived: this.outcome.careSurvived,
          nextCare: m.careSeat,
          ended: m.status === 'ended',
          endReason: m.endReason,
          eliminated: m.eliminated,
          standings: m.status === 'ended' ? finalStandings(m) : null,
          ready: [...this.ready],
          nextAt: this.nextAt,
          shufflePending: this.shufflePending,
        };
      }
    }
    return {
      code: this.code, status: this.status, host: this.host, startEggs: this.startEggs, me, serverNow: now,
      seats, game, mine, result, log: this.log.slice(-40),
    };
  }
}

export function makeRoomCode(exists: (c: string) => boolean): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) {
    const c = Array.from({ length: 4 }, () => A[randomBytes(1)[0] % A.length]).join('');
    if (!exists(c)) return c;
  }
}

export { classifyCombo };
