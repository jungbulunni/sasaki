// 카드 모델: 48장 (3~A, 4무늬). 2와 조커 없음.
// 카드 ID 예: 'H10' = ♥10, 'S14' = ♠A, 'C11' = ♣J

export const SUITS = ['S', 'H', 'D', 'C'] as const;
export type Suit = (typeof SUITS)[number];
export const RANKS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] as const;
export type CardId = string;

export const FIRE_CARDS: CardId[] = ['H10', 'D10']; // 불
export const BLACK_CARDS: CardId[] = ['S10', 'C10']; // 흑

export const rankOf = (c: CardId): number => Number(c.slice(1));
export const suitOf = (c: CardId): Suit => c[0] as Suit;
export const isFire = (c: CardId) => FIRE_CARDS.includes(c);

const SUIT_SYMBOL: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RANK_LABEL: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
export const rankLabel = (r: number) => RANK_LABEL[r] ?? String(r);
export const cardLabel = (c: CardId) => SUIT_SYMBOL[suitOf(c)] + rankLabel(rankOf(c));

export function fullDeck(): CardId[] {
  const deck: CardId[] = [];
  for (const s of SUITS) for (const r of RANKS) deck.push(`${s}${r}`);
  return deck;
}

/** 주패 자동 정렬: 3 → A. 같은 숫자의 무늬 순서는 규칙상 의미 없음. */
export function sortHand(cards: CardId[]): CardId[] {
  return [...cards].sort((a, b) => rankOf(a) - rankOf(b) || SUITS.indexOf(suitOf(a)) - SUITS.indexOf(suitOf(b)));
}

/** 재현 가능한 난수 (테스트용 시드 지원) */
export type Rng = () => number;
export function seededRng(seed: number): Rng {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 48장을 섞어 12장씩 분배 */
export function deal(rng: Rng): CardId[][] {
  const d = shuffle(fullDeck(), rng);
  return [0, 1, 2, 3].map((i) => sortHand(d.slice(i * 12, i * 12 + 12)));
}

/** 두 불을 한 사람이 가졌으면 그 자리 번호(돼지), 아니면 null */
export function pigSeatOf(hands: CardId[][]): number | null {
  const owners = FIRE_CARDS.map((f) => hands.findIndex((h) => h.includes(f)));
  return owners[0] !== -1 && owners[0] === owners[1] ? owners[0] : null;
}

export function ownerOf(hands: CardId[][], card: CardId): number {
  return hands.findIndex((h) => h.includes(card));
}

/** 게임 상태 복사 (상태는 순수 JSON 데이터) */
export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
