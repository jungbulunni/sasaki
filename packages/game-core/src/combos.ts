// 조합 판정과 강약 비교 (사용자 확정 규칙 2026-11-04 반영)
//
// 강약 관계 요약
//  - 싱글/페어/닐리리 : 같은 종류(닐리리는 같은 장수)끼리 더 높은 숫자만 가능
//  - 틀(같은 숫자 3장) : 싱글·페어·닐리리를 이김, 더 높은 틀에 짐
//  - 사사끼(4·4·A)    : AAA보다 높은 틀
//  - 쌍카             : 같은 쌍 수끼리만 비교. 틀과는 서로 이기지 못함. 마대 이상에게 짐
//  - 마대(같은 숫자 4장): 싱글·페어·닐리리·틀·사사끼·쌍카를 이김
//  - 불돼지(♥10♦10)   : 무엇이든 이김. 흑돼지(♠10♣10)만 특수 대응 창에서 막음
//  - 흑돼지는 평소엔 일반 10 페어
//  - 같은 숫자 위에 같은 숫자는 낼 수 없음 (반드시 한 단계 이상 높아야 함)

import { CardId, rankOf } from './cards';

export type ComboKind = 'single' | 'pair' | 'nilliri' | 'ssangka' | 'teul' | 'sasaki' | 'madae' | 'bulpig';

export interface Combo {
  kind: ComboKind;
  cards: CardId[];
  /** 비교 기준 숫자(가장 높은 숫자) */
  top: number;
  /** 닐리리: 장수, 쌍카: 쌍 수, 그 외 카드 장수 */
  length: number;
}

export const COMBO_NAME: Record<ComboKind, string> = {
  single: '싱글', pair: '페어', nilliri: '닐리리', ssangka: '쌍카',
  teul: '틀', sasaki: '사사끼', madae: '마대', bulpig: '불돼지',
};

function isConsecutive(sortedRanks: number[]): boolean {
  for (let i = 1; i < sortedRanks.length; i++) if (sortedRanks[i] !== sortedRanks[i - 1] + 1) return false;
  return true;
}

/** 제출한 카드들이 어떤 조합인지 판정. 허용되지 않는 조합이면 null */
export function classifyCombo(cards: CardId[]): Combo | null {
  const n = cards.length;
  if (n === 0 || new Set(cards).size !== n) return null;
  const ranks = cards.map(rankOf).sort((a, b) => a - b);
  const allSame = ranks.every((r) => r === ranks[0]);
  const top = ranks[n - 1];
  const mk = (kind: ComboKind, length = n): Combo => ({ kind, cards: [...cards], top, length });

  if (n === 1) return mk('single');
  if (n === 2 && allSame) {
    const isBulpig = cards.includes('H10') && cards.includes('D10');
    return mk(isBulpig ? 'bulpig' : 'pair');
  }
  if (n === 3 && allSame) return mk('teul');
  if (n === 3 && ranks[0] === 4 && ranks[1] === 4 && ranks[2] === 14) return { ...mk('sasaki'), top: 15 };
  if (n === 4 && allSame) return mk('madae');

  // 닐리리: 서로 다른 연속 숫자 3장 이상
  if (n >= 3 && new Set(ranks).size === n && isConsecutive(ranks)) return mk('nilliri', n);

  // 쌍카: 연속 숫자 페어 3쌍 이상
  if (n >= 6 && n % 2 === 0) {
    const distinct: number[] = [];
    let ok = true;
    for (let i = 0; i < n; i += 2) {
      if (ranks[i] !== ranks[i + 1]) { ok = false; break; }
      distinct.push(ranks[i]);
    }
    if (ok && new Set(distinct).size === distinct.length && isConsecutive(distinct)) return mk('ssangka', n / 2);
  }
  return null;
}

const BEATEN_BY_TEUL: ComboKind[] = ['single', 'pair', 'nilliri'];
const BEATEN_BY_MADAE: ComboKind[] = ['single', 'pair', 'nilliri', 'teul', 'sasaki', 'ssangka'];

/** next 가 현재 공격 cur 위에 낼 수 있는지 (cur 가 null 이면 선: 무엇이든 가능) */
export function canBeat(next: Combo, cur: Combo | null): boolean {
  if (!cur) return true;
  if (cur.kind === 'bulpig') return false; // 흑돼지는 별도 대응 창에서만
  if (next.kind === 'bulpig') return true;

  switch (next.kind) {
    case 'madae':
      if (cur.kind === 'madae') return next.top > cur.top;
      return BEATEN_BY_MADAE.includes(cur.kind);
    case 'sasaki':
      if (cur.kind === 'teul') return true; // AAA 포함 모든 틀보다 높음
      if (cur.kind === 'sasaki') return false;
      return BEATEN_BY_TEUL.includes(cur.kind);
    case 'teul':
      if (cur.kind === 'teul') return next.top > cur.top;
      return BEATEN_BY_TEUL.includes(cur.kind);
    case 'single':
    case 'pair':
      return cur.kind === next.kind && next.top > cur.top;
    case 'nilliri':
    case 'ssangka':
      return cur.kind === next.kind && cur.length === next.length && next.top > cur.top;
  }
  return false;
}

/** 주패에서 낼 수 있는 모든 조합 후보 (AI·시간초과·시뮬레이터용) */
export function enumerateCombos(hand: CardId[]): Combo[] {
  const byRank = new Map<number, CardId[]>();
  for (const c of hand) byRank.set(rankOf(c), [...(byRank.get(rankOf(c)) ?? []), c]);
  const out: CardId[][] = [];

  for (const c of hand) out.push([c]);
  for (const cs of byRank.values()) {
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) out.push([cs[i], cs[j]]);
    if (cs.length >= 3) out.push(cs.slice(0, 3));
    if (cs.length === 4) out.push(cs.slice(0, 4));
  }
  const fours = byRank.get(4) ?? [];
  const aces = byRank.get(14) ?? [];
  if (fours.length >= 2 && aces.length >= 1) out.push([fours[0], fours[1], aces[0]]);

  for (let start = 3; start <= 12; start++) {
    const single: CardId[] = [];
    const doubled: CardId[] = [];
    let doubleOk = true;
    for (let r = start; r <= 14; r++) {
      const cs = byRank.get(r);
      if (!cs) break;
      single.push(cs[0]);
      if (single.length >= 3) out.push([...single]);
      if (doubleOk && cs.length >= 2) {
        doubled.push(cs[0], cs[1]);
        if (doubled.length >= 6) out.push([...doubled]);
      } else doubleOk = false;
    }
  }
  return out.map(classifyCombo).filter((c): c is Combo => c !== null);
}
