-- 2026-07-22 계약 조항 협의(네고) — T-contract-negotiation (S2)
-- 규약: 라이브(Railway) DB에 additive raw SQL 직접 적용 → 이 파일이 감사 추적 정본.
--       prisma migrate dev / db push 사용 금지. 적용 후 `npx prisma generate` 필수.
-- 전부 멱등(IF NOT EXISTS) — 재실행 안전.

-- 1) 알림 타입 추가 (방향 구분은 payload.kind — 타입 증식 금지 교훈)
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CONTRACT_NEGOTIATION';

-- 2) 협의 레코드
--    ★ BusinessContract 관례와 동일하게 FK 미설정(id 보존만).
--    status/clauseKey/reason은 TEXT + 앱 레이어 zod 화이트리스트(enum ALTER 회피).
CREATE TABLE IF NOT EXISTS "ContractNegotiation" (
  "id"           TEXT NOT NULL,
  "contractId"   TEXT NOT NULL,
  "clauseKey"    TEXT NOT NULL,
  "reason"       TEXT NOT NULL,
  "proposedJson" JSONB,
  "note"         TEXT,
  "status"       TEXT NOT NULL DEFAULT 'OPEN',
  "createdById"  TEXT NOT NULL,
  "resolvedById" TEXT,
  "resolvedNote" TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt"   TIMESTAMP(3),
  CONSTRAINT "ContractNegotiation_pkey" PRIMARY KEY ("id")
);

-- 서명 게이트(미해결 협의 존재 판정)와 계약 상세 패널이 매번 쓰는 조회 축
CREATE INDEX IF NOT EXISTS "ContractNegotiation_contractId_status_idx"
  ON "ContractNegotiation" ("contractId", "status");
