# T-complex-area-master — 지역(단지) 마스터 단일 원천 도입

- 상태: 계약(설계 확정) — 구현 착수 전
- 담당: TDA(설계·스키마·라이브 SQL) / BE(백필·서버 봉인) / UX-VN(공급자 드롭다운) / FE(관리자 CRUD) / QA(전수 검증)
- ADR: **ADR-0046-complex-area-master.md** 작성 예정 (★병합 직전 origin/main에서 번호 재확인 — 현재 최신 0045)
- 브랜치: `wt/complex-area` (worktree `C:\Projects\_worktrees\villa-pms-complex-area`, 포트 3034)

## 1. 문제 (현행 결함 3건 — 실코드 확인됨)

현재 "지역"의 정본은 `Villa.complex` **자유 문자열**이다. 마스터가 없어 표기 통일이 코드·데이터·검증 세 층에서 전부 깨져 있다.

| # | 결함 | 위치 |
|---|---|---|
| 1 | 공급자 등록 드롭다운이 컴포넌트 하드코딩 | `app/(supplier)/my-villas/new/step-basic.tsx:10` → `["Sonasea","Sunset Sanato","Vinpearl"]` |
| 2 | 시드/실DB 단지명 한/영 혼용 | `prisma/seed-villas-realistic.ts:13` — `쏘나씨/Sonasea`, `썬셋 사나토`, `그린베이` 등. `lib/gemini.ts:438`에는 한글 표기→라틴 변환 프롬프트까지 존재(표기 분열의 방증) |
| 3 | 서버 검증이 자유 문자열 허용 | `lib/villa-schema.ts:51` → `complex: z.string().trim().max(100).optional()` |

같은 단지가 `쏘나씨`/`Sonasea`로 갈리면 **지역 필터·업체 자동발주(ADR-0038)·공실보드 area 필터가 조용히 오동작**한다(에러 없이 매칭 실패).

## 2. 소비처 전수 목록 (2026-07-21 grep 실측 — 회귀 검증 대상)

### 쓰기 경로 (봉인 대상)
- `app/api/villas/route.ts:79` — 빌라 생성 시 `complex: data.complex || null`
- `app/api/villas/[id]/route.ts:203` — 빌라 수정(운영자) 동일 패턴
- `app/api/villas/[id]/info/route.ts` — 공급자 정보수정. **complex는 이미 수신 배제**(주석 확인) → 변경 없음, 회귀만 확인
- `lib/villa-schema.ts:51` — zod 검증(자유 문자열)
- `app/api/vendors/[id]/regions/route.ts` — `ServiceVendorRegion.region` 문자열 replace-set 저장 (trim만, 마스터 대조 없음)

### 문자열 정확일치 매칭 경로 (표기 분열 시 실제 깨지는 곳)
- `lib/regional-vendor.ts:72~87` — `region == villa.complex` 정확일치로 업체 자동 지정 (ADR-0038 해석 ②단계)
- `lib/availability.ts:401·493` — 공실보드 area 필터 = `complex` 정확일치
- admin 목록 5곳의 area 필터 (`distinct: ["complex"]` 옵션 생성): `app/(admin)/villas/page.tsx:115` · `settings/vendors/page.tsx:73` · `bookings/new/page.tsx:57` · `availability/page.tsx:103` · `inspections/page.tsx:104` (+`bookings/page.tsx:301` 주석 기준 동일 패턴)

### 표시 전용 (complex 문자열을 읽기만 — 비정규화 캐시 유지 시 변경 0)
`lib/guest-receipt.ts` · `lib/guest-checkin-load.ts` · `lib/partner-portal.ts`(검색 contains 포함) · `lib/statistics.ts` · `lib/minibar-inventory-load.ts`(orderBy) · `lib/instagram/caption.ts·draft.ts` · `app/api/villas/bookable/route.ts` · `app/(admin)` 다수 화면 · `app/g/**` 게스트 화면 · `app/partner/**`

## 3. 설계 결정

### D1. 모델 — `ComplexArea` 신설

