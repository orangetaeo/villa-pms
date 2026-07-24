-- 목적: 제안(Proposal)을 채팅 공유 시 특정 ZaloConversation에 귀속시키기 위한 conversationId 추가 (FK 없음).
-- 오발송 차단·공유 후보 필터용. 계약서 docs/contracts/share-and-proposal-fix.md D3·G 항목 (additive only).
ALTER TABLE "Proposal" ADD COLUMN IF NOT EXISTS "conversationId" TEXT;
CREATE INDEX IF NOT EXISTS "Proposal_conversationId_idx" ON "Proposal"("conversationId");
