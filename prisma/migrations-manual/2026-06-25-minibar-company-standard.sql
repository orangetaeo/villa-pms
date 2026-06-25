-- #2b 미니바 회사표준 전환 (ADR-0016) — 수동 raw SQL 마이그레이션
-- 절대 `prisma db push` 금지(Villa.source 등 드리프트 드롭 위험, [[db-schema-drift-villa-source]]).
-- 순서 엄수: S0 → S1 → 코드 배포 → 검증 → 표준 품목 입력 완료 → S3.
--
-- ┌─ S0: 백업 (per-villa MINIBAR 행 스냅샷) ─────────────────────────────
-- 폐기(S3) 전 안전망. 타임스탬프 접미사로 1회성 보존.
CREATE TABLE IF NOT EXISTS "_backup_minibar_amenity_20260625" AS
  SELECT * FROM "VillaAmenity" WHERE "category" = 'MINIBAR';

-- ┌─ S1: MinibarItem 테이블 생성 (additive, villaId 없음 = 구조적 누수차단) ─
CREATE TABLE IF NOT EXISTS "MinibarItem" (
  "id"           TEXT NOT NULL,
  "itemKey"      TEXT NOT NULL,
  "nameKo"       TEXT NOT NULL,
  "nameVi"       TEXT,
  "unitPriceVnd" BIGINT NOT NULL,
  "sortOrder"    INTEGER NOT NULL DEFAULT 0,
  "active"       BOOLEAN NOT NULL DEFAULT true,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MinibarItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MinibarItem_itemKey_key" ON "MinibarItem"("itemKey");
CREATE INDEX IF NOT EXISTS "MinibarItem_active_sortOrder_idx" ON "MinibarItem"("active", "sortOrder");

-- ┌─ S3: per-villa MINIBAR 행 폐기 (배포·검증 + 표준 품목 입력 완료 후에만!) ─
-- ✅ 2026-06-25 실행 완료: 0c3908f 배포 SUCCESS 확인 + 표준품목 5종(생수·맥주·소주·콜라·과자, nameVi 포함) 입력 확인 후
--    17행 삭제(잔존 0). 백업 _backup_minibar_amenity_20260625(17행)로 복구 가능.
-- DELETE FROM "VillaAmenity" WHERE "category" = 'MINIBAR';
