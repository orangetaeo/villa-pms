# ADR-0045: 홈페이지 다국어 웹 채팅 — 데이터 모델 (WebChatSession + WebChatMessage)

- 상태: Accepted (2026-07-16)
- 관련: 기획 docs/plans/webchat-multilingual.md(§4·§9), 계약 docs/contracts/T-webchat-mvp.md, ADR-0003(Zalo 양방향 채팅), ADR-0007(관리자×상대 대화 소유), ADR-0040(운영자 Zalo 그룹 알림)
- ⚠ 병합 직전 main에서 ADR 번호 충돌 재확인 (0040 사례). 착수 시점 최신=0044.

## 배경

villa-go.net 방문자(비로그인 — 국제 관광객·한국 여행사·랜드사)가 홈페이지에서 바로 운영자(테오)와 채팅하는 다국어(vi/ko/en/zh/ru) 위젯을 자체 구축한다. 현재 intro 페이지들은 Zalo/카카오 외부 링크로 유도하는데, 앱 설치·가입 마찰 없이 사이트 안에서 문의를 받는 것이 목표. 번역 파이프라인·SSE 버스·토큰 패턴·알림·감사로그 등 플러밍의 80%는 기존 자산(Gemini·realtime-bus·operator-notify)을 재사용한다. 본 ADR은 그 저장 계층(스키마)만 확정한다.

## 결정

### D1. 신규 분리 테이블 2개 — ZaloMessage 재사용 기각

`WebChatSession` + `WebChatMessage`를 신규로 만든다. 기존 `ZaloConversation`/`ZaloMessage` 재사용을 기각한다.

- Zalo 모델은 `zaloUserId`·`threadType`·`@@unique([ownerAdminId, zaloUserId])`·`zaloMsgId` 등 Zalo 프로토콜에 강결합돼 있다. 익명 웹 방문자는 zaloUserId가 없고(연락처는 프로그레시브 수집), 세션 식별은 httpOnly 서명 쿠키로 한다 — 억지로 얹으면 유니크 제약·널 슬롯이 오염된다.
- **저장은 분리, 표현만 통합**: 운영자 인박스는 기존 /messages "웹 채팅" 탭에서 어댑터로 Zalo 대화와 동형 렌더(원문+ko 번역 병기·답장 UI 재사용)한다. 저장 계층까지 합치지 않는다(D7 기획).

### D2. 익명 세션 소유 모델 — ownerAdminId (ZaloConversation 패턴 준용)

`WebChatSession.ownerAdminId`(→ `User`, onDelete Cascade)로 세션을 수신 ADMIN에 귀속한다. 익명 생성 시점엔 로그인 admin이 없으므로 기본 수신자(테오)를 AppSetting에서 해석해 배정한다. ADR-0007의 "대화를 소유한 ADMIN" 패턴과 정합 — 다중 상담원 확장 시에도 배정 축이 이미 존재한다. User에는 additive 역관계 `webChatSessions @relation("AdminWebChatSessions")`만 추가.

### D3. 인박스 비정규화 컬럼 (기획 §9 P1-3)

`WebChatSession`에 `lastMessageText`·`lastMessageDirection`·`lastMessageAt`를 비정규화한다. 기존 인박스가 대화별 messages take1 서브쿼리를 제거하려고 `ZaloConversation.lastMessageText`/`lastMessageType`로 비정규화한 패턴(2026-06-24)을 그대로 준수 — 누락 시 인박스 N+1 재발. 메시지 쓰기 경로가 세 값을 `lastMessageAt`와 함께 원자 갱신한다. **표시 전용이라 누수 무관**(본문·방향만, 재고·가격 없음). `unreadForAdmin`은 운영자 스레드 열람 시 0으로 리셋(totalUnread 정확도).

### D4. 금액 컬럼 배제 (마진 누수 표면 제거)

두 테이블 어디에도 판매가(KRW)·원가(VND)·마진 컬럼을 두지 않는다. 사업 원칙 "마진 비공개"의 누수 표면을 스키마 레벨에서 원천 제거한다 — 방문자 payload 화이트리스트 실수로도 금액이 샐 컬럼 자체가 없다. 가격 공유가 필요하면 운영자가 기존 `/p/[token]` 제안 링크로만 처리(위젯 자동 임베드 금지, 기획 §7).