```prisma
// 지역(단지) 마스터 — 단일 원천 (ADR-0046). Villa.complex는 이 마스터 name의 비정규화 캐시.
model ComplexArea {
  id        String   @id @default(cuid())
  code      String   @unique // 라틴 슬러그 (예: sonasea, sunset-sanato) — 불변 식별자, URL·스크립트용
  name      String   @unique // 정본 표기 = 라틴 고유명사 (예: Sonasea). Villa.complex 캐시에 이 값이 들어간다
  nameKo    String?  // 한국어 병기 (예: 쏘나씨) — 운영자 화면 병기 전용, 매칭에 사용 금지
  active    Boolean  @default(true) // 비활성 = 신규 선택 불가 (기존 빌라 연결은 유지). 삭제 없음
  sortOrder Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  villas    Villa[]
}
```

**nameVi를 두지 않는 이유(판단)**: 단지명은 고유명사이고 베트남 표기 = 라틴 정본 그대로(`Sonasea`)다. `lib/gemini.ts` 번역 프롬프트도 "고유명사 무변환" 규칙. 이중 보관은 `name`(라틴 정본, vi 화면·매칭 캐시) + `nameKo`(운영자 병기)로 충분. 향후 ru/zh 병기가 필요해지면 additive 컬럼 추가(후속).

### D2. 전환 전략 — additive FK + 비정규화 캐시 (완전 이관 기각)

- `Villa.complexAreaId String?` FK를 **additive**로 추가. `Villa.complex`(문자열)는 **삭제하지 않고 마스터 `name`의 비정규화 캐시로 유지**.
- 단일 원천 = 마스터. **`Villa.complex`는 이후 서버가 마스터에서 파생해서만 쓴다**(클라이언트 자유 문자열 수신 금지).
- 근거: §2 표시 전용 소비처 20여 곳이 전부 `complex` 문자열을 select한다. 완전 이관은 이들 전부 + `ServiceVendorRegion.region`(ADR-0038) + partner 검색을 동시 수정해야 해 파급이 크고, 캐시 유지 시 이들은 **변경 0으로 하위호환**된다.
- `ServiceVendorRegion.region`은 문자열 유지(정본 `name` 값과 정확일치 — 백필로 정규화). FK 전환은 후속 태스크(§7).
- **rename 전파**: 마스터 `name` 변경 시 서버가 한 트랜잭션으로 `Villa.complex`(해당 complexAreaId 전체) + `ServiceVendorRegion.region`(구 name 정확일치) 일괄 rewrite + AuditLog. 이게 캐시 정합의 유일한 쓰기 경로.

### D3. 기존 실데이터 정규화 (★2026-07-15 와이프 이후 실데이터 — 시드 재실행 금지)

1. **실측 프로브(읽기 전용)**: `scripts/probe-distinct-complex.ts` 작성 → `railway run npx tsx scripts/probe-distinct-complex.ts`
   - `prisma.villa.groupBy({ by: ["complex"], _count: true })` + `serviceVendorRegion.groupBy({ by: ["region"] })` 출력만. **쓰기 없음.**
   - (수동 대안: `npx prisma studio`로 Villa.complex 육안 확인 — 프로브 스크립트가 정본)
2. **정규화 매핑 표 확정**: 프로브 결과를 아래 표 초안에 대조, 테오/TDA가 확정. **미매핑 값은 자동 처리 금지 — 보류 목록으로 출력하고 사람이 결정.**

   | 라이브 예상 값 (프로브로 확정) | 정본 name | code | nameKo |
   |---|---|---|---|
   | `쏘나씨`, `쏘나씨/Sonasea`, `Sonasea` | Sonasea | sonasea | 쏘나씨 |
   | `썬셋 사나토`, `Sunset Sanato` | Sunset Sanato | sunset-sanato | 썬셋 사나토 |
   | `그린베이`, `Green Bay` | Green Bay | green-bay | 그린베이 |
   | `Vinpearl` | Vinpearl | vinpearl | 빈펄 |
   | `마리나`, `Marina` | Marina | marina | 마리나 |
