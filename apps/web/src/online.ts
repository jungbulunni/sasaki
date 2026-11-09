// M3 온라인 화면: 서버가 보내준 "내 화면 정보"만 그린다. 판정은 전부 서버가 한다.
import { canBeat, CardId, classifyCombo, COMBO_NAME, isFire, rankOf, suitOf } from '../../../packages/game-core/src/index';
import { eggSvg, pigBodySvg, pigFaceSvg } from './pig';

declare const io: (opts?: unknown) => Sock;
interface Sock {
  on(ev: string, fn: (...a: any[]) => void): void;
  emit(ev: string, ...a: any[]): void;
  connected: boolean;
}

// ───── 서버가 보내는 화면 정보 (room.ts view()) ─────
interface SeatV { nickname: string | null; connected: boolean; ai?: boolean; eggs?: number; cardCount?: number; rank?: number | null; fire?: 'fire' | 'pig' | null; runner?: boolean; ddooker?: boolean; passed?: boolean }
interface PlayV { seat: number; cards: CardId[]; kind: string; via: string }
interface DeadlineV { kind: string; at: number; total: number; seat: number | null }
interface RunShowV { id: number; start: number; runner: number; partner: number | null; runnerCards: CardId[]; partnerCard: CardId | null }
interface GameV { runShow?: RunShowV | null; handNo: number; multiplier: number; buried: number; careSeat: number | null; phase: string; activeSeat: number | null; leaderSeat: number; runnerSeat: number | null; trick: PlayV[]; revealLeader: number | null; deadline: DeadlineV | null }
interface MineV { hand: CardId[]; selection: CardId[]; myTurn: boolean; options: { type: 'chatda' | 'mureugi'; cards: CardId[] }[]; noPlay: boolean; canRun: boolean; canDdook: boolean; window: { type: 'kkotda' | 'blackpig'; cards: CardId[] } | null; team: string }
interface ResultV { kind: string; winnerTeam: string | null; earlyEnd: boolean; decided: number; ranks: number[]; teams: string[]; deltas: number[]; eggs: number[]; multiplier: number; buried: number; careSurvived: boolean | null; nextCare: number | null; ended: boolean; endReason: string | null; eliminated: number[]; standings: { seat: number; nickname: string; eggs: number; place: number }[] | null; ready: number[]; nextAt: number; shufflePending: boolean }
interface View { code: string; status: 'lobby' | 'playing' | 'ended'; host: number; startEggs: number; me: number; serverNow: number; seats: SeatV[]; game: GameV | null; mine: MineV | null; result: ResultV | null; log: { n: number; ev: any }[] }

const app = document.getElementById('app')!;
const shoutEl = document.getElementById('shout')!;
const socket = io({ transports: ['websocket', 'polling'] });

let view: View | null = null;
let offset = 0; // 서버 시각 - 내 시각
let selected = new Set<CardId>();
let lastLogN = -1;
let toastMsg = '';
let toastTimer = 0;
let joining = false;
let leaveArmed = false; // 나가기는 한 번 더 눌러야 실행
// 진행 기록: 넓은 화면은 펼치고, 휴대폰은 접어 둠 (사용자가 바꾸면 그대로 유지)
let logOpen = window.matchMedia('(min-width: 861px)').matches;
document.addEventListener('toggle', (e) => { if ((e.target as HTMLElement).id === 'logBox') logOpen = (e.target as HTMLDetailsElement).open; }, true);
const params = new URLSearchParams(location.search);
let roomCode = (params.get('room') || '').toUpperCase();
const now = () => Date.now() + offset;

const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* 무시 */ } },
};
let nickname = store.get('sasaki:nick') || '';

// ───── 연결 ─────

socket.on('connect', () => {
  const token = roomCode ? store.get(`sasaki:token:${roomCode}`) : null;
  if (roomCode && token) join(roomCode, nickname, token);
  else render();
});
socket.on('disconnect', () => { toast('연결이 끊겼어요. 다시 연결하는 중…'); });
socket.on('view', (v: View) => {
  offset = v.serverNow - Date.now();
  const first = lastLogN < 0;
  if (first) lastLogN = v.log.at(-1)?.n ?? 0;
  else for (const l of v.log) if (l.n > lastLogN) { onEvent(l.ev, v); lastLogN = l.n; }
  stateSounds(view, v);
  view = v;
  if (v.mine) for (const c of [...selected]) if (!v.mine.hand.includes(c)) selected.delete(c);
  render();
});
socket.on('notice', (m: string) => toast(m));

function join(code: string, nick: string, token?: string | null) {
  if (joining) return;
  joining = true;
  socket.emit('join', { code, nickname: nick, token }, (r: any) => {
    joining = false;
    if (!r.ok) {
      if (token) store.set(`sasaki:token:${code}`, '');
      toast(r.reason);
      render();
      return;
    }
    entered(r);
  });
}
function entered(r: { code: string; token: string }) {
  roomCode = r.code;
  store.set(`sasaki:token:${r.code}`, r.token);
  history.replaceState(null, '', `?room=${r.code}`);
}

// ───── 이벤트 → 외침 · 기록 ─────

const nm = (s: number) => view?.seats[s]?.nickname ?? `${s + 1}번`;
const VIA: Record<string, string> = { play: '', chatda: '찼다!', mureugi: '찼다!', kkotda: '꽂다!', blackpig: '흑돼지!' };

function logText(ev: any, v: View | null = view): string | null {
  const n = (s: number) => v?.seats[s]?.nickname ?? `${s + 1}번`;
  switch (ev.type) {
    case 'handStart': return `── ${ev.handNo}판 시작 · 선 ${n(ev.leader)}${ev.careSeat !== null ? ` · ${n(ev.careSeat)} 배려판` : ''} ──`;
    case 'played': {
      const c = classifyCombo(ev.cards);
      const kind = ev.via === 'blackpig' ? '흑돼지' : c ? COMBO_NAME[c.kind] : '';
      return `${n(ev.seat)} ${VIA[ev.via] ? VIA[ev.via] + ' ' : ''}${ev.cards.map(label).join(' ')} · ${kind}`;
    }
    case 'passed': return `${n(ev.seat)} 통과`;
    case 'fireAlarm': return `불이야! ${n(ev.seat)}의 불 공개`;
    case 'pig': return `돼지! ${n(ev.seat)}가 불돼지`;
    case 'noKkot': return '안 꽂아!';
    case 'finished': return `${n(ev.seat)} ${ev.rank}등 완주`;
    case 'finishCanceled': return `${n(ev.seat)} 완주 취소`;
    case 'run': return `${n(ev.seat)} 달리기! 배수 ×2`;
    case 'ddook': return `${n(ev.seat)} 뚝! 배수 ×4`;
    case 'trickCleared': return `${n(ev.leader)} 선`;
    case 'handOver': return ev.early ? '결과가 정해져 판 종료' : '판 종료';
    case 'left': return `${n(ev.seat)} 연결 끊김 · AI가 대신 플레이`;
    case 'back': return `${n(ev.seat)} 돌아옴`;
    case 'shuffleRequested': return `${n(ev.seat)}가 자리 바꾸기를 눌렀어요 · 다음 판부터 자리가 바뀌어요`;
    case 'seatsShuffled': return '── 자리를 새로 섞었어요 ──';
    case 'leftGame': return `${n(ev.seat)} 나감 · 이제 AI가 대신해요`;
  }
  return null;
}

