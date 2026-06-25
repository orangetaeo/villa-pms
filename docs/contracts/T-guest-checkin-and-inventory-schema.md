# 스키마 마이그레이션 스펙 — 게스트 체크인 + 부가서비스 + 미니바 실재고 (ADR-0019)

> **적용 규칙(필수)**: `prisma db push`·`migrate` **금지**([[db-schema-drift-villa-source]]). 라이브 DB는 **raw SQL**(`prisma db execute --file <sql> --schema prisma/schema.prisma`)로 additive 적용 → 그 다음 `prisma/schema.prisma`를 동일하게 수정 → `prisma generate`(push 아님)로 클라이언트 동기화. **enum `ADD VALUE`는 다른 DDL과 같은 트랜잭션에 못 묶이므로 단독 실행**. 적용 후 `git cat-file`/`information_schema` 조회로 반영 검증([[private-index-drops-untracked-files]]).
>
> 스키마 전담은 **한 세션(TDA)** 만([[parallel-session-worktree-isolation]]). 컬럼 추가 전 `information_schema.columns`로 **기존 드리프트 확인**(예: `CheckOutRecord.minibarChargeVnd`는 통계 v2에서 라이브 DB에만 추가됐을 수 있음 — 커밋 스키마와 대조).

타입 매핑: `String`→TEXT, `Int`→INTEGER, `BigInt`→BIGINT, `Boolean`→BOOLEAN, `DateTime`→TIMESTAMP(3), `Json`→JSONB, `@default(cuid())`/`@updatedAt`=앱측(DB 기본값 없음), `@default(now())`→`DEFAULT CURRENT_TIMESTAMP`.

---

## S1 — 미니바 실재고

### Prisma (schema.prisma 추가/수정)
```prisma
model VillaMinibarStock {
  // ...기존 필드...
  onHandQty     Int         @default(0) // 현재고 캐시 (par=qty와 분리)
}

enum MinibarMovementType { RESTOCK CONSUME ADJUST }

model MinibarStockMovement {
  id            String              @id @default(cuid())
  villaId       String
  minibarItemId String
  type          MinibarMovementType
  qtyDelta      Int                 // +입고 / −소모·차감
  unitCostVnd   BigInt?             // RESTOCK 매입 단가(원가 입력 경로)
  bookingId     String?             // CONSUME 출처 예약
  note          String?
  createdBy     String
  createdAt     DateTime            @default(now())

  @@index([villaId, minibarItemId])
  @@index([createdAt])
}
```

### Raw SQL
```sql
ALTER TABLE "VillaMinibarStock" ADD COLUMN IF NOT EXISTS "onHandQty" INTEGER NOT NULL DEFAULT 0;

DO $$ BEGIN
  CREATE TYPE "MinibarMovementType" AS ENUM ('RESTOCK','CONSUME','ADJUST');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "MinibarStockMovement" (
  "id"            TEXT PRIMARY KEY,
  "villaId"       TEXT NOT NULL,
  "minibarItemId" TEXT NOT NULL,
  "type"          "MinibarMovementType" NOT NULL,
  "qtyDelta"      INTEGER NOT NULL,
  "unitCostVnd"   BIGINT,
  "bookingId"     TEXT,
  "note"          TEXT,
  "createdBy"     TEXT NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "MinibarStockMovement_villaId_minibarItemId_idx"
  ON "MinibarStockMovement" ("villaId","minibarItemId");
CREATE INDEX IF NOT EXISTS "MinibarStockMovement_createdAt_idx"
  ON "MinibarStockMovement" ("createdAt");
```
> FK는 기존 컨벤션 따라 앱 레벨 무결성으로 둘지(다른 신규 테이블 관례 확인) 또는 `ADD CONSTRAINT`로 추가. onDelete Cascade가 필요하면 `Villa`/`MinibarItem` 참조 FK 추가.

---

## S2 — 서비스 카탈로그

### Prisma
```prisma
enum ServiceType { BBQ TICKET GUIDE CAR_RENTAL BREAKFAST MOTORBIKE_RENTAL MASSAGE BARBER } // +MOTORBIKE_RENTAL, MASSAGE, BARBER
enum ServiceRequestedVia { ADMIN GUEST }

model ServiceCatalogItem {
  id          String      @id @default(cuid())
  type        ServiceType
  nameKo      String
  nameVi      String?
  nameEn      String?
  descKo      String?
  descVi      String?
  unitLabelKo String?
  priceKrw    Int?
  priceVnd    BigInt?
  costVnd     BigInt?     // ★운영자 전용 — 게스트·공급자 select 제외
  photoUrl    String?
  options     Json?       // {variants:[1택·가격대체], addons:[다중·가산], modifiers:[토글·가산]}
  active      Boolean     @default(true)
  sortOrder   Int         @default(0)
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt

  @@index([active, sortOrder])
}

model ServiceOrder {
  // ...기존...
  catalogItemId   String?
  quantity        Int                 @default(1)
  selectedOptions Json?
  requestedVia    ServiceRequestedVia @default(ADMIN)
  guestNote       String?
}
```

