// M2 로컬 프로토타입: 한 브라우저에서 네 자리를 전환하며 플레이.
// 모든 판정은 packages/game-core (M1에서 테스트된 엔진)가 한다.

import {
  applyHandAction, canBeat, cardLabel, CardId, classifyCombo, COMBO_NAME, createMatch, finalStandings,
  AUTO_PASS_MS, finishHand, hasNoPlay, isFinishBlocked, HandAction, HandEvent, HandOutcome, HandState, isFire, MatchState, rankOf, seededRng,
  sortHand, specialOptions, startHand, suitOf, teamOf,
} from '../../../packages/game-core/src/index';

type Snapshot = { match: MatchState; hand: HandState; lastHand: HandState | null; outcome: HandOutcome | null; log: string[] };

const rng = seededRng((Date.now() ^ (Math.random() * 1e9)) >>> 0);
const DEFAULT_NAMES = ['한빛', '두리', '세나', '네오'];

let match: MatchState;
let hand: HandState;
let lastHand: HandState | null = null;
let outcome: HandOutcome | null = null;
let log: string[] = [];
let viewSeat = 0;
let follow = true;
let selected = new Set<CardId>();
let toastMsg = '';
let toastTimer = 0;
let showSetup = false;

const app = document.getElementById('app')!;
const shoutEl = document.getElementById('shout')!;

function kstHour(): number {
  const h = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hourCycle: 'h23' }).format(new Date());
  return Number(h) % 24;
}

function newMatch(names: string[], eggs: number) {
  match = createMatch(names, eggs);
  log = [];
  outcome = null;
  lastHand = null;
  beginHand();
}

function beginHand() {
  const s = startHand(match, rng, kstHour());
  match = s.match;
  hand = s.hand;
  outcome = null;
  selected.clear();
  const care = match.careSeat;
  log.unshift(`── ${match.handNo}판 시작 · 선 ${nm(hand.leaderSeat)}${care !== null ? ` · ${nm(care)} 배려판` : ''} ──`);
  if (follow) viewSeat = hand.leaderSeat;
  render();
}

const nm = (s: number) => match.players[s].nickname;

// ───── 행동 처리 ─────

function act(a: HandAction) {
  const r = applyHandAction(hand, a);
  if (!r.ok) { toast(r.reason); return; }
  hand = r.state;
  selected.clear();
  narrate(r.events);
  if (hand.phase === 'hand-over') {
    lastHand = hand;
    const f = finishHand(match, hand);
    match = f.match;
    outcome = f.outcome;
  } else if (follow) viewSeat = focusSeat();
  render();
}

/** '차례 따라가기' 켜면 지금 결정할 사람의 자리로 화면 전환 */
function focusSeat(): number {
  if (hand.window) return hand.window.seat;
  if (hand.phase === 'turn') return hand.activeSeat;
  return viewSeat;
}

const VIA: Record<string, string> = { play: '', chatda: '찼다!', mureugi: '찼다!', kkotda: '꽂다!', blackpig: '흑돼지!' };
const SHOUT: Partial<Record<HandEvent['type'], string>> = {
  pig: '돼지!', blackPig: '흑돼지!', fireAlarm: '불이야!', noKkot: '안 꽂아!', run: '달리기!', ddook: '뚝!',
};

function narrate(events: HandEvent[]) {
  let shout = '';
  for (const e of events) {
    switch (e.type) {
      case 'played': {
        const combo = classifyCombo(e.cards)!;
        const kind = e.via === 'blackpig' ? '흑돼지' : COMBO_NAME[combo.kind];
        log.unshift(`${nm(e.seat)} ${VIA[e.via] ? VIA[e.via] + ' ' : ''}${e.cards.map(cardLabel).join(' ')} · ${kind}`);
        if (VIA[e.via]) shout = VIA[e.via];
        break;
      }
      case 'passed': log.unshift(`${nm(e.seat)} 패스`); break;
      case 'fireAlarm': log.unshift(`불이야! ${nm(e.seat)}의 불 공개`); break;
      case 'pig': log.unshift(`돼지! ${nm(e.seat)}가 불돼지`); break;
      case 'blackPig': break;
      case 'noKkot': log.unshift('안 꽂아!'); break;
      case 'returned': break; // 찼다! 만으로 충분히 알 수 있어 따로 표시하지 않음
      case 'finished': log.unshift(`${nm(e.seat)} ${e.rank}등 완주`); break;
      case 'finishCanceled': log.unshift(`${nm(e.seat)} 완주 취소`); break;
      case 'run': log.unshift(`${nm(e.seat)} 달리기! 배수 ×2`); break;
      case 'ddook': log.unshift(`${nm(e.seat)} 뚝! 배수 ×4`); break;
      case 'trickCleared': log.unshift(`더미 정리 · ${nm(e.leader)} 선`); break;
      case 'handOver': log.unshift(e.early ? '결과가 정해져 판 종료' : '판 종료'); break;
    }
    if (SHOUT[e.type]) shout = SHOUT[e.type]!;
  }
  log = log.slice(0, 80);
  if (shout) doShout(shout);
}