let pendingPops: number[] = [];
// ───── 카드가 낸 사람 자리에서 가운데 더미로 날아가는 효과 ─────
const FLY_MS = 380;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let pendingFlights: { seat: number; key: string }[] = [];
let flying: { key: string; until: number } | null = null;
const playKey = (seat: number, cards: CardId[]) => `${seat}:${cards.join(',')}`;

function flushFlights() {
  const list = pendingFlights;
  pendingFlights = [];
  const f = list.at(-1); // 한 번에 여러 장이 왔으면 마지막 것만 날린다
  if (!f || reduceMotion) return;
  const dest = document.querySelector<HTMLElement>(`.play.last[data-key="${CSS.escape(f.key)}"] .pcards`);
  const from = f.seat === view?.me ? document.querySelector<HTMLElement>('.hand') : document.querySelector<HTMLElement>(`.seat[data-seat="${f.seat}"]`);
  if (!dest || !from) return;
  const d = dest.getBoundingClientRect();
  const s0 = from.getBoundingClientRect();
  if (!d.width) return;
  const clone = dest.cloneNode(true) as HTMLElement;
  // 원래 카드 크기를 그대로 옮겨 적는다 (가운데 더미 밖에서도 같은 크기로 보이게)
  const srcCards = dest.querySelectorAll<HTMLElement>('.card');
  clone.querySelectorAll<HTMLElement>('.card').forEach((c, i) => {
    const r = srcCards[i].getBoundingClientRect();
    c.style.width = `${r.width}px`; c.style.height = `${r.height}px`;
    c.style.setProperty('--w', `${r.width}px`);
    c.style.marginLeft = getComputedStyle(srcCards[i]).marginLeft; // 겹쳐 펼친 간격도 그대로
  });
  clone.style.gap = '0';
  clone.className = 'pcards flyer';
  clone.style.left = `${d.left}px`; clone.style.top = `${d.top}px`; clone.style.width = `${d.width}px`;
  document.body.appendChild(clone);
  const dx = s0.left + s0.width / 2 - (d.left + d.width / 2);
  const dy = s0.top + s0.height / 2 - (d.top + d.height / 2);
  flying = { key: f.key, until: Date.now() + FLY_MS };
  dest.closest('.play')?.classList.add('incoming');
  const anim = clone.animate([
    { transform: `translate(${dx}px, ${dy}px) scale(.55) rotate(-8deg)`, opacity: 0.6 },
    { transform: 'translate(0, 0) scale(1.08) rotate(2deg)', opacity: 1, offset: 0.8 },
    { transform: 'translate(0, 0) scale(1) rotate(0)', opacity: 1 },
  ], { duration: FLY_MS, easing: 'cubic-bezier(.2,.7,.3,1)' });
  anim.onfinish = anim.oncancel = () => { clone.remove(); flying = null; document.querySelectorAll('.play.incoming').forEach((e) => e.classList.remove('incoming')); };
}

// 기록에 새로 올라온 일마다 나는 소리
const COMBO_VOICE: Record<string, SoundName> = { teul: 'voice-06-1-tteul', madae: 'voice-06-2-madae', ssangka: 'voice-06-3-ssangka', sasaki: 'voice-06-4-sasaki' };
let dealUntil = 0; // 카드 나눠주는 소리가 끝나는 시각 ('달릴 사람 있나요?'를 그 뒤로)
function eventSound(ev: any) {
  switch (ev.type) {
    case 'handStart': {
      const first = ev.handNo === 1;
      if (first) play('sfx-01-start');
      play('sfx-02-deal', first ? 1300 : 0, 2000);
      dealUntil = Date.now() + (first ? 3400 : 2100);
      soundCursor = dealUntil;
      return;
    }
    case 'played': {
      play('sfx-05-play-card');
      if (ev.via === 'chatda' || ev.via === 'mureugi') return queue('voice-10-chatda');
      if (ev.via === 'kkotda') return queue('voice-11-kkotda');
      if (ev.via === 'blackpig') return; // 흑돼지 웃음은 blackPig에서
      const c = classifyCombo(ev.cards);
      if (c && COMBO_VOICE[c.kind]) queue(COMBO_VOICE[c.kind]);
      return;
    }
    case 'passed': return queue('voice-07-pass');
    case 'fireAlarm': return queue('voice-15-buriya');
    case 'pig': return queue('sfx-13-pig');
    case 'blackPig': return queue('sfx-14-black-pig');
    case 'noKkot': return queue('voice-12-an-kkoja');
    case 'finished': return queue('sfx-19-finish');
    case 'run': return queue('voice-17-run');
    case 'ddook': return queue('voice-18-ttuk');
    case 'trickCleared': return queue('sfx-09-clear-pile');
    case 'leftGame': return queue('sfx-26-join-leave');
  }
}

// 이전 화면 정보와 비교해서 나는 소리 (내 차례 · 달릴 사람? · 결과 · 대기실 입장/퇴장)
function stateSounds(prev: View | null, v: View) {
  if (!prev || prev.code !== v.code) return;
  const people = (x: View) => x.seats.filter((s) => s.nickname).length;
  if (v.status === 'lobby' && prev.status === 'lobby' && people(v) !== people(prev)) play('sfx-26-join-leave');

  const d = v.game?.deadline, pd = prev.game?.deadline;
  const myTurn = d && d.kind === 'turn' && d.seat === v.me;
  const wasMyTurn = pd && pd.kind === 'turn' && pd.seat === prev.me && pd.at === d?.at;
  if (myTurn && !wasMyTurn) queue('sfx-03-my-turn', 0);

  if (d?.kind === 'run' && !(pd?.kind === 'run' && pd.at === d.at)) {
    const wait = Math.max(0, dealUntil - Date.now());
    play('voice-16-run-ask', wait);
    soundCursor = Date.now() + wait + 1900;
  }

  const r = v.result;
  if (r && !prev.result) {
    const mine = r.teams[v.me];
    const won = r.kind === 'win-2v2' ? r.winnerTeam === mine : (r.kind === 'pig-win') === (mine === 'pig');
    const main: SoundName = r.kind === 'water' ? 'sfx-22-draw' : won ? 'sfx-20-win' : 'sfx-21-lose';
    play(main, 300);
    // 다음 판이 누군가의 배려판이거나 탈락자가 생겼으면, 이어서 아슬아슬한 소리
    if (r.nextCare !== null || r.eliminated.length) play('sfx-23-care-out', 300 + (buffers.get(main)?.duration ?? 2) * 1000 + 200);
  }
}