3. **백필 스크립트**: `scripts/backfill-complex-area.ts` — `--dry-run` 기본(변경 예정 목록만 출력), `--apply`에서만 쓰기. 한 트랜잭션으로:
   ① 매핑 표대로 ComplexArea upsert(code 기준) → ② `Villa.complexAreaId` 세팅 + `Villa.complex`를 정본 name으로 rewrite → ③ `ServiceVendorRegion.region`을 정본 name으로 rewrite(중복 발생 시 `@@unique(vendorId,serviceType,region)` 충돌 — 사전 dedupe 후 rewrite) → ④ 미매핑 값 보류 목록 출력(건드리지 않음).
   - AuditLog: 스크립트 실행 1건 요약 기록(시스템 userId). 백필은 캐시 정규화이지 역사 생성이 아님.

### D4. 서버 봉인

- `lib/villa-schema.ts`: `complex` 필드 → `complexAreaId: z.string().trim().min(1).max(40).optional()`로 교체. 구 `complex` 키는 스키마에서 제거(수신되어도 zod strip).
- `app/api/villas/route.ts`·`[id]/route.ts`: `complexAreaId` 수신 → 마스터 lookup(`active: true`, 미존재/비활성 400 `UNKNOWN_COMPLEX`) → `complexAreaId` + `complex = master.name` 동시 저장. 해제는 `complexAreaId: null` 명시 시 둘 다 null.
- `app/api/vendors/[id]/regions/route.ts`: 수신 region 문자열이 **active 마스터 name 집합에 없으면 400 `UNKNOWN_REGION`** (기존 trim 정규화 뒤에 추가).
- 봉인 검증: `Villa.complex`에 쓰는 코드 grep → 위 서버 경로 + rename 전파 + 백필 스크립트 외 0건.

### D5. 조회 API + 관리자 CRUD (이번 태스크 포함 — 최소 범위)

- `GET /api/complex-areas` — **로그인 필수**(SUPPLIER·운영자). active만, 응답 `{ id, name, nameKo, sortOrder }`만. 비로그인 404. (단지 목록은 재고·마진 아님 — 누수 등급 무해, 단 비로그인 차단)
- 관리자 CRUD: `app/(admin)/settings/complex-areas` — 목록·생성·수정(name/nameKo/sortOrder)·active 토글. **삭제 없음**(active=false가 은퇴). name 수정 = D2 rename 전파 트랜잭션. 전 변경 AuditLog. 권한 isOperator(FINANCE 아님 — 재무 아님).
- 포함 근거: CRUD 없이는 하드코딩 제거 후 신규 단지 추가 경로가 없어 태스크가 자기완결되지 않는다. 화면은 settings/vendors 기존 패턴 준용(신규 Stitch 불요 — 기존 설정 화면 컴포넌트 재사용, DESIGN 개입 없음).

### D6. 공급자 드롭다운 (UX-VN)

- `step-basic.tsx`의 `COMPLEXES` 하드코딩 삭제 → 마법사 서버 컴포넌트에서 active 마스터 조회해 props 주입(또는 GET /api/complex-areas). 표시 = `name`(라틴 — vi 사용자 그대로 읽음), 운영자 모드(isAdmin)면 `name (nameKo)` 병기.
- "선택 안 함" 옵션 유지(complexAreaId optional). 목록에 없는 단지는 자유 입력 불가 — 운영자에게 요청(마법사에 vi 안내 1줄, Zalo 유도). 자유 입력 요청 플로우는 후속.
- 자문: "베트남 중계인이 설명 없이 쓸 수 있는가?" → 드롭다운 선택만, 텍스트 입력 0 — 기존보다 단순.

## 4. 라이브 DB 적용 raw SQL 초안

파일: `prisma/migrations-manual/2026-07-21-complex-area-master.sql` (적용 후 보존 — 감사 추적 정본). `prisma migrate dev`·`db push` 금지.

```sql
-- T-complex-area-master (ADR-0046): 지역(단지) 마스터 + Villa FK — additive only
CREATE TABLE IF NOT EXISTS "ComplexArea" (
  "id"        TEXT NOT NULL,
  "code"      TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "nameKo"    TEXT,
  "active"    BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ComplexArea_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ComplexArea_code_key" ON "ComplexArea"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "ComplexArea_name_key" ON "ComplexArea"("name");

ALTER TABLE "Villa" ADD COLUMN IF NOT EXISTS "complexAreaId" TEXT;
CREATE INDEX IF NOT EXISTS "Villa_complexAreaId_idx" ON "Villa"("complexAreaId");

-- PG는 ADD CONSTRAINT IF NOT EXISTS 미지원 — DO 블록으로 멱등 처리
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Villa_complexAreaId_fkey') THEN
    ALTER TABLE "Villa"
      ADD CONSTRAINT "Villa_complexAreaId_fkey"
      FOREIGN KEY ("complexAreaId") REFERENCES "ComplexArea"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
```

