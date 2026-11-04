// M3 온라인 화면: 서버가 보내준 "내 화면 정보"만 그린다. 판정은 전부 서버가 한다.
import { canBeat, CardId, classifyCombo, COMBO_NAME, isFire, rankOf, suitOf } from '../../../packages/game-core/src/index';

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
interface GameV { handNo: number; multiplier: number; buried: number; careSeat: number | null; phase: string; activeSeat: number | null; leaderSeat: number; runnerSeat: number | null; trick: PlayV[]; revealLeader: number | null; deadline: DeadlineV | null }
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
    case 'passed': return `${n(ev.seat)} 패스`;
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
  }
  return null;
}

function onEvent(ev: any, v: View) {
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

/** 귀여운 돼지 얼굴. 불돼지: 빨강·분홍, 흑돼지: 검정·회색에 더 크게 웃는 입 */
function pigFace(kind: 'pig' | 'blackpig') {
  const black = kind === 'blackpig';
  const c = black
    ? { face: '#3a3a3e', ear: '#1f1f22', inner: '#8b8b92', snout: '#6d6d74', nost: '#1b1b1d', cheek: '#55555b', eye: '#f2f2f2', mouth: '#111' }
    : { face: '#ffb3c1', ear: '#e8435a', inner: '#ff8aa0', snout: '#ff7f96', nost: '#b3203a', cheek: '#ff6b81', eye: '#2b1418', mouth: '#9e1730' };
  const mouth = black
    ? `<path d="M64 132 Q100 176 136 132 Q100 150 64 132Z" fill="${c.mouth}"/><path d="M78 140 Q100 158 122 140" fill="none" stroke="#e9e9ee" stroke-width="5" stroke-linecap="round"/>`
    : `<path d="M82 136 Q100 150 118 136" fill="none" stroke="${c.mouth}" stroke-width="5" stroke-linecap="round"/>`;
  const eyes = black
    ? `<path d="M58 84 Q70 72 82 84" fill="none" stroke="${c.eye}" stroke-width="7" stroke-linecap="round"/><path d="M118 84 Q130 72 142 84" fill="none" stroke="${c.eye}" stroke-width="7" stroke-linecap="round"/>`
    : `<circle cx="70" cy="84" r="8" fill="${c.eye}"/><circle cx="130" cy="84" r="8" fill="${c.eye}"/><circle cx="73" cy="81" r="2.6" fill="#fff"/><circle cx="133" cy="81" r="2.6" fill="#fff"/>`;
  return `<svg class="pigface" viewBox="0 0 200 190" aria-hidden="true">
    <path d="M38 52 L22 6 L78 34 Z" fill="${c.ear}"/><path d="M162 52 L178 6 L122 34 Z" fill="${c.ear}"/>
    <path d="M42 44 L32 18 L66 36 Z" fill="${c.inner}"/><path d="M158 44 L168 18 L134 36 Z" fill="${c.inner}"/>
    <ellipse cx="100" cy="100" rx="82" ry="76" fill="${c.face}"/>
    <ellipse cx="46" cy="118" rx="15" ry="10" fill="${c.cheek}" opacity=".75"/><ellipse cx="154" cy="118" rx="15" ry="10" fill="${c.cheek}" opacity=".75"/>
    ${eyes}
    <ellipse cx="100" cy="112" rx="32" ry="22" fill="${c.snout}"/>
    <ellipse cx="89" cy="112" rx="6" ry="9" fill="${c.nost}"/><ellipse cx="111" cy="112" rx="6" ry="9" fill="${c.nost}"/>
    ${mouth}
  </svg>`;
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
function ensureAudio() {
  if (!soundOn) return;
  try {
    audio ??= new (window.AudioContext || (window as any).webkitAudioContext)();
    if (audio!.state === 'suspended') void audio!.resume();
  } catch { audio = null; }
}
function tick(high: boolean) {
  if (!soundOn || !audio) return;
  const t = audio.currentTime;
  const o = audio.createOscillator();
  const g = audio.createGain();
  o.type = 'square';
  o.frequency.setValueAtTime(high ? 1900 : 1300, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.18, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  o.connect(g).connect(audio.destination);
  o.start(t); o.stop(t + 0.06);
}
let tickKey = '';
let tickTimers: number[] = [];
function syncTicks() {
  const d = view?.game?.deadline;
  const key = view?.mine?.noPlay && d?.kind === 'autopass' ? `${d.at}` : '';
  if (key === tickKey) return;
  tickKey = key;
  tickTimers.forEach(clearTimeout); tickTimers = [];
  if (!key || !d) return;
  const start = d.at - d.total;
  for (let i = 0; i < 4; i++) {
    const at = start + (i * d.total) / 4 - now();
    if (at > -40) tickTimers.push(window.setTimeout(() => tick(i % 2 === 0), Math.max(0, at)));
  }
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
    <div class="home-card">
      <p class="logo big">사사끼</p>
      <p class="sub">네 명이 각자 기기에서 함께하는 카드게임</p>
      <form id="homeForm" class="fields1">
        <label class="field"><span>닉네임 (8자까지)</span><input id="nickIn" maxlength="8" autocomplete="nickname" value="${esc(nickname)}" required></label>
        ${code ? `<p class="psub">초대받은 방 <b class="code">${esc(code)}</b></p>
          <div class="prow"><button type="submit" class="btn primary" data-go="join">참가하기</button></div>`
        : `<div class="prow"><button type="submit" class="btn primary" data-go="create">방 만들기</button></div>
          <div class="or"><span>또는 방 코드로 참가</span></div>
          <div class="prow join-row"><input id="codeIn" maxlength="4" placeholder="ABCD" aria-label="방 코드" autocapitalize="characters"><button type="submit" class="btn" data-go="join">참가</button></div>`}
      </form>
    </div>
  </main>`;
}

function lobbyHtml(v: View) {
  const link = `${location.origin}${location.pathname}?room=${v.code}`;
  const full = v.seats.every((s) => s.nickname);
  const isHost = v.host === v.me;
  const seats = v.seats.map((s, i) => {
    const tools = isHost && !s.nickname ? `<button type="button" class="btn small ai-add" data-addai="1">AI 넣기</button>`
      : isHost && s.ai ? `<button type="button" class="btn ghost small" data-removeai="${i}">빼기</button>` : '';
    return `<li class="lseat${s.nickname ? '' : ' empty'}"><span class="lnum">${i + 1}</span><span class="lname">${s.nickname ? esc(s.nickname) : '빈 자리'}</span>${s.ai ? ' <i class="chip aichip">AI</i>' : ''}${i === v.host && s.nickname ? ' <i class="chip">방장</i>' : ''}${i === v.me ? ' <i class="chip turn">나</i>' : ''}${tools}</li>`;
  }).join('');
  return `<main class="home"><div class="home-card wide">
    <p class="eyebrow">대기실</p>
    <h2>방 코드 <span class="code">${v.code}</span></h2>
    <div class="invite"><input id="linkIn" readonly value="${esc(link)}" aria-label="초대 링크"><button type="button" class="btn" id="copyBtn">링크 복사</button></div>
    <p class="psub">이 링크를 친구들에게 보내세요. 빈 자리는 방장이 AI로 채울 수 있어요. 4자리가 차면 시작합니다.</p>
    <ol class="lseats">${seats}</ol>
    ${isHost
      ? `<div class="prow left"><label class="field inline"><span>시작 알</span><input id="eggsIn" type="number" min="1" max="999" value="${v.startEggs}"></label>
         <button type="button" class="btn" id="shuffleBtn" ${v.seats.filter((s) => s.nickname).length > 1 ? '' : 'disabled'}>자리 섞기</button>
         <button type="button" class="btn primary" id="startBtn" ${full ? '' : 'disabled'}>${full ? '게임 시작' : `${v.seats.filter((s) => s.nickname).length}/4 모이는 중`}</button></div>`
      : `<p class="psub">시작 알 <b>${v.startEggs}</b> · 방장이 시작하기를 기다리는 중이에요</p>`}
  </div></main>`;
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
  if (s.passed) b.push('<i class="chip">패스</i>');
  if (g.careSeat === i) b.push('<i class="chip warn">배려판</i>');
  return b.join('');
}

function seatHtml(v: View, i: number, pos: string) {
  const s = v.seats[i];
  const n = s.cardCount ?? 0;
  const g = v.game!;
  const d = g.deadline && g.deadline.seat === i && g.activeSeat === i ? ring(g.deadline, 'sm') : '';
  return `<div class="seat ${pos}${i === v.me ? ' viewing' : ''}${g.activeSeat === i ? ' active' : ''}">
    <span class="sname">${esc(s.nickname ?? '')}${d}</span>
    <span class="seggs"><b>${s.eggs ?? 0}</b>알 · ${n}장</span>
    <span class="backs">${Array.from({ length: Math.min(n, 12) }, () => '<span class="back"></span>').join('')}</span>
    <span class="badges">${seatBadges(v, i)}</span>
  </div>`;
}

function centerHtml(v: View) {
  const g = v.game!;
  const m = v.mine!;
  if (g.phase === 'run-declare') {
    return `<div class="panel">${ring(g.deadline, 'md')}<p class="ptitle">달릴 사람 있나요?</p>
      ${m.canRun ? `<p class="psub">불을 가졌어요. 달리면 배수 ×2, 불이 공개됩니다.</p><div class="prow"><button type="button" class="btn hot" data-act="declareRun">달리기</button></div>`
      : '<p class="psub">불을 가진 사람이 정하는 중이에요</p>'}</div>`;
  }
  if (g.phase === 'ddook-declare') {
    return `<div class="panel">${ring(g.deadline, 'md')}<p class="ptitle">뚝?</p><p class="psub">${esc(nm(g.runnerSeat!))}가 달립니다. 반대편 한 명이 뚝을 외치면 배수 ×4.</p>
      ${m.canDdook ? '<div class="prow"><button type="button" class="btn hot" data-act="declareDdook">뚝</button></div>' : ''}</div>`;
  }
  if (!g.trick.length) {
    if (g.activeSeat !== null) return `<p class="pile-note"><b>${esc(nm(g.activeSeat))}</b> 선 · 아무 조합이나 낼 수 있어요</p>`;
    return '<p class="pile-note">&nbsp;</p>';
  }
  const plays = g.trick.slice(-4);
  const pile = plays.map((p, i) => {
    const last = i === plays.length - 1;
    const name = p.via === 'blackpig' ? '흑돼지' : COMBO_NAME[p.kind as keyof typeof COMBO_NAME];
    return `<div class="play${last ? ' last' : ''}${last && p.via !== 'play' ? ' special' : ''}">
      <div class="pcards">${p.cards.map((c) => cardHtml(c, { small: !last })).join('')}</div>
      <span class="pby">${esc(nm(p.seat))} · ${name}${VIA[p.via] ? ' · ' + VIA[p.via] : ''}</span></div>`;
  }).join('');
  let note = '';
  if (g.phase === 'reveal' && g.revealLeader !== null) note = `<p class="lead-note">${esc(nm(g.revealLeader))} 선</p>`;
  if (g.phase === 'waiting' && !m.window) note = `<p class="lead-note quiet">${ring(g.deadline, 'xs')} 잠시 기다리는 중</p>`;
  return `<div class="pilewrap"><div class="pilecards">${pile}</div>${note}</div>`;
}

function statusOf(v: View): { text: string; canPlay: boolean; warn?: boolean } {
  const g = v.game!;
  const m = v.mine!;
  if (m.window) return { text: m.window.type === 'kkotda' ? '꽂을지 정해 주세요' : '흑돼지로 막을지 정해 주세요', canPlay: false };
  if (!m.myTurn) return { text: g.activeSeat !== null ? `${nm(g.activeSeat)}의 차례예요` : '', canPlay: false };
  const cards = [...selected];
  if (!cards.length) return { text: g.trick.length ? '카드를 고르거나 패스하세요' : '선입니다. 카드를 고르세요', canPlay: false };
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
      <button type="button" class="btn" id="passBtn" ${m.myTurn && g.trick.length && !m.noPlay ? '' : 'disabled'}>패스</button>
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
  const title = { 'win-2v2': `${T[r.winnerTeam!]} 승리`, 'pig-win': '돼지 1등', 'pig-lose': '돼지 꼴찌', water: '물판' }[r.kind];
  const rows = r.ranks.map((seat, i) => {
    const d = r.deltas[seat];
    const place = r.earlyEnd && i >= r.decided ? '—' : `${i + 1}등`;
    return `<tr${seat === v.me ? ' class="mine"' : ''}><td>${place}</td><td>${esc(nm(seat))}</td><td>${T[r.teams[seat]]}</td><td class="num ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d > 0 ? '+' : ''}${d}</td><td class="num">${r.eggs[seat]}</td></tr>`;
  }).join('');
  const notes = [`배수 ×${r.multiplier}`, `묻어둔 알 ${r.buried}`];
  if (r.earlyEnd) notes.unshift('결과가 정해져 조기 종료');
  if (r.careSurvived === true) notes.push('배려판 생존');
  if (r.careSurvived === false) notes.push('배려판 실패');
  let tail = '';
  let foot = '';
  if (r.ended) {
    const reason = r.endReason === 'multiple-care' ? '두 명 이상이 동시에 파산해 게임이 끝났습니다' : `${r.eliminated.map(nm).join(', ')} 탈락으로 게임이 끝났습니다`;
    tail = `<p class="psub">${reason}</p><ol class="final">${r.standings!.map((s) => `<li><b>${s.place}위</b> ${esc(s.nickname)} <span class="num">${s.eggs}알</span></li>`).join('')}</ol>`;
    foot = v.host === v.me ? '<button type="button" class="btn primary" id="rematchBtn">같은 멤버로 새 게임</button>' : '<p class="psub">방장이 새 게임을 열 수 있어요</p>';
  } else {
    if (r.nextCare !== null) tail = `<p class="psub">다음 판은 <b>${esc(nm(r.nextCare))}</b>의 배려판입니다. 알을 1개 이상 얻어야 살아남아요.</p>`;
    const imReady = r.ready.includes(v.me);
    foot = `<button type="button" class="btn primary" id="readyBtn" ${imReady ? 'disabled' : ''}>${imReady ? '다른 사람을 기다리는 중' : '다시 한 판 더'}</button>
      <button type="button" class="btn" id="shuffleBtn" ${r.shufflePending ? 'disabled' : ''}>${r.shufflePending ? '다음 판에 자리가 바뀌어요' : '자리 바꾸기'}</button>
      <span class="psub" id="countdown"></span>`;
  }
  return `<div class="overlay" role="dialog" aria-modal="true" aria-label="판 결과"><div class="sheet">
    <p class="eyebrow">${v.game?.handNo ?? ''}판 결과</p><h2>${title}</h2>
    <div class="tablewrap"><table><thead><tr><th>순위</th><th>이름</th><th>팀</th><th>증감</th><th>누적 알</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="psub">${notes.join(' · ')}</p>${tail}<div class="prow">${foot}</div></div></div>`;
}

function gameHtml(v: View) {
  const g = v.game!;
  const pos = (k: number) => (v.me + k) % 4; // 반시계: 오른쪽 → 위 → 왼쪽
  const buried = Math.min(g.buried, 24);
  const log = [...v.log].reverse().map((l) => logText(l.ev)).filter(Boolean) as string[];
  return `
  <header class="top">
    <div class="brand"><span class="logo">사사끼</span><span class="sub">방 ${v.code}</span></div>
    <div class="meta">
      <span>${g.handNo}판</span><span>×${g.multiplier}</span>
      <span class="buried" title="묻어둔 알 ${g.buried}개">${Array.from({ length: buried }, () => '<i></i>').join('')}<em>${g.buried}</em></span>
      <button type="button" class="btn ghost small" id="soundBtn" aria-pressed="${soundOn}">소리 ${soundOn ? '켜짐' : '꺼짐'}</button>
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
  app.innerHTML = html + (toastMsg ? `<div class="toast" role="status">${esc(toastMsg)}</div>` : '');
  updateCountdown();
}

function updateCountdown() {
  const el = document.getElementById('countdown');
  const r = view?.result;
  if (!el || !r || r.ended) return;
  const left = Math.ceil((r.nextAt - now()) / 1000);
  el.textContent = left <= 3 ? ` ${Math.max(1, left)}` : ` ${left}초 뒤 다음 판`;
  el.classList.toggle('count', left <= 3);
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
  const card = t.closest<HTMLElement>('[data-card]');
  if (card) {
    const c = card.dataset.card!;
    selected.has(c) ? selected.delete(c) : selected.add(c);
    sendSelection();
    render();
    return;
  }
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
  else if (id === 'shuffleBtn') socket.emit('shuffle', null, (r: any) => { if (!r?.ok && r?.reason) toast(r.reason); });
  else if (id === 'copyBtn') {
    const input = document.getElementById('linkIn') as HTMLInputElement;
    navigator.clipboard?.writeText(input.value).then(() => toast('초대 링크를 복사했어요'), () => { input.select(); toast('링크를 길게 눌러 복사하세요'); });
    if (!navigator.clipboard) { input.select(); toast('링크를 길게 눌러 복사하세요'); }
  } else if (id === 'soundBtn') {
    soundOn = !soundOn;
    store.set('sasaki-sound', soundOn ? 'on' : 'off');
    if (soundOn) ensureAudio(); else { tickTimers.forEach(clearTimeout); tickTimers = []; tickKey = ''; }
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
