import { describe, expect, it } from 'vitest';
import { settleHand, SettleInput } from '../src/settlement';

// 2v2 기본 설정: 불팀 = 0·1번, 흑팀 = 2·3번
const v2 = (ranks: number[], over: Partial<SettleInput> = {}) =>
  settleHand({ teamMode: 'fire-2v2', fireOwners: [0, 1], ranks, multiplier: 1, eggs: [10, 10, 10, 10], buried: 0, ...over });
const pig = (ranks: number[], over: Partial<SettleInput> = {}) =>
  settleHand({ teamMode: 'pig-1v3', fireOwners: [0], ranks, multiplier: 1, eggs: [10, 10, 10, 10], buried: 0, ...over });
const total = (o: { eggs: number[]; buried: number }) => o.eggs.reduce((a, b) => a + b, 0) + o.buried;

describe('2 대 2 정산', () => {
  it('같은 팀 1·2등: 승자 +2, 패자 -2', () => {
    expect(v2([0, 1, 2, 3]).deltas).toEqual([2, 2, -2, -2]);
  });
  it('같은 팀 1·3등: ±1', () => {
    expect(v2([0, 2, 1, 3]).deltas).toEqual([1, 1, -1, -1]);
  });
  it('같은 팀 1·4등: 물판', () => {
    const r = v2([0, 2, 3, 1]);
    expect(r.kind).toBe('water');
    expect(r.deltas).toEqual([0, 0, 0, 0]);
  });
  it('흑팀이 이겨도 같은 방식', () => {
    expect(v2([2, 3, 0, 1]).deltas).toEqual([-2, -2, 2, 2]);
  });
  it('달리기 ×2, 뚝 포함 ×4', () => {
    expect(v2([0, 1, 2, 3], { multiplier: 2 }).deltas).toEqual([4, 4, -4, -4]);
    expect(v2([0, 1, 2, 3], { multiplier: 4 }).deltas).toEqual([8, 8, -8, -8]);
  });
  it('각 4 지급 의무, 패자 잔액 10/2 → 승자 각 +2, 패자 -4/-2, 묻어둔 알 +2', () => {
    const r = v2([0, 1, 2, 3], { multiplier: 2, eggs: [5, 5, 10, 2] });
    expect(r.deltas).toEqual([2, 2, -4, -2]);
    expect(r.buried).toBe(2);
    expect(r.shortage).toEqual([false, false, false, true]);
  });
  it('[확정 일반식] 패자 둘 다 부족: 잔액 3/1, 의무 4 → 패자 -3/-1, 승자 각 +1, 묻어둔 알 +2', () => {
    const r = v2([0, 1, 2, 3], { multiplier: 2, eggs: [5, 5, 3, 1] });
    expect(r.deltas).toEqual([1, 1, -3, -1]);
    expect(r.buried).toBe(2);
    expect(r.shortage).toEqual([false, false, true, true]);
  });
});

describe('돼지 정산', () => {
  it('돼지 1등 +3 / 흑팀 각 -1', () => {
    expect(pig([0, 1, 2, 3]).deltas).toEqual([3, -1, -1, -1]);
  });
  it('돼지 2·3등 물판', () => {
    expect(pig([1, 0, 2, 3]).kind).toBe('water');
    expect(pig([1, 2, 0, 3]).kind).toBe('water');
  });
  it('돼지 4등 -3 / 흑팀 각 +1', () => {
    expect(pig([1, 2, 3, 0]).deltas).toEqual([-3, 1, 1, 1]);
  });
  it('돼지 승리: 흑팀 잔액 10/6/2, 각 4 의무 → 돼지 +10, 부족분 소멸', () => {
    const r = pig([0, 1, 2, 3], { multiplier: 4, eggs: [10, 10, 6, 2] });
    expect(r.deltas).toEqual([10, -4, -4, -2]);
    expect(r.shortage).toEqual([false, false, false, true]);
  });
  it('돼지 1등은 기존 묻어둔 알 전액 회수', () => {
    const r = pig([0, 1, 2, 3], { buried: 5 });
    expect(r.deltas[0]).toBe(3 + 5);
    expect(r.buried).toBe(0);
  });
  it('돼지 패배: 잔액 5, 세 명에게 각 4 의무 → 각 +1, 묻어둔 알 +2', () => {
    const r = pig([1, 2, 3, 0], { multiplier: 4, eggs: [5, 10, 10, 10] });
    expect(r.deltas).toEqual([-5, 1, 1, 1]);
    expect(r.buried).toBe(2);
    expect(r.shortage[0]).toBe(true);
  });
});

describe('알 보존', () => {
  it('모든 경우에서 (보유 알 + 묻어둔 알) 총합이 그대로', () => {
    const perms = [[0, 1, 2, 3], [0, 2, 1, 3], [0, 2, 3, 1], [2, 0, 3, 1], [1, 2, 3, 0], [3, 2, 1, 0]];
    for (const ranks of perms)
      for (const multiplier of [1, 2, 4] as const)
        for (const eggs of [[10, 10, 10, 10], [1, 0, 3, 7], [5, 2, 9, 1]])
          for (const mode of ['fire-2v2', 'pig-1v3'] as const) {
            const inp = { teamMode: mode, fireOwners: mode === 'pig-1v3' ? [0] : [0, 1], ranks, multiplier, eggs, buried: 3 };
            const r = settleHand(inp);
            expect(total(r)).toBe(total({ eggs, buried: 3 }));
            expect(r.eggs.every((e) => e >= 0)).toBe(true);
          }
  });
});