function onEvent(ev: any, v: View) {
  eventSound(ev);
  if (ev.type === 'played') pendingFlights.push({ seat: ev.seat, key: playKey(ev.seat, ev.cards) });
  if (ev.type === 'passed') { pendingPops.push(ev.seat); return; }
  if (ev.type === 'pig') return shout('돼지!', 'pig', 3000);
  if (ev.type === 'blackPig') return shout('흑돼지!', 'blackpig', 3000);
  if (ev.type === 'played' && VIA[ev.via] && ev.via !== 'blackpig') return shout(VIA[ev.via]);
  const map: Record<string, string> = { fireAlarm: '불이야!', noKkot: '안 꽂아!', run: '달리기!', ddook: '뚝!' };
  if (map[ev.type]) shout(map[ev.type]);
  void v;
}

let shoutTimer = 0;
function shout(text: string, face: 'pig' | 'blackpig' | null = null, ms = 1100) {
  shoutEl.innerHTML = `${face ? pigFace(face) : ''}<span>${text}</span>`;
  shoutEl.className = `on${face ? ' face ' + face : ''}`;
  shoutEl.style.setProperty('--dur', `${ms}ms`);
  clearTimeout(shoutTimer);
  shoutTimer = window.setTimeout(() => { shoutEl.className = ''; shoutEl.innerHTML = ''; }, ms);
}

function pigFace(kind: 'pig' | 'blackpig') {
  return pigFaceSvg(kind);
}

function toast(m: string) {
  toastMsg = m;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toastMsg = ''; render(); }, 2400);
  render();
}

