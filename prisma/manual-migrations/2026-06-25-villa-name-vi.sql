-- ADR-0020 빌라명 베트남어 병기 — additive nameVi 컬럼 (멱등·무손실)
-- 적용: 2026-06-25 라이브 Neon DB ($executeRawUnsafe, 검증 완료 — text/nullable)
-- 드리프트 정책상 prisma db push 금지, raw SQL ALTER 사용 ([[db-schema-drift-villa-source]])
ALTER TABLE "Villa" ADD COLUMN IF NOT EXISTS "nameVi" TEXT;