function doShout(text: string) {
  shoutEl.textContent = text;
  shoutEl.classList.remove('on');
  void shoutEl.offsetWidth;
  shoutEl.classList.add('on');
}

function toast(msg: string) {
  toastMsg = msg;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toastMsg = ''; render(); }, 2200);
  render();
}

// ───── 그리기 ─────

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const RANK = (r: number) => ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' } as Record<number, string>)[r] ?? String(r);
const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' } as const;

function cardHtml(c: CardId, opts: { sel?: boolean; small?: boolean; button?: boolean } = {}) {
  const red = suitOf(c) === 'H' || suitOf(c) === 'D';
  const cls = `card${red ? ' red' : ''}${opts.sel ? ' sel' : ''}${opts.small ? ' small' : ''}${isFire(c) ? ' fire' : ''}`;
  const inner = `<span class="rk">${RANK(rankOf(c))}</span><span class="st">${SUIT[suitOf(c)]}</span>`;
  return opts.button
    ? `<button type="button" class="${cls}" data-card="${c}" aria-pressed="${!!opts.sel}" aria-label="${cardLabel(c)}">${inner}</button>`
    : `<span class="${cls}" aria-label="${cardLabel(c)}">${inner}</span>`;
}

function seatBadges(s: number): string {
  const b: string[] = [];
  const over = hand.phase === 'hand-over';
  if (!over && hand.phase === 'turn' && hand.activeSeat === s) b.push('<i class="chip turn">차례</i>');
  if (!over && hand.leaderSeat === s && hand.trick.length === 0 && hand.phase === 'turn') b.push('<i class="chip">선</i>');
  const fin = hand.finished.indexOf(s);
  if (fin >= 0) b.push(`<i class="chip done">${fin + 1}등</i>`);
  if (hand.provisional === s) b.push('<i class="chip warn">잠정 완주</i>');
  if (hand.revealedFire.includes(s)) b.push(`<i class="chip firechip">${hand.teamMode === 'pig-1v3' ? '돼지' : '불'}</i>`);
  if (hand.runner === s) b.push('<i class="chip">달림</i>');
  if (hand.ddooker === s) b.push('<i class="chip">뚝</i>');
  if (match.careSeat === s && !over) b.push('<i class="chip warn">배려판</i>');
  if (hand.window?.seat === s) b.push(`<i class="chip turn">${hand.window.type === 'kkotda' ? '꽂다 선택' : '흑돼지 선택'}</i>`);
  if (specialOptions(hand, s).length) b.push(`<i class="chip spec">찰 수 있음</i>`);
  return b.join('');
}

function seatHtml(s: number, pos: string) {
  const n = hand.hands[s].length;
  const backs = Array.from({ length: Math.min(n, 12) }, () => '<span class="back"></span>').join('');
  return `<button type="button" class="seat ${pos}${s === viewSeat ? ' viewing' : ''}" data-view="${s}" aria-label="${esc(nm(s))} 자리 보기">
    <span class="sname">${esc(nm(s))}</span>
    <span class="seggs"><b>${match.players[s].eggs}</b>알 · ${n}장</span>
    <span class="backs">${backs}</span>
    <span class="badges">${seatBadges(s)}</span>
  </button>`;
}

function trickHtml() {
  if (hand.phase === 'hand-over') return '<p class="pile-note">판이 끝났습니다</p>';
  if (!hand.trick.length) {
    if (hand.phase === 'turn') return `<p class="pile-note"><b>${esc(nm(hand.leaderSeat))}</b> 선 · 아무 조합이나 낼 수 있어요</p>`;
    return '<p class="pile-note">분배 완료</p>';
  }
  const plays = hand.trick.slice(-4);
  return plays.map((p, i) => {
    const last = i === plays.length - 1;
    const label = p.via === 'blackpig' ? '흑돼지' : COMBO_NAME[p.combo.kind];
    return `<div class="play${last ? ' last' : ''}">
      <div class="pcards">${p.combo.cards.map((c) => cardHtml(c, { small: !last })).join('')}</div>
      <span class="pby">${esc(nm(p.seat))} · ${label}${VIA[p.via] ? ' · ' + VIA[p.via] : ''}</span>
    </div>`;
  }).join('');
}