### D5. 번역 캐시 + 답장 실패 플래그

`WebChatMessage`에 `translatedText`(캐시 — 재호출 금지)·`translatedTo`를 둔다. 방문자 발신(INBOUND)은 eager ko 번역, 운영자 답장(OUTBOUND)은 발송 직전 방문자 언어 번역을 캐시한다(ADR-0003 Zalo 번역 캐시 동형). 추가로 `translationFailed`(기본 false)를 둔다 — 답장 번역 실패 시 **ko 원문 발송 + 플래그**(발송 누락 금지, 계약 완료 기준). 언어 감지 소스는 Gemini 자동감지, 위젯 선택 `visitorLocale`은 답장 방향 판정 전용(D6 기획).

### D6. ipHash·상태·보존

- `ipHash`: HMAC-SHA256(secret, ip) — 원문 IP 저장 금지(무염 해시는 IPv4 2³² 전수대입으로 가역). `(ipHash, createdAt)` 인덱스로 IP 기준 세션 대량 생성 어뷰즈 조사.
- `status`(WebChatSessionStatus OPEN/CLOSED/BLOCKED): BLOCKED는 폴링 403·발신 403·알림/번역 억제·인박스 필터의 단일 축(BLOCKED 5종).
- `expiresAt`: 세션 유효기간(슬라이딩 30일)이지 삭제 아님. MVP는 무기한 보존, 만료 세션 정리는 신규 cron 대신 기존 일일 cron에 편입(cron 등록 비용 절약). db-backup은 dmmf 전수 순회라 신규 테이블 자동 포함, BigInt 없어 복원 무영향.

### D7. NotificationType `WEBCHAT_NEW_MESSAGE` additive

기존 enum에 값 1개 추가(라이브 `ALTER TYPE ADD VALUE IF NOT EXISTS`). 대화당 첫 메시지 즉시 + 후속 10분 디바운스로 운영자 Zalo 그룹 통지(ko 미리보기, 판매가·마진 미포함). 소비처(zalo.ts switch case·GROUP_ROUTED_TYPES·NOTIFICATIONS.md)는 T-webchat-notify(INTEG)에서 동시 갱신 — 본 스키마 태스크는 enum 값·DB 선반영까지.

## 기각한 대안

- **ZaloMessage 재사용**: D1 참조 — 프로토콜 강결합·유니크 제약 오염. 표현 통합만 채택.
- **금액/가격 스냅샷 컬럼**: 마진 비공개 원칙 위반 표면. 제안은 /p/[token] 전담.
- **인박스 실시간 서브쿼리(비정규화 미도입)**: N+1 병목 재발(기존 Zalo 인박스에서 실증). 비정규화 3컬럼 채택.
- **방문자 SSE**: 익명 SSE는 연결 점유형 DoS + replica=1 제약 → 방문자는 폴링, 운영자만 기존 realtime-bus SSE(기획 D4). 스키마 무관.

## 영향

- **적용**: additive raw SQL 2파일 — `prisma/migrations-manual/2026-07-16_webchat.sql`(enum 2·테이블 2·인덱스 4·FK 2, 멱등) + `2026-07-16_webchat-notiftype.sql`(ALTER TYPE ADD VALUE — 트랜잭션 제약으로 분리 실행). 라이브 Railway DB 적용 완료, `prisma generate` 완료. `prisma migrate`/`db push` 미사용(CLAUDE.md 규약).
- **검증**: `WebChatSession`/`WebChatMessage` count=0 성공, `NotificationType`에 WEBCHAT_NEW_MESSAGE 존재, 두 enum range 확인.
- **후속 태스크**: T-webchat-api(BE)·T-webchat-widget/inbox(FE)·T-webchat-notify(INTEG)·T-webchat-loc(LOC) — 본 스키마 정본 위에 구현.
- **누수 등급**: 방문자 payload는 화이트리스트 select, 금액 컬럼 부재로 스키마 레벨 안전. QA 누수 체크리스트 "웹 채팅" 섹션 신설 대상.