적용 직후 `npx prisma generate` 필수.

**★generate 레이스 경고**: worktree의 `node_modules`는 메인 폴더 정션 공유다. 타 세션(T-webchat-cards)이 schema.prisma 편집 중이므로, **schema.prisma 모델 추가·라이브 SQL 적용·generate는 그 세션의 스키마 작업 완료(main 병합) 확인 후** TDA 세션이 전담한다(병렬 규칙 #6, [[공유 node_modules generate 레이스]]). 그 전에는 코드 작업도 새 Prisma 타입에 의존하지 않는 단계(프로브·매핑 확정)만 진행.

## 5. 범위

### 포함
1. schema.prisma: `ComplexArea` 모델 + `Villa.complexAreaId` (worktree 반영 → 라이브 raw SQL → generate)
2. 프로브 스크립트(읽기 전용) + 정규화 매핑 확정 + 백필 스크립트(dry-run/apply)
3. 서버 봉인: villa-schema.ts · villas create/update API · vendors regions PUT (D4)
4. `GET /api/complex-areas` + 관리자 CRUD(settings, rename 전파 포함) (D5)
5. 공급자 마법사 드롭다운 마스터 연동 + 하드코딩 삭제 (D6)
6. `seed-villas-realistic.ts` 단지명 정본 표기로 정정(시드 재실행은 안 하지만 문서적 정합 — 파일 상단에 "실DB 재실행 금지" 주석 확인)
7. ADR-0046 작성, `docs/INDEX.md` 등록

### 제외 (후속 태스크 — IDEAS/TASKS 등재)
- `ServiceVendorRegion.region` → FK 전환 (문자열 유지 + 정규화 백필까지만)
- `Villa.complex` 컬럼 제거 (캐시로 존치)
- 공급자 "신규 단지 요청" 플로우 (당장은 Zalo 안내)
- partner-portal 검색 contains 개선, 다국어 병기 확장(ru/zh), `lib/gemini.ts` 프롬프트 내 단지 예시 정리
- 지역 필터의 complexAreaId 기반 재작성 (캐시 정확일치로 기존 동작 유지 — 회귀 검증만)

## 6. 완료 기준 (테스트 가능)

1. **[봉인]** 빌라 생성/수정 API에 임의 문자열 `complex` 전송 → 저장값에 미반영(strip). 존재하지 않는/비활성 `complexAreaId` → 400 `UNKNOWN_COMPLEX`. vendors regions PUT에 마스터 외 문자열 → 400 `UNKNOWN_REGION`.
2. **[단일 원천]** `Villa.complex` 쓰기 경로 grep = 서버 파생 경로(생성/수정 API·rename 전파·백필) 외 0건. `step-basic.tsx`에 하드코딩 배열 0건.
3. **[백필]** 백필 apply 후: `SELECT DISTINCT complex FROM "Villa"` 결과 전부 마스터 `name`과 일치(NULL 제외), `complexAreaId` NULL인데 `complex` NOT NULL인 행 0, `ServiceVendorRegion.region` 전부 마스터 name 집합 ⊆. 미매핑 값은 보류 목록으로 출력되고 데이터 무변경.
4. **[rename 전파]** 관리자에서 name 변경 → 해당 빌라 전체 `complex` + `ServiceVendorRegion.region` 동시 갱신(트랜잭션) + AuditLog 기록.
5. **[회귀]** 공실보드 area 필터·admin 5개 화면 area 필터·업체 자동발주(regional-vendor ②단계)가 정규화 후에도 동작 — 특히 백필 전 한글 표기였던 빌라가 필터·자동발주에 정상 잡힘.
6. **[권한 누수 0]** GET /api/complex-areas 비로그인 404/401. 응답에 id/name/nameKo/sortOrder 외 필드 없음. 공급자 화면·API 응답에 마진·판매가·타 공급자 재고 노출 0(기존 게이트 회귀 포함). CRUD는 isOperator만.
7. **[AuditLog]** ComplexArea 생성/수정/토글·백필 실행 전부 기록.
8. `npm run lint && npm run typecheck && npx next build` 통과, `lib/availability.test.ts` 등 기존 테스트 그린.

## 7. 검증 방법 (QA)

- **스크립트**: 완료 기준 3의 SQL 3종을 검증 스크립트로 실행(읽기 전용, railway run). 기준 1·6은 curl(비로그인/SUPPLIER/ADMIN 3역할 × complex 주입·UNKNOWN 케이스).
- **Playwright(프로덕션)**: ① 공급자 마법사 — 드롭다운이 마스터 목록과 일치·자유 입력 불가·"선택 안 함" 동작 ② admin settings — 단지 생성→마법사 드롭다운 즉시 반영, rename→빌라 목록 area 필터 라벨 갱신 ③ 공실보드 area 필터로 정규화된 단지 선택 시 해당 빌라만 표시 ④ SUPPLIER 계정으로 마스터 CRUD URL 직접 접근 → 차단.
- **grep 감사**: 완료 기준 2 + `stripOptionCosts`류 기존 누수 게이트 무회귀.
- 작성자 자기평가 무효 — QA 독립 수행.

## 8. 수정 금지 구역 (병렬 세션)

- **메인 폴더 `C:\Projects\villa-pms` 전체** — 읽기 포함 일절 접근 금지. 모든 작업은 이 worktree에서.
- 타 세션 T-webchat-cards 작업 파일: `app/(admin)/messages/**`(webchat-*·share-modals·chat-pane), `app/api/webchat/**`, `app/api/zalo/conversations/**`, 관련 schema.prisma 웹챗 모델 구역. §2에서 messages 화면이 complex 표시 소비처로 잡히지만 **이번 태스크에서 수정 불요·금지**(캐시 유지로 변경 0).
- schema.prisma 편집·라이브 SQL·generate는 §4 경고대로 T-webchat-cards 스키마 작업 완료 확인 후 착수.
- 공유 파일: `messages/ko.json`·`vi.json` 키 추가만(admin CRUD·마법사 문구 — ADMIN_CLIENT_NAMESPACES 등록 + ko/vi 동시), `package.json` 동결.

## 9. 구현 순서 · 담당

| 단계 | 내용 | 담당 | 게이트 |
|---|---|---|---|
| 0 | ADR-0046 작성 + schema.prisma 모델(worktree) | TDA | 본 계약 합의 |
| 1 | 프로브 스크립트 → 라이브 distinct 실측 → 매핑 표 확정 | BE → 테오/TDA | 읽기 전용 — 즉시 가능 |
| 2 | 라이브 raw SQL 적용 + migrations-manual 보존 + generate | TDA | ★T-webchat-cards 스키마 완료 확인 후 |
| 3 | 마스터 시드(매핑 표) + 백필 dry-run → 테오 확인 → apply | BE | dry-run 출력 검토 필수(실데이터) |
| 4 | 서버 봉인(villa-schema·villas API·vendors regions) + GET /api/complex-areas | BE | 3 완료 후(빈 마스터에 봉인하면 등록 불능) |
| 5 | 공급자 마법사 드롭다운 연동 | UX-VN | 4와 병행 가능 |
| 6 | 관리자 CRUD + rename 전파 | FE | 4 완료 후 |
| 7 | 전수 검증(§7) → PROGRESS.md 갱신 → PR | QA → PM | 완료 기준 8/8 |

## 10. 미결 판단사항 (테오 결정 필요)

1. 정규화 매핑 표(§D3) 최종 확정 — 특히 프로브에서 예상 외 값·미매핑 값이 나올 때의 정본 표기.
2. 초기 마스터에 넣을 단지 전체 목록 — 현 하드코딩 3개(Sonasea·Sunset Sanato·Vinpearl) + 시드 유래(Green Bay·Marina) 외 신규 운영 예정 단지가 있으면 함께 시드.
3. `nameKo` 병기 노출 범위 — 계약 기본값: 운영자 화면만 병기, 공급자·게스트는 라틴 `name` 단독.