function windowPanel(): string {
  if (hand.phase === 'run-declare') {
    const btns = hand.fireOwners.map((s) => `<button type="button" class="btn hot" data-act='${JSON.stringify({ type: 'declareRun', seat: s })}'>${esc(nm(s))} 달리기</button>`).join('');
    return `<div class="panel"><p class="ptitle">달릴 사람 있나요?</p><p class="psub">불을 가진 사람만 선언할 수 있어요. 선언하면 배수 ×2, 불이 공개됩니다.</p>
      <div class="prow">${btns}<button type="button" class="btn" data-act='{"type":"windowTimeout"}'>아무도 안 달림 (5초 경과)</button></div></div>`;
  }
  if (hand.phase === 'ddook-declare') {
    const opp = [0, 1, 2, 3].filter((s) => teamOf(hand, s) !== teamOf(hand, hand.runner!));
    const btns = opp.map((s) => `<button type="button" class="btn hot" data-act='${JSON.stringify({ type: 'declareDdook', seat: s })}'>${esc(nm(s))} 뚝</button>`).join('');
    return `<div class="panel"><p class="ptitle">뚝?</p><p class="psub">${esc(nm(hand.runner!))}가 달립니다. 반대편 한 명이 뚝을 외치면 배수 ×4.</p>
      <div class="prow">${btns}<button type="button" class="btn" data-act='{"type":"windowTimeout"}'>뚝 없음 (5초 경과)</button></div></div>`;
  }
  const w = hand.window;
  if (w?.type === 'kkotda') {
    return `<div class="panel"><p class="ptitle">${esc(nm(w.seat))}, 꽂을까요?</p>
      <div class="pcards">${w.cards.map((c) => cardHtml(c)).join('')}</div>
      <div class="prow"><button type="button" class="btn hot" data-act='${JSON.stringify({ type: 'kkotda', seat: w.seat })}'>꽂다</button>
      <button type="button" class="btn" data-act='${JSON.stringify({ type: 'kkotdaPass', seat: w.seat })}'>안 꽂아</button></div></div>`;
  }
  if (w?.type === 'blackpig') {
    return `<div class="panel"><p class="ptitle">${esc(nm(w.seat))}, 흑돼지로 막을까요?</p>
      <div class="pcards">${['S10', 'C10'].map((c) => cardHtml(c)).join('')}</div>
      <div class="prow"><button type="button" class="btn hot" data-act='${JSON.stringify({ type: 'blackPigSubmit', seat: w.seat })}'>흑돼지 제출</button>
      <button type="button" class="btn" data-act='${JSON.stringify({ type: 'blackPigPass', seat: w.seat })}'>통과</button></div></div>`;
  }
  return '';
}

function selectionStatus(): { text: string; canPlay: boolean; none?: boolean } {
  if (hand.phase !== 'turn') return { text: '', canPlay: false };
  if (hand.activeSeat !== viewSeat) return { text: `${nm(hand.activeSeat)}의 차례예요`, canPlay: false };
  if (hasNoPlay(hand)) return { text: '낼 수 있는 패가 없습니다', canPlay: false, none: true };
  const cards = [...selected];
  if (!cards.length) return { text: hand.trick.length ? '카드를 고르거나 패스하세요' : '선입니다. 카드를 고르세요', canPlay: false };
  const combo = classifyCombo(cards);
  if (!combo) return { text: '허용되지 않는 조합', canPlay: false };
  const top = hand.trick.at(-1)?.combo ?? null;
  const name = COMBO_NAME[combo.kind] + (combo.kind === 'nilliri' ? ` ${combo.length}장` : combo.kind === 'ssangka' ? ` ${combo.length}쌍` : '');
  if (!canBeat(combo, top)) return { text: `${name} · 현재 공격보다 약함`, canPlay: false };
  if (isFinishBlocked(hand, viewSeat, cards)) return { text: `${name} · 틀 이상은 마지막에 낼 수 없어요`, canPlay: false, none: true };
  return { text: `${name} · 낼 수 있음`, canPlay: true };
}

