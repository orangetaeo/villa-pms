# zalo-msgid-per-conversation — 그룹 다계정 수신 유실 수정

## 배경 (실측 2026-07-13)

테오 보고: "villa go 주문 알림방" 그룹의 새 메시지(17:25~17:32)가 실제 Zalo에는 있는데 PMS /messages에는 안 보임.

**진단 (라이브 DB + zalo-worker 로그 실측)**:
- `ZaloMessage.zaloMsgId String? @unique` — **전역 unique**.
- 7/03 DK·7/10 Villa Go(김태진) 개인계정이 추가되며, 같은 그룹방에 PMS 연결 계정이 3개(테오 SYSTEM_BOT 포함).
- 같은 그룹 메시지 1건이 3개 리스너에 각각 도착 → 3개 소유자 대화에 각각 저장돼야 하는데 zaloMsgId가 같아 **첫 저장만 성공**:
  - `saveInboundMessage`의 멱등 findUnique가 타 소유자 저장분을 보고 duplicated로 오판 → 조용히 스킵.
  - 동시 도착이면 create가 `Unique constraint failed (zaloMsgId)`로 throw → 드롭 (워커 로그 도배 중).
- 결과: 각 관리자의 그룹 대화에 메시지가 **랜덤 부분집합**만 남음 (테오 villa go 대화 lastIn 12:47에서 정지, 같은 메시지들이 DK/김태진 대화에는 존재).
- 워치독 경보 0건이 정상 — 리스너 연결은 살아 있음(연결 문제 아님).

## 범위 (수정)

1. **스키마**: `zaloMsgId` 전역 `@unique` 제거 → `@@unique([conversationId, zaloMsgId])` + `@@index([zaloMsgId])`.
   - 라이브 DB raw SQL(규약): `DROP INDEX "ZaloMessage_zaloMsgId_key"` → 복합 UNIQUE INDEX + 단독 INDEX 생성. `prisma/migrations-manual/`에 보존.
2. **lib/zalo-inbound.ts**:
   - `saveInboundMessage` 멱등 조회를 `(conversationId, zaloMsgId)` 복합키로 스코프.
   - `saveOutboundEcho` 동일 (프로그램 발송 vs self-echo 중복 방지는 같은 대화 내에서만 유효하면 충분).
   - create 시 P2002 catch → duplicated 처리 (동일 대화 내 잔여 레이스 무해화, 메시지 드롭 0).
3. **app/api/zalo/ext/send/route.ts** `persistOutboundOriginal`: upsert where를 복합키 `conversationId_zaloMsgId`로.
4. **테스트**: lib/zalo-inbound.test.ts 멱등 스코프 반영 + "타 대화 동일 zaloMsgId 저장 허용" 케이스 추가.

## 수정 불필요 확인(감사 완료)

- `handleReactionEvent`(zalo-runtime): 이미 `findFirst + conversation.ownerAdminId` 스코프 — 복합화 후에도 정상.
- `pushInboundToNike`(zalo-webhook): 이미 findFirst + ownerAdminId 스코프.
- ext/send 인용 조회(302행): findFirst + ownerAdminId 스코프.
- messages route·_thread-data·chat-message: select/표시 전용.

## 완료 기준 (테스트 가능)

- [ ] 같은 zaloMsgId로 서로 다른 conversation에 INBOUND 2건 저장 성공 (단위 테스트)
- [ ] 같은 conversation에 같은 zaloMsgId 재저장은 duplicated=true (기존 멱등 보존)
- [ ] `npm run lint && npx tsc --noEmit && npm run build` 통과
- [ ] 라이브 DB 인덱스 교체 적용 + `prisma generate`
- [ ] 배포 후 zalo-worker 로그에서 `Unique constraint failed (zaloMsgId)` 재발 0 + 3계정 대화에 동일 그룹 메시지 각각 저장 실측

## 비범위 (기록만)

- 유실분 백필: 계정별 Zalo id 체계가 달라(같은 그룹도 소유자마다 zaloId 상이) 교차 매핑 불가 — 원본은 실제 Zalo에 있으므로 향후 재수신부터 정상. 백필 안 함.
- Nike webhook push가 이제 소유자별로 각각 발생(같은 zaloMsgId 최대 3회) — Nike측 멱등(zaloMsgId)이 흡수. 관찰만.

## 수정 금지 구역

- 없음 (본 계약 파일 외 다른 세션 작업물 발견 시 회피)

담당: 메인 세션(Fable, TDA 스키마 결정) + BE(구현) + QA(검증)