// ───── 소리 ─────
let soundOn = store.get('sasaki-sound') !== 'off';
let audio: AudioContext | null = null;
// 말소리·효과음 파일 (apps/web/sounds). 번호는 '사사끼 효과음 목록' 문서의 번호.
const SOUNDS = [
  'sfx-01-start', 'sfx-02-deal', 'sfx-03-my-turn', 'sfx-04-time-warn', 'sfx-05-play-card', 'sfx-08-no-play', 'sfx-09-clear-pile',
  'sfx-13-pig', 'sfx-14-black-pig', 'sfx-19-finish', 'sfx-20-win', 'sfx-21-lose', 'sfx-22-draw', 'sfx-23-care-out',
  'sfx-24-countdown', 'sfx-25-button', 'sfx-26-join-leave',
  'voice-06-1-tteul', 'voice-06-2-madae', 'voice-06-3-ssangka', 'voice-06-4-sasaki', 'voice-07-pass', 'voice-10-chatda',
  'voice-11-kkotda', 'voice-12-an-kkoja', 'voice-15-buriya', 'voice-16-run-ask', 'voice-17-run', 'voice-18-ttuk',
] as const;
type SoundName = (typeof SOUNDS)[number];
const buffers = new Map<SoundName, AudioBuffer>();
let soundsRequested = false;
function ensureAudio() {
  if (!soundOn) return;
  try {
    audio ??= new (window.AudioContext || (window as any).webkitAudioContext)();
    if (audio!.state === 'suspended') void audio!.resume();
  } catch { audio = null; }
  if (audio && !soundsRequested) {
    soundsRequested = true;
    const ctx = audio;
    for (const name of SOUNDS) {
      fetch(`/sounds/${name}.mp3`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
        .then((ab) => new Promise<AudioBuffer>((res, rej) => ctx.decodeAudioData(ab, res, rej)))
        .then((buf) => buffers.set(name, buf))
        .catch(() => { /* 소리 하나가 안 와도 게임은 그대로 */ });
    }
  }
}
/** 소리 하나 재생. delayMs 뒤에 나고, maxMs가 있으면 그때까지만 (끝을 살짝 줄여서), fromMs면 소리 중간부터 */
function play(name: SoundName, delayMs = 0, maxMs = 0, fromMs = 0) {
  if (!soundOn || !audio) return;
  const buf = buffers.get(name);
  if (!buf) return;
  const t = audio.currentTime + Math.max(0, delayMs) / 1000;
  const src = audio.createBufferSource();
  const g = audio.createGain();
  src.buffer = buf;
  g.gain.value = 0.85;
  src.connect(g).connect(audio.destination);
  src.start(t, fromMs / 1000);
  if (maxMs > 0 && maxMs / 1000 < buf.duration) {
    const end = t + maxMs / 1000;
    g.gain.setValueAtTime(0.85, Math.max(t, end - 0.15));
    g.gain.linearRampToValueAtTime(0.0001, end);
    src.stop(end + 0.02);
  }
}
/** 같은 이벤트에서 여러 소리가 한꺼번에 날 때 겹치지 않게 조금씩 뒤로 미는 순서표 */
let soundCursor = 0;
function queue(name: SoundName, gapMs = 120) {
  const t = Math.max(Date.now(), soundCursor);
  play(name, t - Date.now());
  const dur = buffers.get(name)?.duration ?? 0.5;
  soundCursor = t + Math.min(dur * 1000, 700) + gapMs;
}

// 시간에 맞춰 나는 소리 (남은 시간 경고 · 낼 패 없음 · 3-2-1) — 화면을 그릴 때마다 맞춰 본다
const timed: Record<string, { key: string; id: number }> = {};
function timedPlay(slot: string, key: string, name: SoundName, whenMs: number) {
  if (timed[slot]?.key === key) return;
  clearTimeout(timed[slot]?.id);
  delete timed[slot];
  if (!key) return;
  const wait = whenMs - now();
  // 이미 시작했어야 할 소리면 늦은 만큼 건너뛰고 중간부터 (소리가 다 끝났으면 생략)
  const dur = (buffers.get(name)?.duration ?? 0) * 1000;
  if (wait < 0 && -wait > dur - 150) return;
  timed[slot] = { key, id: window.setTimeout(() => play(name, 0, 0, Math.max(0, -wait)), Math.max(0, wait)) };
}
function stopTimed() { for (const s of Object.keys(timed)) { clearTimeout(timed[s].id); delete timed[s]; } }
function syncTicks() {
  const d = view?.game?.deadline;
  const mineTurn = d && d.seat === view?.me;
  // 낼 수 있는 패가 없을 때: 2초짜리 급한 똑딱
  timedPlay('nopass', view?.mine?.noPlay && d?.kind === 'autopass' ? `${d.at}` : '', 'sfx-08-no-play', d ? d.at - d.total : 0);
  // 내 차례 남은 시간 3초쯤: 차분한 째깍
  timedPlay('warn', mineTurn && d?.kind === 'turn' && !view?.mine?.noPlay ? `${d.at}` : '', 'sfx-04-time-warn', d ? d.at - 3000 : 0);
  // 다음 판 3-2-1: 마지막 '뾰옹'이 시작 순간에 맞게
  const r = view?.result;
  timedPlay('count', r && !r.ended ? `${r.nextAt}` : '', 'sfx-24-countdown', r ? r.nextAt - 3500 : 0);
}

// ───── 그리기 도우미 ─────

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const RANK = (r: number) => ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' } as Record<number, string>)[r] ?? String(r);
const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' } as const;
const label = (c: CardId) => SUIT[suitOf(c)] + RANK(rankOf(c));

function cardHtml(c: CardId, o: { sel?: boolean; small?: boolean; button?: boolean } = {}) {
  const red = suitOf(c) === 'H' || suitOf(c) === 'D';
  const cls = `card${red ? ' red' : ''}${o.sel ? ' sel' : ''}${o.small ? ' small' : ''}${isFire(c) ? ' fire' : ''}`;
  const inner = `<span class="rk">${RANK(rankOf(c))}</span><span class="st">${SUIT[suitOf(c)]}</span>`;
  return o.button
    ? `<button type="button" class="${cls}" data-card="${c}" aria-pressed="${!!o.sel}" aria-label="${label(c)}">${inner}</button>`
    : `<span class="${cls}" aria-label="${label(c)}">${inner}</span>`;
}

/** 숫자 없는 축소 원형 타이머 */
function ring(d: { at: number; total: number } | null | undefined, size = 'md') {
  if (!d) return '';
  const elapsed = Math.max(0, Math.min(d.total, d.total - (d.at - now())));
  const st = `animation-duration:${d.total}ms;animation-delay:-${Math.round(elapsed)}ms`;
  return `<svg class="ring ${size}" viewBox="0 0 40 40" aria-hidden="true"><circle class="bg" cx="20" cy="20" r="16"/><circle class="fg" cx="20" cy="20" r="16" pathLength="100" style="${st}"/></svg>`;
}

function comboName(kind: string, len: number) {
  return COMBO_NAME[kind as keyof typeof COMBO_NAME] + (kind === 'nilliri' ? ` ${len}장` : kind === 'ssangka' ? ` ${len}쌍` : '');
}

// ───── 화면 ─────

function homeHtml() {
  const code = roomCode;
  return `<main class="home">
    <p class="hello">어서와,<br>사사끼는 처음이지?</p>
    ${pigBodySvg()}
    <div class="titlebox"><h1 class="title">사사끼</h1></div>
    <form id="homeForm">
      <label class="field" for="nickIn">닉네임</label>
      <input class="input" id="nickIn" maxlength="5" autocomplete="nickname" value="${esc(nickname)}" required>
      ${code ? `<p class="invited">초대받은 방 <b>${esc(code)}</b></p>
        <button type="submit" class="btn primary" data-go="join">참가하기</button>`
      : `<button type="submit" class="btn primary" data-go="create">방 만들기</button>
        <div class="joinrow"><label class="sr" for="codeIn">방 코드</label><input class="input" id="codeIn" maxlength="4" placeholder="방 코드 ABCD" autocapitalize="characters"><button type="submit" class="btn" data-go="join">참가</button></div>`}
    </form>
  </main>`;
}

function lobbyHtml(v: View) {
  const link = `${location.origin}${location.pathname}?room=${v.code}`;
  const count = v.seats.filter((s) => s.nickname).length;
  const full = count === 4;
  const isHost = v.host === v.me;
  const seats = v.seats.map((s, i) => {
    const tools = isHost && !s.nickname ? `<button type="button" class="btn small ai-add" data-addai="1">AI 넣기</button>`
      : isHost && s.ai ? `<button type="button" class="btn small" data-removeai="${i}">빼기</button>` : '';
    return `<li class="lseat${s.nickname ? '' : ' empty'}"><span class="lnum">${i + 1}</span><span class="lname">${s.nickname ? esc(s.nickname) : '빈 자리'}</span>${s.ai ? '<i class="chip aichip">AI</i>' : ''}${i === v.host && s.nickname ? '<i class="chip host">방장</i>' : ''}${i === v.me ? '<i class="chip mychip">나</i>' : ''}${tools}</li>`;
  }).join('');
  return `<main class="lobby">
    <span class="logo">사사끼</span>
    <div class="codebox">
      <span class="lbl">방 코드</span><span class="code">${v.code}</span>
      <div class="invite"><label class="sr" for="linkIn">초대 링크</label><input class="input" id="linkIn" readonly value="${esc(link)}"><button type="button" class="btn" id="copyBtn">링크 복사</button></div>
    </div>
    <ol class="lseats">${seats}</ol>
    <div class="eggrow"><span>시작 알</span>
      ${isHost
        ? `<div class="stepper"><button type="button" class="iconbtn" data-eggs="-1" aria-label="알 줄이기">−</button><span class="val">${eggSvg()}${v.startEggs}</span><button type="button" class="iconbtn" data-eggs="1" aria-label="알 늘리기">+</button></div>`
        : `<span class="stepper"><span class="val">${eggSvg()}${v.startEggs}</span></span>`}
    </div>
    ${isHost
      ? `<div class="bar"><button type="button" class="btn line" id="shuffleBtn" ${count > 1 ? '' : 'disabled'}>자리 섞기</button>
         <button type="button" class="btn gold" id="startBtn" ${full ? '' : 'disabled'}>${full ? '게임 시작' : `${count}/4 모이는 중`}</button></div>`
      : '<p class="waitnote">방장이 시작하기를 기다리는 중이에요</p>'}
  </main>`;
}

function seatBadges(v: View, i: number) {
  const s = v.seats[i];
  const g = v.game!;
  const b: string[] = [];
  // 게임 중에는 누가 AI인지 표시하지 않음 (대기실에서만 표시)
  if (!s.connected) b.push('<i class="chip warn">연결 끊김 · AI 대리</i>');
  if (g.activeSeat === i) b.push('<i class="chip turn">차례</i>');
  if (s.rank) b.push(`<i class="chip done">${s.rank}등</i>`);
  else if (s.cardCount === 0 && g.phase !== 'hand-over') b.push('<i class="chip">카드를 다 냄</i>');
  if (s.fire) b.push(`<i class="chip firechip">${s.fire === 'pig' ? '돼지' : '불'}</i>`);
  if (s.runner) b.push('<i class="chip">달림</i>');
  if (s.ddooker) b.push('<i class="chip">뚝</i>');
  if (s.passed) b.push('<i class="chip">통과</i>');
  if (g.careSeat === i) b.push('<i class="chip warn">배려판</i>');
  return b.join('');
}

function seatHtml(v: View, i: number, pos: string) {
  const s = v.seats[i];
  const n = s.cardCount ?? 0;
  const g = v.game!;
  // 남은 시간: 동그라미 대신 정사각형 테두리 전체가 타이머 (밝은 테두리가 반시계로 줄어들고, 색이 초록 → 노랑 → 빨강)
  const dl = g.deadline && g.deadline.seat === i && g.activeSeat === i ? g.deadline : null;
  const tstyle = dl ? ` style="--tdur:${dl.total}ms;--tdel:-${Math.round(Math.max(0, Math.min(dl.total, dl.total - (dl.at - now()))))}ms"` : '';
  // 자리 칸은 크기가 고정돼 있어서, 표시가 붙었다 떨어져도 칸이 커지거나 작아지지 않는다
  return `<div class="seat ${pos}${i === v.me ? ' viewing' : ''}${g.activeSeat === i ? ' active' : ''}${dl ? ' timing' : ''}" data-seat="${i}"${tstyle}>
    <span class="sname"><span class="snm">${esc(s.nickname ?? '')}</span></span>${dl ? '<span class="stimer" aria-hidden="true"></span>' : ''}
    <span class="scount"><span class="backs" aria-hidden="true">${Array.from({ length: Math.min(n, 12) }, () => '<span class="back"></span>').join('')}</span><span class="seggs">${n}장</span></span>
    <span class="badges">${seatBadges(v, i)}</span>
  </div>`;
}

function centerHtml(v: View) {
  const g = v.game!;
  const m = v.mine!;
  if (g.phase === 'run-declare') {
    return `<div class="panel"><p class="ptitle">${ring(g.deadline, 'sm')}달릴 사람 있나요?</p>
      ${m.canRun ? `<p class="psub">불을 가졌어요. 달리면 배수 ×2, 불이 공개됩니다.</p><div class="prow"><button type="button" class="btn hot" data-act="declareRun">달리기</button></div>`
      : '<p class="psub">불을 가진 사람이 정하는 중이에요</p>'}</div>`;
  }
  if (g.phase === 'ddook-declare') {
    return `<div class="panel"><p class="ptitle">${ring(g.deadline, 'sm')}뚝?</p><p class="psub">${esc(nm(g.runnerSeat!))}가 달립니다. 반대편 한 명이 뚝을 외치면 배수 ×4.</p>
      ${m.canDdook ? '<div class="prow"><button type="button" class="btn hot" data-act="declareDdook">뚝</button></div>' : ''}</div>`;
  }
  if (!g.trick.length) {
    if (g.activeSeat !== null) return `<p class="pile-note"><b>${esc(nm(g.activeSeat))}</b> 선 · 아무 조합이나 낼 수 있어요</p>`;
    return '<p class="pile-note">&nbsp;</p>';
  }
  // 직전 카드(선명, 낸 사람 닉네임만) 위에 그 앞 카드(흐리게, 이름 없음)가 깔린 채 겹쳐 쌓인 모습
  const plays = g.trick.slice(-2);
  const pile = plays.map((p, i) => {
    const last = i === plays.length - 1;
    const key = playKey(p.seat, p.cards);
    const incoming = last && flying && flying.key === key && Date.now() < flying.until;
    return `<div class="play ${last ? 'last' : 'prev'}${last && p.via !== 'play' ? ' special' : ''}${incoming ? ' incoming' : ''}" data-key="${esc(key)}" style="--n:${p.cards.length}">
      <div class="pcards">${p.cards.map((c) => cardHtml(c)).join('')}</div>
      ${last ? `<span class="pby">${esc(nm(p.seat))}</span>` : ''}</div>`;
  }).join('');
  let note = '';
  if (g.phase === 'reveal' && g.revealLeader !== null) note = `<p class="lead-note">${esc(nm(g.revealLeader))} 선</p>`;
  return `<div class="pilewrap"><div class="pilecards">${pile}</div>${note}</div>`;
}

function statusOf(v: View): { text: string; canPlay: boolean; warn?: boolean } {
  const g = v.game!;
  const m = v.mine!;
  // 차례·안내 문구는 표시하지 않는다 (누구 차례인지는 게임판의 자리 색으로 보임). 고른 카드에 대한 판정만 보여준다.
  if (m.window || !m.myTurn) return { text: '', canPlay: false };
  const cards = [...selected];
  if (!cards.length) return { text: '', canPlay: false };
  const c = classifyCombo(cards);
  if (!c) return { text: '허용되지 않는 조합', canPlay: false };
  const topP = g.trick.at(-1);
  const top = topP ? classifyCombo(topP.cards) : null;
  const name = comboName(c.kind, c.length);
  if (!canBeat(c, top)) return { text: `${name} · 현재 공격보다 약함`, canPlay: false };
  if (['teul', 'sasaki', 'madae', 'bulpig'].includes(c.kind) && cards.length === m.hand.length) return { text: `${name} · 틀 이상은 마지막에 낼 수 없어요`, canPlay: false, warn: true };
  return { text: `${name} · 낼 수 있음`, canPlay: true };
}

function handHtml(v: View) {
  const g = v.game!;
  const m = v.mine!;
  const st = statusOf(v);
  const btns: string[] = [];
  // 특수 행동 버튼은 모두 여기(주패 아래 같은 자리)
  if (m.window?.type === 'kkotda') btns.push(`<span class="timed">${ring(g.deadline, 'sm')}<button type="button" class="btn spec big" data-act="kkotda">꽂다 ${m.window.cards.map(label).join(' ')}</button><button type="button" class="btn" data-act="kkotdaPass">안 꽂아</button></span>`);
  if (m.window?.type === 'blackpig') btns.push(`<span class="timed">${ring(g.deadline, 'sm')}<button type="button" class="btn spec big" data-act="blackPigSubmit">흑돼지 ♠10 ♣10</button><button type="button" class="btn" data-act="blackPigPass">통과</button></span>`);
  for (const o of m.options) btns.push(`<button type="button" class="btn spec" data-act="${o.type}" data-cards="${o.cards.join(',')}">${o.type === 'chatda' ? '찼다' : '차기'} ${o.cards.map(label).join(' ')}</button>`);
  const nopass = m.noPlay ? `<div class="nopass" role="status">${clockSvg(g.deadline)}<span class="nopass-text"><b>낼 수 있는 패가 없습니다</b></span></div>` : '';
  return `<section class="me" aria-label="내 주패">
    <div class="me-head">
      <span class="me-name">${esc(nm(v.me))}의 주패 <small>${m.hand.length}장</small>${m.myTurn && !m.noPlay ? ring(g.deadline, 'sm') : ''}</span>
      <span class="status${st.canPlay ? ' good' : ''}${st.warn ? ' none' : ''}">${esc(st.text)}</span>
    </div>
    ${nopass}
    <div class="hand">${m.hand.map((c) => cardHtml(c, { sel: selected.has(c), button: true })).join('') || '<p class="pile-note">카드를 모두 냈어요</p>'}</div>
    <div class="actions">
      <button type="button" class="btn primary" id="playBtn" ${st.canPlay ? '' : 'disabled'}>제출</button>
      <button type="button" class="btn" id="passBtn" ${m.myTurn && g.trick.length ? '' : 'disabled'}>통과</button>
      ${btns.join('')}
      ${selected.size ? '<button type="button" class="btn ghost" id="clearBtn">선택 해제</button>' : ''}
    </div>
  </section>`;
}

function clockSvg(d: DeadlineV | null) {
  const el = d ? Math.max(0, Math.min(d.total, d.total - (d.at - now()))) : 0;
  const st = d ? `animation-delay:-${Math.round(el)}ms;animation-duration:${d.total}ms` : '';
  return `<svg class="clock" viewBox="0 0 48 48" aria-hidden="true"><circle class="face" cx="24" cy="24" r="21"></circle>
    <circle class="sweep" cx="24" cy="24" r="17" pathLength="100" style="${st}"></circle>
    <line class="hand" x1="24" y1="24" x2="24" y2="9" style="${st}"></line><circle class="pin" cx="24" cy="24" r="2.4"></circle></svg>`;
}

function resultHtml(v: View) {
  const r = v.result;
  if (!r) return '';
  const T: Record<string, string> = { fire: '불팀', black: '흑팀', pig: '돼지' };
  // 제목과 돼지 그림은 '내' 입장에서: 내 팀이 이겼는지 졌는지
  const mine = r.teams[v.me];
  let title: string;
  let face: string;
  if (r.kind === 'water') { title = '물판'; face = pigFaceSvg('skypig', 'normal'); }
  else {
    const won = r.kind === 'win-2v2' ? r.winnerTeam === mine : (r.kind === 'pig-win') === (mine === 'pig');
    title = `${T[mine]} ${won ? '승리' : '패배'}!`;
    face = pigFaceSvg(mine === 'black' ? 'blackpig' : 'pig', won ? 'happy' : 'sad');
  }
  const rows = r.ranks.map((seat, i) => {
    const d = r.deltas[seat];
    const undecided = r.earlyEnd && i >= r.decided;
    const cls = seat === v.me ? ' mine' : i === 0 ? ' first' : '';
    return `<div class="rrow${cls}"><span class="place${undecided ? ' none' : ''}">${undecided ? '—' : `${i + 1}등`}</span>
      <span class="nm">${esc(nm(seat))}${seat === v.me ? ' <small>나</small>' : ''}</span>
      <span class="team ${r.teams[seat]}">${T[r.teams[seat]]}</span>
      <span class="num ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d)}</span><span class="num">${r.eggs[seat]}</span></div>`;
  }).join('');
  const notes: string[] = [];
  if (r.earlyEnd) notes.push('결과가 정해져 조기 종료');
  notes.push(`×${r.multiplier}`, `묻어둔 알 ${r.buried}`);
  if (r.careSurvived === true) notes.push('배려판 생존');
  if (r.careSurvived === false) notes.push('배려판 실패');
  let foot = '';
  if (r.ended) {
    const reason = r.endReason === 'multiple-care' ? '두 명 이상이 동시에 파산해 게임이 끝났어요' : `${r.eliminated.map(nm).join(', ')} 탈락으로 게임이 끝났어요`;
    foot = `<p class="endnote">${reason}</p>
      <ol class="final">${r.standings!.map((s) => `<li><span><b>${s.place}위</b>${esc(s.nickname)}</span><span class="num">${s.eggs}알</span></li>`).join('')}</ol>
      <div class="bar">${v.host === v.me ? '<button type="button" class="btn gold" id="rematchBtn">같은 멤버로 새 게임</button>' : ''}<button type="button" class="btn line" id="leaveBtn">${leaveArmed ? '정말 나갈까요? 한 번 더 누르면 나가요' : '나가기'}</button></div>
      ${v.host === v.me ? '' : '<p class="endnote">방장이 새 게임을 열 수 있어요</p>'}`;
  } else {
    const imReady = r.ready.includes(v.me);
    foot = `${r.nextCare !== null ? `<p class="endnote">다음 판은 <b>${esc(nm(r.nextCare))}</b>의 배려판이에요. 알을 1개 이상 얻어야 살아남아요.</p>` : ''}
      <div class="countdown" id="countdown"><span class="n"></span><span class="t"></span></div>
      <div class="bar"><button type="button" class="btn gold" id="readyBtn" ${imReady ? 'disabled' : ''}>${imReady ? '기다리는 중' : '다시 한 판 더'}</button>
      <button type="button" class="btn line" id="shuffleBtn" ${r.shufflePending ? 'disabled' : ''}>${r.shufflePending ? '다음 판에 바뀜' : '자리 바꾸기'}</button></div>
      <button type="button" class="btn line leave" id="leaveBtn">${leaveArmed ? '정말 나갈까요? 한 번 더 누르면 나가요' : '나가기'}</button>`;
  }
  return `<div class="overlay" role="dialog" aria-modal="true" aria-label="판 결과"><div class="sheet">
    <div class="reshead"><div><p class="eyebrow">${v.game?.handNo ?? ''}판 결과</p><h2>${title}</h2></div>${face}</div>
    <div class="restable"><div class="rrow head"><span>순위</span><span>이름</span><span>팀</span><span style="text-align:right">증감</span><span style="text-align:right">알</span></div>
      ${rows}<p class="resnote">${notes.join(' · ')}</p></div>
    <div class="resfoot">${foot}</div></div></div>`;
}

function gameHtml(v: View) {
  const g = v.game!;
  const pos = (k: number) => (v.me + k) % 4; // 반시계: 오른쪽 → 위 → 왼쪽
  const log = [...v.log].reverse().map((l) => logText(l.ev)).filter(Boolean) as string[];
  return `
  <header class="top">
    <span class="logo">사사끼</span>
    <div class="meta">
      ${g.multiplier > 1 ? `<span class="pill hot">×${g.multiplier}</span>` : ''}
      <button type="button" class="iconbtn" id="soundBtn" aria-pressed="${soundOn}" aria-label="${soundOn ? '소리 끄기' : '소리 켜기'}">${soundOn
        ? '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/></svg>'
        : '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>'}</button>
    </div>
  </header>
  <main class="layout">
    <div class="tablearea">
      <div class="felt">
        ${seatHtml(v, pos(2), 'top')}${seatHtml(v, pos(3), 'left')}
        <div class="pile">${centerHtml(v)}</div>
        ${seatHtml(v, pos(1), 'right')}${seatHtml(v, pos(0), 'bottom')}
      </div>
      ${handHtml(v)}
    </div>
    <details class="log" id="logBox" ${logOpen ? 'open' : ''}><summary><p class="eyebrow">진행 기록</p></summary><ol>${log.map((l) => `<li>${esc(l)}</li>`).join('')}</ol></details>
  </main>
  ${resultHtml(v)}`;
}

function render() {
  syncTicks();
  let html: string;
  if (!view) html = homeHtml();
  else if (view.status === 'lobby') html = lobbyHtml(view);
  else html = gameHtml(view);
  document.body.dataset.screen = !view ? 'home' : view.status === 'lobby' ? 'lobby' : 'game';
  app.innerHTML = html + (toastMsg ? `<div class="toast" role="status">${esc(toastMsg)}</div>` : '');
  updateCountdown();
  flushPops();
  flushFlights();
  syncRunShow();
}

// ───── 달리기 연출: 선언자 불 → 1초 → 같은 팀 불 → 1초 → 두 장을 서로 교환 (팀 확인 퍼포먼스) ─────
// 돼지가 달리면 불 두 장을 1초 간격으로 돼지 닉네임 곁에 내려놓기만 한다 (교환 없음).
const RUN_STEP = 1000;
const SWAP_MS = 650;
let runShowState: { id: number; cards: { el: HTMLElement; seat: number; slot: number }[]; timers: number[] } | null = null;

/** 자리 닉네임 곁: 자리 칸 바깥, 탁자 가운데 쪽으로 바로 붙은 지점 (자리 칸과 겹치지 않게) */
function runAnchor(seat: number, slot = 0, of = 1): { x: number; y: number } | null {
  const el = document.querySelector<HTMLElement>(`.seat[data-seat="${seat}"]`);
  const felt = document.querySelector<HTMLElement>('.felt');
  if (!el || !felt) return null;
  const r = el.getBoundingClientRect();
  const f = felt.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const dx = f.left + f.width / 2 - cx, dy = f.top + f.height / 2 - cy;
  const cw = 40, ch = cw * 1.43, gap = 8;
  const spread = (slot - (of - 1) / 2) * cw * 1.15;
  // 가운데가 옆쪽이면 자리 칸 옆에, 위·아래쪽이면 자리 칸 위·아래에
  if (Math.abs(dx) / r.width > Math.abs(dy) / r.height) {
    return { x: cx + Math.sign(dx) * (r.width / 2 + gap + cw / 2), y: cy + (slot - (of - 1) / 2) * ch * 0.6 };
  }
  return { x: cx + spread, y: cy + Math.sign(dy) * (r.height / 2 + gap + ch / 2) };
}

function placeRunCard(card: CardId, seat: number, slot: number, of: number, animate: boolean) {
  const p = runAnchor(seat, slot, of);
  if (!p || !runShowState) return;
  const el = document.createElement('div');
  el.className = 'runcard';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = cardHtml(card);
  el.style.left = `${p.x}px`; el.style.top = `${p.y}px`;
  document.body.appendChild(el);
  runShowState.cards.push({ el, seat, slot });
  if (animate) {
    play('sfx-05-play-card');
    if (!reduceMotion) el.animate([
      { transform: 'translate(-50%, -50%) translateY(-26px) scale(1.45) rotate(-10deg)', opacity: 0 },
      { transform: 'translate(-50%, -50%) scale(.94) rotate(3deg)', opacity: 1, offset: 0.7 },
      { transform: 'translate(-50%, -50%) scale(1) rotate(0)', opacity: 1 },
    ], { duration: 380, easing: 'cubic-bezier(.2,.7,.3,1)' });
  }
}

function swapRunCards(animate: boolean) {
  const st = runShowState;
  if (!st || st.cards.length < 2) return;
  const [a, b] = st.cards;
  const pa = runAnchor(b.seat), pb = runAnchor(a.seat); // a는 b 자리로, b는 a 자리로
  if (!pa || !pb) return;
  if (animate) play('sfx-05-play-card');
  const move = (c: { el: HTMLElement; seat: number }, to: { x: number; y: number }, lift: number) => {
    const x0 = parseFloat(c.el.style.left), y0 = parseFloat(c.el.style.top);
    const dx = to.x - x0, dy = to.y - y0;
    c.el.style.left = `${to.x}px`; c.el.style.top = `${to.y}px`;
    if (!animate || reduceMotion) return;
    // 두 장이 서로 부딪히지 않게 살짝 반대쪽으로 휘어 지나간다
    const nx = -dy, ny = dx, len = Math.hypot(nx, ny) || 1;
    const ox = (nx / len) * lift, oy = (ny / len) * lift;
    c.el.animate([
      { transform: `translate(-50%, -50%) translate(${-dx}px, ${-dy}px)` },
      { transform: `translate(-50%, -50%) translate(${-dx / 2 + ox}px, ${-dy / 2 + oy}px) scale(1.18) rotate(${lift > 0 ? 12 : -12}deg)`, offset: 0.5 },
      { transform: 'translate(-50%, -50%)' },
    ], { duration: SWAP_MS, easing: 'cubic-bezier(.45,.05,.3,1)' });
  };
  move(a, pa, 34);
  move(b, pb, -34);
}

function endRunShow() {
  const st = runShowState;
  runShowState = null;
  if (!st) return;
  st.timers.forEach(clearTimeout);
  for (const c of st.cards) {
    if (reduceMotion) { c.el.remove(); continue; }
    const an = c.el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: 'forwards' });
    an.onfinish = () => c.el.remove();
  }
}

