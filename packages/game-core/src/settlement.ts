// 알 정산 — 순수 함수.
// 불변식: (모든 플레이어 알 합계 + 묻어둔 알) 은 정산 전후 동일.
// 지급 부족분은 '의무'만 사라지며, 존재하지 않는 알을 빼지 않는다.

export interface SettleInput {
  teamMode: 'fire-2v2' | 'pig-1v3';
  /** 2v2: 불팀 두 자리, 돼지: 돼지 한 자리 */
  fireOwners: number[];
  /** 1~4등 자리 순서 */
  ranks: number[];
  multiplier: 1 | 2 | 4;
  eggs: number[];
  buried: number;
}

export interface SettleOutput {
  kind: 'win-2v2' | 'pig-win' | 'pig-lose' | 'water'; // water = 물판
  /** 패자 한 명당 지급 의무 (돼지 패배는 흑팀 1명에게 줄 의무) */
  obligation: number;
  deltas: number[];
  eggs: number[];
  buried: number;
  /** 지급 의무를 다 못 낸 사람 */
  shortage: boolean[];
  winners: number[];
}

export function settleHand(inp: SettleInput): SettleOutput {
  const { ranks, multiplier, eggs } = inp;
  const deltas = [0, 0, 0, 0];
  const shortage = [false, false, false, false];
  let buried = inp.buried;
  const rankOf = (s: number) => ranks.indexOf(s) + 1;
  const finish = (kind: SettleOutput['kind'], obligation: number, winners: number[]): SettleOutput => ({
    kind, obligation, deltas, eggs: eggs.map((e, i) => e + deltas[i]), buried, shortage, winners,
  });

  if (inp.teamMode === 'fire-2v2') {
    const first = ranks[0];
    const team = inp.fireOwners.includes(first) ? inp.fireOwners : [0, 1, 2, 3].filter((s) => !inp.fireOwners.includes(s));
    const partner = team.find((s) => s !== first)!;
    const base = { 2: 2, 3: 1, 4: 0 }[rankOf(partner) as 2 | 3 | 4];
    const obligation = base * multiplier;
    if (obligation === 0) return finish('water', 0, []);
    const losers = [0, 1, 2, 3].filter((s) => !team.includes(s));
    // 패자는 낼 수 있는 만큼 → 승자는 두 패자 중 '적게 낸 금액'씩 동일하게 → 남는 알은 묻음
    const paid = losers.map((s) => Math.min(obligation, eggs[s]));
    const each = Math.min(...paid);
    losers.forEach((s, i) => { deltas[s] = -paid[i]; shortage[s] = paid[i] < obligation; });
    for (const w of team) deltas[w] = each;
    buried += paid[0] + paid[1] - 2 * each;
    return finish('win-2v2', obligation, [...team]);
  }

  const pig = inp.fireOwners[0];
  const blacks = [0, 1, 2, 3].filter((s) => s !== pig);
  const pigRank = rankOf(pig);
  const obligation = 1 * multiplier; // 기본: 돼지 ±3 = 흑팀 1명당 ±1

  if (pigRank === 1) {
    // 흑팀은 각자 가능한 만큼, 부족분 소멸. 돼지는 기존 묻어둔 알도 모두 가져감
    let total = 0;
    for (const b of blacks) {
      const p = Math.min(obligation, eggs[b]);
      deltas[b] = -p;
      shortage[b] = p < obligation;
      total += p;
    }
    deltas[pig] = total + buried;
    buried = 0;
    return finish('pig-win', obligation, [pig]);
  }
  if (pigRank === 4) {
    // 돼지가 낼 수 있는 만큼 내고, 흑팀 3명에게 똑같이, 나머지는 묻음
    const owed = obligation * 3;
    const pay = Math.min(owed, eggs[pig]);
    const each = Math.floor(pay / 3);
    deltas[pig] = -pay;
    shortage[pig] = pay < owed;
    for (const b of blacks) deltas[b] = each;
    buried += pay - each * 3;
    return finish('pig-lose', obligation, blacks);
  }
  return finish('water', 0, []);
}
