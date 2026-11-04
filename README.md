# 사사끼 (Sasaki) — 4인 온라인 카드게임

현재 단계: **M3 완료** — 4인 실시간 온라인 게임 (서버 판정, 각자 주패만 보기, 타이머)

## 폴더 구성
```
sasaki/
  packages/game-core/
    src/cards.ts       카드 48장, 섞기·분배, 정렬
    src/combos.ts      조합 판정(싱글~불돼지)과 강약 비교
    src/hand.ts        한 판 진행: 제출·패스·선·통선·찼다·꽂다·무르기·불돼지·흑돼지·달리기·뚝·완주
    src/settlement.ts  알 정산: 2v2, 돼지, 묻어둔 알, 지급 부족
    src/match.ts       여러 판 관리: 첫 판 선, 재분배, 배려판·탈락·최종 순위
    src/simulate.ts    무작위 4인 자동 대전 시뮬레이터
    test/              자동 테스트 (81개)
  docs/                규칙서·명세서, 07_규칙_확정_기록.md
```

## 실행 방법 (Node.js 20 이상)
```bash
npm install
npm run dev                 # 화면 빌드 후 서버 실행 → http://localhost:3000
npm test                    # 자동 테스트 123개 (4인 네트워크 대전 포함)
npm run simulate -- 1000 10 # 무작위 1000게임, 시작 알 10
npm run typecheck           # 타입 검사
```

## 설계 원칙
- 모든 판정은 **순수 함수** (`applyHandAction(상태, 행동) → 새 상태 + 이벤트`). 서버가 이 함수만 호출하므로 클라이언트는 판정 권한이 없다.
- 같은 처리 단위에 도착한 행동은 `applyHandBatch`로 처리하며 무르기가 찼다보다 우선.
- 자리 0→1→2→3→0 순서를 반시계 방향으로 정의.
- 불변식: 카드 48장 보존, (보유 알 + 묻어둔 알) 총량 보존 — 시뮬레이터가 매 행동마다 검사.

## 구성 (M3)
- `apps/server/src/room.ts` 방 하나: 좌석, 8초/5초/2초 타이머, 카드 노출 시간, 플레이어별 화면 정보
- `apps/server/src/index.ts` 실시간 서버 (Socket.IO), 화면 파일 제공
- `apps/web/src/online.ts` 온라인 게임 화면 / `apps/web/src/main.ts` 한 화면 시험판(M2)
- `render.yaml` Render 배포 설정

## 다음 단계
- M4: AI 대리 플레이, 자동 재접속, 1시간 방 보존
- M5: 애니메이션·효과음·모바일·배포