function syncRunShow() {
  const rs = view?.status === 'playing' ? view.game?.runShow ?? null : null;
  if (!rs) { if (runShowState) endRunShow(); return; }
  if (runShowState?.id === rs.id) return;
  endRunShow();
  runShowState = { id: rs.id, cards: [], timers: [] };
  const st = runShowState;
  const steps: { at: number; run: (animate: boolean) => void }[] = [];
  if (rs.partner === null) {
    rs.runnerCards.forEach((c, i) => steps.push({ at: i * RUN_STEP, run: (an) => placeRunCard(c, rs.runner, i, rs.runnerCards.length, an) }));
  } else {
    steps.push({ at: 0, run: (an) => placeRunCard(rs.runnerCards[0], rs.runner, 0, 1, an) });
    steps.push({ at: RUN_STEP, run: (an) => placeRunCard(rs.partnerCard!, rs.partner!, 0, 1, an) });
    steps.push({ at: RUN_STEP * 2, run: (an) => swapRunCards(an) });
  }
  // 늦게 들어왔으면 이미 지난 단계는 소리·움직임 없이 바로 그 상태로
  const elapsed = now() - rs.start;
  for (const s of steps) {
    if (s.at <= elapsed - 150) s.run(false);
    else st.timers.push(window.setTimeout(() => { if (runShowState === st) s.run(true); }, Math.max(0, s.at - elapsed)));
  }
}

