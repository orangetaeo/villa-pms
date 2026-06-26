# 계약: 답글 인용 클릭 → 원본 메시지로 점프 (globalMsgId 앵커 변환)

## 배경 / 근본 원인

`/messages` 채팅에 답글(인용) 기능과 "인용 블록 클릭 → 원본으로 스크롤+하이라이트" 코드는
이미 존재한다(`scrollToMessage`·`QuoteJumpContext`·`QuotedBlock.canJump`). 그러나 **상대(공급자)가
보낸 답글**의 인용은 절대 점프되지 않는다.

- 버블 앵커 `data-msg-id` = `zaloMsgId`(= zca-js `data.msgId`)
- 수신 답글 인용 대상 `quotedMsgId` = zca-js `quote.globalMsgId`
- zca-js에서 `msgId` ≠ `globalMsgId` (다른 ID 체계) → `canJump` 항상 false → 클릭 불가
- villa는 각 메시지의 `globalMsgId`를 아예 저장하지 않아 변환 불가

Nike가 동일 버그를 겪고 `globalMsgId → zaloMsgId` 변환 테이블로 해결
(`reference/nike/src/lib/zalo-db-store.ts:437 resolveQuoteMsgIds`).

우리 발신(OUTBOUND) 답글은 `quotedMsgId=원본 zaloMsgId`로 저장돼 이미 점프됨 — 회귀 주의(그대로 유지).

## 범위

1. **schema** `ZaloMessage.globalMsgId String?` 추가(additive) + 인덱스. 라이브 DB는 raw SQL ALTER(드롭 위험 회피, db push 금지).
2. **수신 캡처** `lib/zalo-inbound.ts` `buildGlobalMsgId()` + `ParsedInbound.globalMsgId` + save 2곳(inbound/outboundEcho) create에 저장. `lib/zalo-runtime.ts` 핸들러에서 `userMsg.data.globalMsgId` 캡처.
3. **렌더 변환** 읽기 2경로(`_thread-data.ts getThreadData`, `GET /api/zalo/messages`)에서 `globalMsgId→zaloMsgId` 맵(배치 내 + DB 폴백)으로 각 메시지 `quotedMsgId`를 앵커 zaloMsgId로 치환 → `QuotedBlock.canJump` 매칭 성립.
4. **테스트** 변환 헬퍼 단위 테스트.

## 완료 기준 (테스트 가능)

- 상대가 보낸 답글의 인용 블록이 클릭 가능(원본이 현재 로드 범위에 있을 때) → 클릭 시 원본으로 스크롤+2초 하이라이트.
- 우리 발신 답글 점프 회귀 없음.
- 누수 0: 변환은 zaloMsgId/globalMsgId만 사용, 마진·판매가 미조회.
- typecheck·build·기존 zalo 테스트 통과 + 변환 단위 테스트 추가.

## 수정 금지 구역
- 없음(단독 세션, 신규 컬럼 additive).
