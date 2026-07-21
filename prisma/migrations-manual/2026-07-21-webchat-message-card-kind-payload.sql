-- T-webchat-cards-inbox-zalo-links (A): 웹챗 카드형 메시지 (additive)
-- 적용: 2026-07-21, prisma db execute (Railway 라이브 DB)
-- WebChatMessage에 카드 렌더용 kind + payload. 구 메시지는 null(텍스트 렌더 하위호환).

ALTER TABLE "WebChatMessage" ADD COLUMN IF NOT EXISTS "kind" TEXT;
ALTER TABLE "WebChatMessage" ADD COLUMN IF NOT EXISTS "payload" JSONB;