/** "통과" 말풍선: 그 사람 자리 위에서 한 번 커졌다가 사라짐 (불이야보다 작게) */
function flushPops() {
  const seats = pendingPops;
  pendingPops = [];
  for (const seat of seats) {
    const el = document.querySelector<HTMLElement>(`.seat[data-seat="${seat}"]`);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    const pop = document.createElement('div');
    pop.className = 'passpop';
    pop.textContent = '통과';
    pop.setAttribute('aria-hidden', 'true');
    pop.style.left = `${r.left + r.width / 2 + window.scrollX}px`;
    pop.style.top = `${r.top + window.scrollY}px`;
    document.body.appendChild(pop);
    setTimeout(() => pop.remove(), 1000);
  }
}

function updateCountdown() {
  const el = document.getElementById('countdown');
  const r = view?.result;
  if (!el || !r || r.ended) return;
  const left = Math.max(1, Math.ceil((r.nextAt - now()) / 1000));
  el.querySelector('.n')!.textContent = String(left);
  el.querySelector('.t')!.textContent = left <= 3 ? '곧 시작!' : '초 뒤 다음 판';
}
setInterval(updateCountdown, 250);

// ───── 입력 ─────

const actionId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
function sendAction(type: string, cards?: CardId[]) {
  socket.emit('action', { type, cards, id: actionId() });
}
function sendSelection() { socket.emit('select', [...selected]); }

