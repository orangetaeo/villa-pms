# ADR-0024 — 메시지 인박스 실시간(SSE + in-process 이벤트버스)

- 상태: Accepted
- 날짜: 2026-06-26
- 관련: `/messages` 인박스, ADR-0007(대화 개인 스코프), Nike webhook(`lib/zalo-webhook.ts`)

## 맥락
운영자 `/messages` 인박스는 5초 폴링이라 수신 메시지가 최대 5초 지연되고 불필요한 왕복이 많았다. Railway는 단일 장기실행 컨테이너(서버리스 아님)라 in-process pub/sub와 SSE 스트림이 가능하다.

## 결정
1. **전송 방식 = SSE(EventSource)**. WebSocket은 양방향이 불필요하고(발신은 기존 POST), Postgres LISTEN/NOTIFY는 단일 인스턴스에선 과설계라 제외.
2. **신호 버스 = 모듈 레벨 EventEmitter**(`lib/realtime-bus.ts`, `globalThis` 캐시로 단일 인스턴스 보장). 채널 키 = `ownerAdminId`(=`session.user.id`).
3. **페이로드는 신호만** `{ type, conversationId }`. 메시지 본문·마진·판매가·원가를 스트림에 절대 싣지 않는다. 실데이터는 기존 스코프 API(`/api/zalo/inbox`, `/thread` — 둘 다 `ownerAdminId` 스코프)로 재페치 → 누수 표면을 단일화.
4. **폴링 폴백 유지**. EventSource 미지원/연결 실패 시 5초 폴링으로 자동 폴백(기능 회귀 0). 15초 하트비트로 프록시 타임아웃 방지, 탭 비가시 시 연결 종료.

## 근거 / 트레이드오프
- 단일 컨테이너 가정 → 다중 인스턴스 스케일아웃 시 이벤트가 인스턴스 경계를 못 넘는다. 향후 수평 확장 시 Postgres LISTEN/NOTIFY 또는 Redis pub/sub로 교체(버스 인터페이스는 그대로). Railway 단일 컨테이너 운영 동안은 충분.
- 신호+재페치 방식이라 데이터 일관성·권한은 기존 검증된 API에 위임 → SSE 경로에 새 누수 가능성 최소.

## 영향
- 신규: `lib/realtime-bus.ts`, `app/api/zalo/stream/route.ts`.
- 발행: `saveInboundMessage`(수신), `POST /api/zalo/messages`(발신) — try/catch 격리(발행 실패가 트랜잭션 영향 0).
- 클라: `messages-client.tsx` 폴링 effect → SSE 우선 + 폴백.
