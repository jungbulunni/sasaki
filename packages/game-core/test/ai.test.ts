import { describe, expect, it } from 'vitest';
import { seededRng } from '../src/cards';
import { aiDecide, aiView, AI_NAMES } from '../src/ai';
import { applyHandAction, HandAction, HandState, hasNoPlay } from '../src/hand';
import { createMatch, finishHand, startHand } from '../src/match';
import { ok, play, setup } from './helpers';

/** 네 자리 모두 AI로 한 게임 끝까지 */
function aiMatch(seed: number) {
  const rng = seededRng(seed);
  let m = createMatch(['가', '나', '다', '라'], 8);
  let rejected = 0, hands = 0, steps = 0;
  while (m.status === 'playing' && hands < 300) {
    const s = startHand(m, rng, 12);
    m = s.match;
    let h: HandState = s.hand;
    while (h.phase !== 'hand-over') {
      if (++steps > 200000) throw new Error('무한 루프');
      let a: HandAction | null = null;
      // 순서 밖(찼다·창)부터 확인, 없으면 차례인 사람
      for (const seat of [0, 1, 2, 3]) {
        const d = aiDecide(aiView(h, seat), rng);
        if (d && (d.type !== 'play' && d.type !== 'pass' || seat === h.activeSeat)) { a = d; break; }
      }
      if (!a) a = hasNoPlay(h) ? { type: 'pass', seat: h.activeSeat } : { type: 'windowTimeout' };
      const r = applyHandAction(h, a);
      if (!r.ok) { rejected++; if (a.type !== 'windowTimeout') throw new Error(`AI 행동 거절: ${a.type} ${r.reason}`); continue; }
      h = r.state;
    }
    m = finishHand(m, h).match;
    hands++;
  }
  return { m, hands, rejected };
}

