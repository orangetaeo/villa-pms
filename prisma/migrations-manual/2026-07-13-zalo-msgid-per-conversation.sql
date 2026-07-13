-- zalo-msgid-per-conversation (계약 docs/contracts/zalo-msgid-per-conversation.md)
-- 배경: zaloMsgId 전역 unique 때문에 같은 그룹 메시지가 다계정(테오·DK·Villa Go) 대화에
--   중복 저장되지 못하고 첫 저장 외 전부 유실됨(2026-07-13 실측 — 워커 로그 P2002 도배).
-- 조치: 전역 unique 제거 → (conversationId, zaloMsgId) 복합 unique + zaloMsgId 단독 조회 인덱스.
-- 안전: 기존 데이터는 전역 unique 하에 있었으므로 복합 unique 위반 0건 보장.

DROP INDEX IF EXISTS "ZaloMessage_zaloMsgId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "ZaloMessage_conversationId_zaloMsgId_key"
  ON "ZaloMessage"("conversationId", "zaloMsgId");

-- ownerAdminId 스코프 findFirst(리액션·webhook·인용 앵커)용 단독 인덱스 보존
CREATE INDEX IF NOT EXISTS "ZaloMessage_zaloMsgId_idx"
  ON "ZaloMessage"("zaloMsgId");