function handHtml() {
  const s = viewSeat;
  const cards = sortHand(hand.hands[s]);
  const status = selectionStatus();
  const specials = specialOptions(hand, s);
  const myTurn = hand.phase === 'turn' && hand.activeSeat === s;
  const specialBtns = specials.map((o) => `<button type="button" class="btn spec" data-act='${JSON.stringify({ type: o.type, seat: s, cards: o.cards })}'>${o.type === 'chatda' ? '찼다' : '차기'} ${o.cards.map(cardLabel).join(' ')}</button>`).join('');
  return `<section class="me" aria-label="${esc(nm(s))}의 주패">
    <div class="me-head">
      <span class="me-name">${esc(nm(s))}의 주패 <small>${cards.length}장${hand.teamMode && hand.phase !== 'hand-over' ? '' : ''}</small></span>
      <span class="status${status.canPlay ? ' good' : ''}${status.none ? ' none' : ''}">${esc(status.text)}</span>
    </div>
    ${noPlayBanner()}
    <div class="hand">${cards.map((c) => cardHtml(c, { sel: selected.has(c), button: true })).join('') || '<p class="pile-note">카드를 모두 냈어요</p>'}</div>
    <div class="actions">
      <button type="button" class="btn primary" id="playBtn" ${status.canPlay ? '' : 'disabled'}>제출</button>
      <button type="button" class="btn" id="passBtn" ${myTurn && hand.trick.length ? '' : 'disabled'}>패스</button>
      ${specialBtns}
      ${selected.size ? '<button type="button" class="btn ghost" id="clearBtn">선택 해제</button>' : ''}
    </div>
  </section>`;
}

function resultHtml(): string {
  if (!outcome || !lastHand) return '';
  const h = lastHand;
  const s = outcome.settlement;
  const kindText = {
    'win-2v2': `${teamOf(h, h.ranks![0]) === 'fire' ? '불팀' : '흑팀'} 승리`,
    'pig-win': '돼지 1등', 'pig-lose': '돼지 꼴찌', water: '물판',
  }[s.kind];
  const teamName = (seat: number) => ({ fire: '불팀', black: '흑팀', pig: '돼지' })[teamOf(h, seat)];
  const rows = h.ranks!.map((seat, i) => {
    const d = s.deltas[seat];
    const place = h.earlyEnd && i >= h.finished.length ? '—' : `${i + 1}등`;
    return `<tr><td>${place}</td><td>${esc(nm(seat))}</td><td>${teamName(seat)}</td>
      <td class="num ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d > 0 ? '+' : ''}${d}</td><td class="num">${match.players[seat].eggs}</td></tr>`;
  }).join('');
  const notes: string[] = [`배수 ×${h.multiplier}`, `묻어둔 알 ${match.buried}`];
  if (h.earlyEnd) notes.unshift('결과가 정해져 조기 종료');
  if (outcome.careSurvived === true) notes.push('배려판 생존');
  if (outcome.careSurvived === false) notes.push('배려판 실패');
  let foot = `<button type="button" class="btn primary" id="nextBtn">다음 판</button>`;
  let tail = '';
  if (match.status === 'playing' && match.careSeat !== null) tail = `<p class="psub">다음 판은 <b>${esc(nm(match.careSeat))}</b>의 배려판입니다. 알을 1개 이상 얻어야 살아남아요.</p>`;
  if (match.status === 'ended') {
    const reason = match.endReason === 'multiple-care' ? '두 명 이상이 동시에 파산해 게임이 끝났습니다' : `${match.eliminated.map(nm).join(', ')} 탈락으로 게임이 끝났습니다`;
    const st = finalStandings(match).map((r) => `<li><b>${r.place}위</b> ${esc(r.nickname)} <span class="num">${r.eggs}알</span></li>`).join('');
    tail = `<p class="psub">${reason}</p><ol class="final">${st}</ol>`;
    foot = `<button type="button" class="btn primary" id="newBtn">새 게임</button>`;
  }
  return `<div class="overlay" role="dialog" aria-modal="true" aria-label="판 결과"><div class="sheet">
    <p class="eyebrow">${match.handNo}판 결과</p><h2>${kindText}</h2>
    <div class="tablewrap"><table><thead><tr><th>순위</th><th>이름</th><th>팀</th><th>증감</th><th>누적 알</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="psub">${notes.join(' · ')}</p>${tail}<div class="prow">${foot}</div></div></div>`;
}