app.addEventListener('click', (e) => {
  ensureAudio();
  const t = e.target as HTMLElement;
  if (t.closest('button, [data-card]') && !t.closest('#soundBtn')) play('sfx-25-button');
  const card = t.closest<HTMLElement>('[data-card]');
  if (card) {
    const c = card.dataset.card!;
    selected.has(c) ? selected.delete(c) : selected.add(c);
    sendSelection();
    render();
    return;
  }
  const eggBtn = t.closest<HTMLElement>('[data-eggs]');
  if (eggBtn && view) { socket.emit('setEggs', Math.max(1, Math.min(999, view.startEggs + Number(eggBtn.dataset.eggs)))); return; }
  const addAi = t.closest<HTMLElement>('[data-addai]');
  if (addAi) { socket.emit('addAi', null, (r: any) => { if (!r?.ok && r?.reason) toast(r.reason); }); return; }
  const rmAi = t.closest<HTMLElement>('[data-removeai]');
  if (rmAi) { socket.emit('removeAi', Number(rmAi.dataset.removeai)); return; }
  const act = t.closest<HTMLElement>('[data-act]');
  if (act) {
    const cards = act.dataset.cards ? act.dataset.cards.split(',') : undefined;
    sendAction(act.dataset.act!, cards);
    return;
  }
  const btn = t.closest<HTMLButtonElement>('button');
  const id = btn?.id;
  if (id === 'playBtn') { sendAction('play', [...selected]); }
  else if (id === 'passBtn') sendAction('pass');
  else if (id === 'clearBtn') { selected.clear(); sendSelection(); render(); }
  else if (id === 'startBtn') socket.emit('start', null, (r: any) => { if (!r?.ok && r?.reason) toast(r.reason); });
  else if (id === 'readyBtn') socket.emit('ready');
  else if (id === 'rematchBtn') socket.emit('rematch');
  else if (id === 'leaveBtn') {
    if (!leaveArmed) { leaveArmed = true; render(); setTimeout(() => { leaveArmed = false; render(); }, 4000); return; }
    leaveArmed = false;
    socket.emit('leave', null, (r: any) => {
      if (!r?.ok) return toast(r?.reason ?? '나갈 수 없어요');
      store.set(`sasaki:token:${roomCode}`, '');
      view = null; roomCode = ''; lastLogN = -1; selected.clear();
      history.replaceState(null, '', location.pathname);
      render();
      toast('게임에서 나왔어요. 내 자리는 AI가 이어서 해요');
    });
  }
  else if (id === 'shuffleBtn') socket.emit('shuffle', null, (r: any) => { if (!r?.ok && r?.reason) toast(r.reason); });
  else if (id === 'copyBtn') {
    const input = document.getElementById('linkIn') as HTMLInputElement;
    navigator.clipboard?.writeText(input.value).then(() => toast('초대 링크를 복사했어요'), () => { input.select(); toast('링크를 길게 눌러 복사하세요'); });
    if (!navigator.clipboard) { input.select(); toast('링크를 길게 눌러 복사하세요'); }
  } else if (id === 'soundBtn') {
    soundOn = !soundOn;
    store.set('sasaki-sound', soundOn ? 'on' : 'off');
    if (soundOn) ensureAudio(); else stopTimed();
    render();
  }
});

let lastGo = 'create';
app.addEventListener('click', (e) => {
  const go = (e.target as HTMLElement).closest<HTMLElement>('[data-go]');
  if (go) lastGo = go.dataset.go!;
}, true);

app.addEventListener('submit', (e) => {
  e.preventDefault();
  const nick = (document.getElementById('nickIn') as HTMLInputElement).value.trim();
  if (!nick) return toast('닉네임을 입력해 주세요');
  nickname = nick;
  store.set('sasaki:nick', nick);
  if (lastGo === 'join' || roomCode) {
    const code = roomCode || (document.getElementById('codeIn') as HTMLInputElement)?.value.trim().toUpperCase();
    if (!code) return toast('방 코드를 입력해 주세요');
    roomCode = code;
    join(code, nick, store.get(`sasaki:token:${code}`));
  } else {
    socket.emit('create', { nickname: nick }, (r: any) => { if (!r.ok) return toast(r.reason); entered(r); });
  }
});

app.addEventListener('change', (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id === 'eggsIn') socket.emit('setEggs', Number(t.value));
});

render();