describe('AI', () => {
  it('AI 넷이 100게임을 끝까지, 규칙 위반 행동 0건', () => {
    let hands = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const r = aiMatch(seed);
      expect(r.m.status).toBe('ended');
      hands += r.hands;
    }
    expect(hands).toBeGreaterThan(100);
  }, 60_000);

  it('AI는 다른 사람의 주패를 보지 않는다 (남의 패가 달라도 같은 판단)', () => {
    const a = setup([['S5', 'S9', 'H9', 'C12'], ['S3', 'S4', 'H4'], ['S6', 'S7'], ['S8', 'C3']]);
    const b = setup([['S5', 'S9', 'H9', 'C12'], ['S6', 'S7', 'C4'], ['S3', 'S4'], ['H4', 'S8', 'C3']]);
    for (let seed = 1; seed <= 30; seed++) {
      expect(aiDecide(aiView(a, 0), seededRng(seed))).toEqual(aiDecide(aiView(b, 0), seededRng(seed)));
    }
  });

  it('받아칠 때는 이길 수 있는 가장 약한 패, 선일 때는 낮은 패부터', () => {
    let st = setup([['S3', 'S12'], ['S6', 'S9', 'S11', 'H5'], ['S4'], ['S5']]);
    st = ok(st, play(0, 'S3'));
    const d = aiDecide(aiView(st, 1), seededRng(1));
    expect(d).toEqual(play(1, 'H5')); // 5·6·9·J 중 가장 약한 5
  });

  it('틀·마대는 초반에 아끼고, 꽂을 수 있으면 꽂는다', () => {
    let st = setup([['S3', 'S12', 'C4', 'C5'], ['S7', 'H7', 'D7', 'S4', 'S5', 'S6', 'S8', 'S9'], ['S11', 'C6', 'C7'], ['S13', 'C8', 'C9']]);
    st = ok(st, play(0, 'S12'));
    const d = aiDecide(aiView(st, 1), seededRng(3));
    expect(d?.type === 'pass' || (d?.type === 'play' && d.cards.length === 1)).toBe(true);
    let k = setup([['S8', 'S3', 'H10'], ['S9', 'D10'], ['H8', 'D8', 'H3'], ['C8', 'C3']]);
    k = ok(k, play(0, 'S8'));
    k = ok(k, { type: 'chatda', seat: 2, cards: ['H8', 'D8'] });
    expect(aiDecide(aiView(k, 3), seededRng(1))).toEqual({ type: 'kkotda', seat: 3 });
  });

  it('상대가 곧 나갈 것 같으면 틀도 쓴다', () => {
    let st = setup([['S3', 'S12'], ['S7', 'H7', 'D7', 'S4', 'S5', 'S6', 'S8', 'S9'], ['S11'], ['S13']]);
    st = ok(st, play(0, 'S12')); // 0번은 2장 남음
    const d = aiDecide(aiView(st, 1), seededRng(3));
    expect(d).toMatchObject({ type: 'play', cards: ['S7', 'H7', 'D7'] });
  });

  it('[전략] 틀을 깨게 되는 찼다는 대부분 아낀다', () => {
    let kept = 0;
    for (let i = 0; i < 40; i++) {
      const extra = ['C3', 'C4', 'C5', 'C6', 'C7', 'C9', 'C11', 'C12', 'C13'].slice(0, 2 + (i % 6));
      let st = setup([['S8', 'S3', 'H4', 'H5'], ['S12', 'D3', 'D4'], ['H8', 'D8', 'C8', ...extra], ['S13', 'D5', 'D6', 'D7']]);
      st = ok(st, play(0, 'S8'));
      const d = aiDecide(aiView(st, 2), seededRng(i));
      if (d?.type !== 'chatda') kept++;
    }
    expect(kept).toBeGreaterThan(20);
  });

  it('[전략] 평범한 페어면 대부분 찬다', () => {
    let took = 0;
    for (let i = 0; i < 40; i++) {
      const extra = ['C3', 'C4', 'C6', 'S7', 'C11', 'C12', 'C13', 'S5'].slice(0, 2 + (i % 6));
      let st = setup([['S8', 'S3', 'H4', 'H5'], ['S12', 'D3', 'D4'], ['H8', 'D8', ...extra], ['S13', 'D5', 'D6', 'D7']]);
      st = ok(st, play(0, 'S8'));
      if (aiDecide(aiView(st, 2), seededRng(i))?.type === 'chatda') took++;
    }
    expect(took).toBeGreaterThan(28);
  });

  it('[전략] 같은 기회에는 같은 결정 (상황이 그대로면 마음이 바뀌지 않음)', () => {
    let st = setup([['S8', 'S3', 'H4', 'H5'], ['S12', 'D3', 'D4'], ['H8', 'D8', 'C8', 'C3', 'C4'], ['S13', 'D5', 'D6', 'D7']]);
    st = ok(st, play(0, 'S8'));
    const first = aiDecide(aiView(st, 2), seededRng(1))?.type;
    for (let i = 2; i < 20; i++) expect(aiDecide(aiView(st, 2), seededRng(i))?.type).toBe(first);
  });

  it('[전략] 찰 수 있는 걸 아꼈고 낼 패가 없으면 직접 패스', () => {
    let st = setup([['S8', 'S3', 'H4', 'H5'], ['H8', 'D8', 'C8', 'D3', 'D4'], ['S12', 'H3'], ['S13', 'D5', 'D6', 'D7']]);
    st = ok(st, play(0, 'S8'));
    const d = aiDecide(aiView(st, 1), seededRng(1));
    expect(['chatda', 'pass']).toContain(d?.type);
  });

  it('AI 이름은 모두 5자 이내, 서로 다름, 100개 이상', () => {
    expect(new Set(AI_NAMES).size).toBe(AI_NAMES.length);
    expect(AI_NAMES.every((n) => n.length <= 5)).toBe(true);
    expect(AI_NAMES.length).toBeGreaterThanOrEqual(100);
  });

  /** 0번이 숫자 r 싱글을 내고, 1번이 r 페어, 3번이 네 번째 r 카드를 가진 상황을 여러 번 만들어 찼다 비율을 잰다 */
  function chatdaRate(r: number, fourthSeen: boolean) {
    const rng = seededRng(r * 7 + (fourthSeen ? 1 : 0));
    const pool = [3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14].filter((x) => Math.abs(x - r) > 2)
      .flatMap((x) => ['S', 'H', 'D', 'C'].map((su) => `${su}${x}`));
    let took = 0;
    const N = 120;
    for (let i = 0; i < N; i++) {
      const p = [...pool].sort(() => rng() - 0.5);
      const hands = [[`S${r}`, ...p.slice(0, 5)], [`H${r}`, `D${r}`, ...p.slice(5, 10)], p.slice(10, 15), [...p.slice(15, 20)]];
      if (fourthSeen) hands[0].push(`C${r}`); else hands[3].push(`C${r}`);
      let st = setup(hands);
      if (fourthSeen) {
        // 네 번째 카드를 먼저 한 바퀴 돌려 모두가 보게 한 뒤, 0번이 다시 선을 잡아 r 싱글
        st = ok(st, play(0, `C${r}`));
        for (const s of [1, 2, 3]) st = ok(st, { type: 'pass', seat: s });
      }
      st = ok(st, play(0, `S${r}`));
      if (aiDecide(aiView(st, 1), seededRng(i))?.type === 'chatda') took++;
    }
    return took / N;
  }

  it('[전략] 네 번째 카드가 안 나왔으면 A·K 페어로 찼다 하지 않는다 (꽂다 당하면 손해)', () => {
    expect(chatdaRate(14, false)).toBeLessThan(0.08);
    expect(chatdaRate(13, false)).toBeLessThan(0.1);
  });

  it('[전략] 낮은 페어는 적극적으로 찬다', () => {
    expect(chatdaRate(4, false)).toBeGreaterThan(0.55);
    expect(chatdaRate(4, true)).toBeGreaterThan(0.85);
  });

  it('[전략] 네 번째 카드가 이미 나왔으면 높은 페어도 가끔 찬다', () => {
    const rate = chatdaRate(14, true);
    expect(rate).toBeGreaterThan(0.12);
    expect(rate).toBeLessThan(0.5);
  });
});
