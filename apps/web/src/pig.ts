// 확정 디자인(2026-11-05)의 돼지 그림. 입은 그리지 않고 눈으로만 표정을 낸다.

type Kind = 'pig' | 'blackpig';
type Mood = 'normal' | 'happy';

const PAL = {
  pig: { face: '#FCE6EB', line: '#2E1640', cheek: '#F7A3B5', snout: '#F49AB0', nost: '#B8455F', eye: '#2A1A2E', crown: '#F5C02A', band: '#E0A21C', pearl: '#FFF6D8', jewel: '#D2343E' },
  blackpig: { face: '#5A5463', line: '#17141B', cheek: '#7E7689', snout: '#8A8296', nost: '#26222C', eye: '#F3EEF7', crown: '#C9C4D2', band: '#9E98A8', pearl: '#F3EEF7', jewel: '#17141B' },
};

/** 얼굴 (viewBox 0 0 200 186). 흑돼지는 늘 낄낄 웃는 반달눈 + 눈물 */
export function pigHead(kind: Kind, mood: Mood = 'normal', sw = 4.5): string {
  const c = PAL[kind];
  const happy = kind === 'blackpig' || mood === 'happy';
  const eyes = happy
    ? `<path d="M65 112 Q74 100 83 112" fill="none" stroke="${c.eye}" stroke-width="6" stroke-linecap="round"/><path d="M117 112 Q126 100 135 112" fill="none" stroke="${c.eye}" stroke-width="6" stroke-linecap="round"/>`
    : `<circle cx="74" cy="108" r="7.5" fill="${c.eye}"/><circle cx="126" cy="108" r="7.5" fill="${c.eye}"/><circle cx="76.5" cy="105" r="2.8" fill="#fff"/><circle cx="128.5" cy="105" r="2.8" fill="#fff"/>`;
  const tears = kind === 'blackpig'
    ? `<path d="M62 117 Q58.5 123 62 126 Q65.5 123 62 117 Z" fill="#BFE3F5"/><path d="M138 117 Q134.5 123 138 126 Q141.5 123 138 117 Z" fill="#BFE3F5"/>`
    : '';
  const gems = kind === 'pig' ? `<circle cx="90" cy="58" r="2.2" fill="#3E7BD6"/><circle cx="110" cy="58" r="2.2" fill="#2FA36B"/>` : '';
  return `<ellipse cx="100" cy="112" rx="68" ry="60" fill="${c.face}" stroke="${c.line}" stroke-width="${sw}"/>
    <path d="M38 58 Q56 40 70 46 Q78 50 77 60 Q76 76 70 84 Q66 90 58 86 Q42 80 33 72 Q27 66 38 58 Z" fill="${c.face}" stroke="${c.line}" stroke-width="${sw}" stroke-linejoin="round"/>
    <path d="M162 58 Q144 40 130 46 Q122 50 123 60 Q124 76 130 84 Q134 90 142 86 Q158 80 167 72 Q173 66 162 58 Z" fill="${c.face}" stroke="${c.line}" stroke-width="${sw}" stroke-linejoin="round"/>
    <path d="M82 58 L79 34 L90 44 L95 28 L100 40 L105 28 L110 44 L121 34 L118 58 Q100 53 82 58 Z" fill="${c.crown}" stroke="${c.line}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M81 54 Q100 49 119 54 L118 62 Q100 57 82 62 Z" fill="${c.band}" stroke="${c.line}" stroke-width="3.5" stroke-linejoin="round"/>
    <circle cx="79" cy="34" r="3.4" fill="${c.pearl}" stroke="${c.line}" stroke-width="2.4"/><circle cx="95" cy="28" r="3.4" fill="${c.pearl}" stroke="${c.line}" stroke-width="2.4"/>
    <circle cx="105" cy="28" r="3.4" fill="${c.pearl}" stroke="${c.line}" stroke-width="2.4"/><circle cx="121" cy="34" r="3.4" fill="${c.pearl}" stroke="${c.line}" stroke-width="2.4"/>
    <path d="M100 41 L104 46.5 L100 52 L96 46.5 Z" fill="${c.jewel}" stroke="${c.line}" stroke-width="2"/>
    ${gems}${eyes}${tears}
    <ellipse cx="50" cy="132" rx="11" ry="7" fill="${c.cheek}"/><ellipse cx="150" cy="132" rx="11" ry="7" fill="${c.cheek}"/>
    <ellipse cx="100" cy="136" rx="24" ry="16" fill="${c.snout}"/>
    <ellipse cx="91" cy="136" rx="4" ry="6" fill="${c.nost}"/><ellipse cx="109" cy="136" rx="4" ry="6" fill="${c.nost}"/>`;
}

export function pigFaceSvg(kind: Kind, mood: Mood = 'normal', cls = 'pigface'): string {
  return `<svg class="${cls}" viewBox="0 0 200 186" aria-hidden="true">${pigHead(kind, mood)}</svg>`;
}

/** 시작 화면의 전신: 망토, 양팔 벌리기, 7시·5시 다리, X자 배꼽 */
export function pigBodySvg(cls = 'pigbody'): string {
  const f = '#FCE6EB', l = '#2E1640';
  return `<svg class="${cls}" viewBox="0 0 240 280" aria-hidden="true">
    <path d="M72 158 Q40 232 66 276 L174 276 Q200 232 168 158 Z" fill="#D2343E" stroke="${l}" stroke-width="4.5" stroke-linejoin="round"/>
    <ellipse cx="44" cy="188" rx="16" ry="12" transform="rotate(-30 44 188)" fill="${f}" stroke="${l}" stroke-width="4.5"/>
    <ellipse cx="196" cy="188" rx="16" ry="12" transform="rotate(30 196 188)" fill="${f}" stroke="${l}" stroke-width="4.5"/>
    <ellipse cx="84" cy="258" rx="16" ry="12" transform="rotate(32 84 258)" fill="${f}" stroke="${l}" stroke-width="4.5"/>
    <ellipse cx="156" cy="258" rx="16" ry="12" transform="rotate(-32 156 258)" fill="${f}" stroke="${l}" stroke-width="4.5"/>
    <ellipse cx="120" cy="200" rx="68" ry="60" fill="${f}" stroke="${l}" stroke-width="4.5"/>
    <ellipse cx="120" cy="216" rx="38" ry="28" fill="#FFF4F7"/>
    <path d="M114 210 L126 222 M126 210 L114 222" fill="none" stroke="#F07A96" stroke-width="4" stroke-linecap="round"/>
    <g transform="translate(20 0)">${pigHead('pig')}</g>
  </svg>`;
}

/** 알 토큰 */
export const eggSvg = (cls = 'egg') =>
  `<svg class="${cls}" viewBox="0 0 20 24" aria-hidden="true"><ellipse cx="10" cy="13" rx="8.5" ry="10" fill="#FFF8E7" stroke="#2E1640" stroke-width="2"/><ellipse cx="7" cy="9" rx="2.2" ry="3" fill="#fff"/></svg>`;
