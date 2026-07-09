-- FK 드리프트 정합화 (2026-07-09, T-db-reset-prep) — 라이브 Railway DB ↔ schema.prisma 델타 보정.
--   실행: npx prisma db execute --file prisma/migrations-manual/2026-07-09-fk-reconcile.sql --schema prisma/schema.prisma
-- ★ additive/재정렬만. 멱등(DO 블록·IF 가드). 기존 데이터 보존 — 컬럼/테이블 드롭 없음.
-- ★ 실측 근거: `npx prisma migrate diff --from-schema-datasource ... --to-schema-datamodel ... --script`
--
-- 이 파일이 고치는 것 (schema.prisma가 기대하지만 DB에 없거나 어긋난 FK):
--   1) Villa_cleanerId_fkey       : DB에 부재 → ADD (ON DELETE SET NULL). schema는 relation("VillaCleaner") 정의함.
--      선행조건 검증 완료(2026-07-09): Villa.cleanerId 3건 모두 u-huong-cleaner(존재 유저) → 고아 0건, ADD 안전.
--   2) Payment_bookingId_fkey     : DB onDelete=NO ACTION vs schema=SET NULL(옵셔널 relation 기본) → 재정렬.
--
-- 이 파일이 '건드리지 않는' 드리프트 (⚠ 의도적 — DROP 금지):
--   • GuestCheckinToken_bookingId_fkey (DB: ON DELETE CASCADE)
--   • MinibarStockMovement_{villaId,minibarItemId}_fkey (DB: CASCADE), _bookingId_fkey (DB: SET NULL)
--     → 이 FK들은 raw SQL 마이그레이션(2026-06-26-*)이 만든 '올바르고 보호적인' 제약이다.
--       migrate diff가 DROP을 제안하는 이유는 schema.prisma가 해당 relation을 '모델링하지 않아서'일 뿐
--       (schema 과소모델링). 정답은 DB를 바꾸는 게 아니라 TDA가 schema.prisma에 relation을 추가하는 것.
--       여기서 절대 DROP하지 말 것 — 드롭 시 미니바/게스트토큰 무결성 보호가 사라진다.
--   • DROP INDEX Booking_partnerId_idx / ALTER ... DROP DEFAULT(photoSlots·updatedAt×3) : 무해한 코스메틱 드리프트.
--   • DROP TABLE "_backup_minibar_amenity_20260625" : 과거 마이그레이션 잔여 백업 테이블. 별도 정리(파괴적, 범위 밖).
--
-- 롤백:
--   ALTER TABLE "Villa"   DROP CONSTRAINT IF EXISTS "Villa_cleanerId_fkey";
--   ALTER TABLE "Payment" DROP CONSTRAINT IF EXISTS "Payment_bookingId_fkey";
--     -- Payment는 필요 시 구 NO ACTION으로 재생성:
--     -- ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bookingId_fkey"
--     --   FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- 1) Villa.cleanerId FK — 부재 → 추가 (schema: cleaner User? @relation, ON DELETE SET NULL)
DO $$ BEGIN
  ALTER TABLE "Villa"
    ADD CONSTRAINT "Villa_cleanerId_fkey"
    FOREIGN KEY ("cleanerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Payment.bookingId FK — onDelete 재정렬 (→ SET NULL). 이미 SET NULL이면 무동작(멱등).
DO $$
DECLARE cur "char";
BEGIN
  SELECT confdeltype INTO cur FROM pg_constraint WHERE conname = 'Payment_bookingId_fkey';
  IF cur IS NULL THEN
    ALTER TABLE "Payment"
      ADD CONSTRAINT "Payment_bookingId_fkey"
      FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  ELSIF cur <> 'n' THEN  -- 'n' = SET NULL
    ALTER TABLE "Payment" DROP CONSTRAINT "Payment_bookingId_fkey";
    ALTER TABLE "Payment"
      ADD CONSTRAINT "Payment_bookingId_fkey"
      FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