function setupHtml(): string {
  if (!showSetup) return '';
  const inputs = [0, 1, 2, 3].map((i) => `<label class="field"><span>${i + 1}번 자리</span><input id="nick${i}" maxlength="8" value="${esc(match.players[i]?.nickname ?? DEFAULT_NAMES[i])}"></label>`).join('');
  return `<div class="overlay" role="dialog" aria-modal="true" aria-label="새 게임"><form class="sheet" id="setupForm">
    <p class="eyebrow">새 게임</p><h2>네 자리 이름과 시작 알</h2>
    <div class="fields">${inputs}<label class="field"><span>시작 알</span><input id="eggsIn" type="number" min="1" max="999" value="10"></label></div>
    <div class="prow"><button type="submit" class="btn primary">시작</button><button type="button" class="btn ghost" id="cancelSetup">취소</button></div>
  </form></div>`;
}

// ───── 소리 (개인별 켜기/끄기) ─────
let soundOn = (() => { try { return localStorage.getItem('sasaki-sound') !== 'off'; } catch { return true; } })();
let audio: AudioContext | null = null;
function ensureAudio() {
  if (!soundOn) return;
  try {
    audio ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (audio.state === 'suspended') void audio.resume();
  } catch { audio = null; }
}
/** 째각 소리 한 번: 짧은 나무 시계 소리 (high = 째, low = 각) */
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
  o.start(t);
  o.stop(t + 0.06);
}

// ───── 낼 수 있는 패가 없으면 2초 뒤 자동 패스 (그 사이 상태가 바뀌면 취소) ─────
let autoPassTimer = 0;
let autoPassFor: HandState | null = null;
let autoPassStart = 0;
let tickTimers: number[] = [];
function stopTicks() { tickTimers.forEach(clearTimeout); tickTimers = []; }
function scheduleAutoPass() {
  if (!hand || outcome || !hasNoPlay(hand)) { clearTimeout(autoPassTimer); stopTicks(); autoPassFor = null; return; }
  if (autoPassFor === hand) return;
  clearTimeout(autoPassTimer);
  stopTicks();
  autoPassFor = hand;
  autoPassStart = performance.now();
  for (let i = 0; i < 4; i++) tickTimers.push(window.setTimeout(() => tick(i % 2 === 0), i * (AUTO_PASS_MS / 4)));
  const h = hand;
  autoPassTimer = window.setTimeout(() => {
    autoPassFor = null;
    if (hand === h && hasNoPlay(hand) && !outcome) act({ type: 'pass', seat: hand.activeSeat });
  }, AUTO_PASS_MS);
}

/** 주패 위에 크게 띄우는 안내: 째각째각 시계가 2초 동안 한 바퀴 */
function noPlayBanner(): string {
  if (!hasNoPlay(hand) || hand.activeSeat !== viewSeat || outcome) return '';
  const elapsed = Math.min(AUTO_PASS_MS, performance.now() - autoPassStart);
  const delay = `animation-delay:-${elapsed.toFixed(0)}ms;animation-duration:${AUTO_PASS_MS}ms`;
  return `<div class="nopass" role="status">
    <svg class="clock" viewBox="0 0 48 48" aria-hidden="true">
      <circle class="face" cx="24" cy="24" r="21"></circle>
      <circle class="sweep" cx="24" cy="24" r="17" pathLength="100" style="${delay}"></circle>
      <line class="hand" x1="24" y1="24" x2="24" y2="9" style="${delay}"></line>
      <circle class="pin" cx="24" cy="24" r="2.4"></circle>
    </svg>
    <span class="nopass-text"><b>낼 수 있는 패가 없습니다</b></span>
  </div>`;
}