### Raw SQL
```sql
-- enum 값 추가는 각각 단독 실행(다른 DDL과 같은 배치 금지)
ALTER TYPE "ServiceType" ADD VALUE IF NOT EXISTS 'MOTORBIKE_RENTAL';
ALTER TYPE "ServiceType" ADD VALUE IF NOT EXISTS 'MASSAGE';
ALTER TYPE "ServiceType" ADD VALUE IF NOT EXISTS 'BARBER';

-- 이하 별도 배치
DO $$ BEGIN
  CREATE TYPE "ServiceRequestedVia" AS ENUM ('ADMIN','GUEST');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "ServiceCatalogItem" (
  "id"          TEXT PRIMARY KEY,
  "type"        "ServiceType" NOT NULL,
  "nameKo"      TEXT NOT NULL,
  "nameVi"      TEXT,
  "nameEn"      TEXT,
  "descKo"      TEXT,
  "descVi"      TEXT,
  "unitLabelKo" TEXT,
  "priceKrw"    INTEGER,
  "priceVnd"    BIGINT,
  "costVnd"     BIGINT,
  "photoUrl"    TEXT,
  "options"     JSONB,
  "active"      BOOLEAN NOT NULL DEFAULT true,
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ServiceCatalogItem_active_sortOrder_idx"
  ON "ServiceCatalogItem" ("active","sortOrder");

ALTER TABLE "ServiceOrder" ADD COLUMN IF NOT EXISTS "catalogItemId"   TEXT;
ALTER TABLE "ServiceOrder" ADD COLUMN IF NOT EXISTS "quantity"        INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ServiceOrder" ADD COLUMN IF NOT EXISTS "selectedOptions" JSONB;
ALTER TABLE "ServiceOrder" ADD COLUMN IF NOT EXISTS "requestedVia"    "ServiceRequestedVia" NOT NULL DEFAULT 'ADMIN';
ALTER TABLE "ServiceOrder" ADD COLUMN IF NOT EXISTS "guestNote"       TEXT;
```

---

## S3 — 게스트 셀프 체크인 토큰

### Prisma
```prisma
model GuestCheckinToken {
  id          String    @id @default(cuid())
  bookingId   String    @unique
  token       String    @unique
  expiresAt   DateTime
  revokedAt   DateTime?
  firstUsedAt DateTime?
  createdAt   DateTime  @default(now())
}

model CheckInRecord {
  // ...기존...
  agreementVersion String? // 서명 시점 동의서 판본(lib/agreement.ts AGREEMENT_VERSION)
}
```

### Raw SQL
```sql
CREATE TABLE IF NOT EXISTS "GuestCheckinToken" (
  "id"          TEXT PRIMARY KEY,
  "bookingId"   TEXT NOT NULL,
  "token"       TEXT NOT NULL,
  "expiresAt"   TIMESTAMP(3) NOT NULL,
  "revokedAt"   TIMESTAMP(3),
  "firstUsedAt" TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "GuestCheckinToken_bookingId_key" ON "GuestCheckinToken" ("bookingId");
CREATE UNIQUE INDEX IF NOT EXISTS "GuestCheckinToken_token_key"     ON "GuestCheckinToken" ("token");

ALTER TABLE "CheckInRecord" ADD COLUMN IF NOT EXISTS "agreementVersion" TEXT;
```

---

## S4 — 체크아웃 게스트 정산

> **선행 확인**: `CheckOutRecord`에 `minibarChargeVnd`(통계 v2)·기타 드리프트 컬럼이 라이브 DB에 이미 있는지 `information_schema.columns`로 조회 후, 커밋 스키마와 대조해 누락분을 함께 반영.

### Prisma
```prisma
enum GuestSettlementMethod { CASH BANK_TRANSFER OTHER }

model CheckOutRecord {
  // ...기존 (+ minibarChargeVnd 드리프트 반영)...
  guestChargeVnd   BigInt?               // 게스트 청구 합계(VND 채널)
  guestChargeKrw   Int?                  // 게스트 청구 합계(KRW 채널)
  settlementMethod GuestSettlementMethod?
  settledAt        DateTime?
  settlementNote   String?
}
```

### Raw SQL
```sql
DO $$ BEGIN
  CREATE TYPE "GuestSettlementMethod" AS ENUM ('CASH','BANK_TRANSFER','OTHER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "CheckOutRecord" ADD COLUMN IF NOT EXISTS "guestChargeVnd"   BIGINT;
ALTER TABLE "CheckOutRecord" ADD COLUMN IF NOT EXISTS "guestChargeKrw"   INTEGER;
ALTER TABLE "CheckOutRecord" ADD COLUMN IF NOT EXISTS "settlementMethod" "GuestSettlementMethod";
ALTER TABLE "CheckOutRecord" ADD COLUMN IF NOT EXISTS "settledAt"        TIMESTAMP(3);
ALTER TABLE "CheckOutRecord" ADD COLUMN IF NOT EXISTS "settlementNote"   TEXT;
-- (드리프트 시) ALTER TABLE "CheckOutRecord" ADD COLUMN IF NOT EXISTS "minibarChargeVnd" BIGINT;
```

---

## 적용 순서·검증
1. TDA 세션 단독으로 스프린트 순서(S1→S2→S3→S4)대로 raw SQL 적용(enum ADD VALUE 단독 배치).
2. 각 적용 후 `schema.prisma` 동일 수정 → `prisma generate`(push 금지) → typecheck.
3. `information_schema.columns`/`pg_enum` 조회로 반영 검증, `git cat-file -e origin/main:prisma/schema.prisma` 류로 커밋 반영 확인.
4. 누수 게이트(ADR-0019 §9): `costVnd`·마진은 서버 select 화이트리스트에서만 — 신규 테이블 추가 즉시 GET 라우트 select 점검.