function render() {
  scheduleAutoPass();
  const v = viewSeat;
  const pos = (k: number) => (v + k) % 4; // 반시계: 오른쪽 → 위 → 왼쪽
  const buried = Math.min(match.buried, 24);
  const tabs = [0, 1, 2, 3].map((s) => `<button type="button" class="tab${s === v ? ' on' : ''}" data-view="${s}">${esc(nm(s))}${specialOptions(hand, s).length ? '<i class="dot" aria-label="순서 밖 행동 가능"></i>' : ''}</button>`).join('');
  const phaseText = hand.phase === 'run-declare' ? '달리기 선언' : hand.phase === 'ddook-declare' ? '뚝 선언' : hand.window ? '특수 대응 대기' : hand.phase === 'hand-over' ? '판 종료' : '진행 중';
  app.innerHTML = `
  <header class="top">
    <div class="brand"><span class="logo">사사끼</span><span class="sub">로컬 시험판 · 한 화면 4자리</span></div>
    <div class="meta">
      <span>${match.handNo}판</span><span>×${hand.multiplier}</span><span>${phaseText}</span>
      <span class="buried" title="묻어둔 알 ${match.buried}개">${Array.from({ length: buried }, () => '<i></i>').join('')}<em>${match.buried}</em></span>
      <button type="button" class="btn ghost small" id="soundBtn" aria-pressed="${soundOn}">소리 ${soundOn ? '켜짐' : '꺼짐'}</button>
      <button type="button" class="btn ghost small" id="setupBtn">새 게임</button>
    </div>
  </header>
  <main class="layout">
    <div class="tablearea">
      <div class="felt">
        ${seatHtml(pos(2), 'top')}${seatHtml(pos(3), 'left')}
        <div class="pile">${windowPanel() || trickHtml()}</div>
        ${seatHtml(pos(1), 'right')}${seatHtml(pos(0), 'bottom')}
      </div>
      <div class="viewbar"><span class="vlabel">보는 자리</span>${tabs}
        <label class="follow"><input type="checkbox" id="followIn" ${follow ? 'checked' : ''}> 차례 따라가기</label></div>
      ${handHtml()}
    </div>
    <aside class="log" aria-label="진행 기록"><p class="eyebrow">진행 기록</p><ol>${log.map((l) => `<li>${esc(l)}</li>`).join('')}</ol></aside>
  </main>
  ${toastMsg ? `<div class="toast" role="status">${esc(toastMsg)}</div>` : ''}
  ${resultHtml()}${setupHtml()}`;
}

// ───── 입력 ─────

app.addEventListener('click', (e) => {
  ensureAudio(); // 브라우저는 사용자가 한 번 누른 뒤에만 소리를 허용
  const t = e.target as HTMLElement;
  const card = t.closest<HTMLElement>('[data-card]');
  if (card) {
    const c = card.dataset.card!;
    selected.has(c) ? selected.delete(c) : selected.add(c);
    render();
    return;
  }
  const actBtn = t.closest<HTMLElement>('[data-act]');
  if (actBtn) { act(JSON.parse(actBtn.dataset.act!)); return; }
  const view = t.closest<HTMLElement>('[data-view]');
  if (view) { viewSeat = Number(view.dataset.view); follow = false; selected.clear(); render(); return; }
  const id = t.closest<HTMLElement>('button')?.id;
  if (id === 'playBtn') act({ type: 'play', seat: viewSeat, cards: [...selected] });
  else if (id === 'passBtn') act({ type: 'pass', seat: viewSeat });
  else if (id === 'clearBtn') { selected.clear(); render(); }
  else if (id === 'nextBtn') beginHand();
  else if (id === 'soundBtn') {
    soundOn = !soundOn;
    try { localStorage.setItem('sasaki-sound', soundOn ? 'on' : 'off'); } catch { /* 저장 불가해도 무시 */ }
    if (!soundOn) stopTicks(); else ensureAudio();
    render();
  }
  else if (id === 'newBtn' || id === 'setupBtn') { showSetup = true; render(); }
  else if (id === 'cancelSetup') { showSetup = false; render(); }
});

app.addEventListener('change', (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id === 'followIn') { follow = t.checked; if (follow) viewSeat = focusSeat(); render(); }
});

app.addEventListener('submit', (e) => {
  e.preventDefault();
  const names = [0, 1, 2, 3].map((i) => ((document.getElementById(`nick${i}`) as HTMLInputElement).value.trim() || DEFAULT_NAMES[i]));
  const eggs = Math.max(1, Math.floor(Number((document.getElementById('eggsIn') as HTMLInputElement).value) || 10));
  showSetup = false;
  newMatch(names, eggs);
});

// ───── 시작 (게시 페이지가 갱신돼도 진행 중인 판 유지) ─────

type Hot = { snapshot?: (f: () => unknown) => void; ready?: (f: (d: unknown) => void) => void; data?: unknown };
const hot = (window as unknown as { claude?: { hot?: Hot } }).claude?.hot;

function start(data: unknown) {
  const d = data as Partial<Snapshot> | undefined;
  if (d?.match && d.hand) {
    match = d.match; hand = d.hand; lastHand = d.lastHand ?? null; outcome = d.outcome ?? null; log = d.log ?? [];
    render();
  } else newMatch(DEFAULT_NAMES, 10);
}
hot?.snapshot?.(() => ({ match, hand, lastHand, outcome, log }));
if (hot?.ready) hot.ready(start); else start(hot?.data ?? {});
