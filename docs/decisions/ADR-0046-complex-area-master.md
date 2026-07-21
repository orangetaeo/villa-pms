# ADR-0046: 지역(단지) 마스터 ComplexArea 도입 — additive FK + 비정규화 캐시 존치

- 상태: 승인 (2026-07-21, TDA)
- 태스크: T-complex-area-master (`docs/contracts/T-complex-area-master.md`)
- 관련: ADR-0038(업체 지역 커버리지 — region 문자열 정확일치)

## 문제

지역(단지)의 정본이 `Villa.complex` **자유 문자열**이라 표기 통일이 세 층에서 깨져 있었다.

1. 공급자 등록 드롭다운이 컴포넌트 하드코딩 (`step-basic.tsx` — `["Sonasea","Sunset Sanato","Vinpearl"]`)
2. 시드·과거 데이터에 한/영 혼용 표기 (`쏘나씨` vs `Sonasea` 등)
3. 서버 검증이 자유 문자열 허용 (`lib/villa-schema.ts` — `z.string().max(100)`)

같은 단지가 두 표기로 갈리면 **지역 필터·업체 자동발주(ADR-0038 ②단계)·공실보드 area 필터가 에러 없이 조용히 매칭 실패**한다.

## 결정

### D1. `ComplexArea` 마스터 신설 (단일 원천)

```
ComplexArea { id, code @unique, name @unique, nameKo?, active=true, sortOrder=0, createdAt, updatedAt, villas[] }
```

- `code` = 라틴 슬러그(불변 식별자, URL·스크립트용). `name` = **정본 표기 = 라틴 고유명사**(예: `Sonasea`) — 매칭·캐시에 이 값만 사용.
- `nameKo` = 운영자 화면 병기 전용. **매칭에 사용 금지.**
- `nameVi`는 두지 않는다 — 단지명은 고유명사이고 베트남 표기 = 라틴 정본 그대로. 향후 ru/zh 병기 필요 시 additive 컬럼 추가.
- **삭제 없음** — `active=false`가 은퇴(기존 빌라 연결 유지, 신규 선택만 차단).

### D2. 전환 전략 — additive FK + 캐시 존치 (완전 이관 기각)

- `Villa.complexAreaId String?` FK를 **additive**로 추가. `Villa.complex`는 삭제하지 않고 **마스터 `name`의 비정규화 캐시**로 유지.
- 근거: `complex` 문자열을 select만 하는 표시 전용 소비처가 20여 곳(게스트 영수증·체크인·파트너 포털·통계·인스타 캡션 등). 완전 이관은 이들 전부 + `ServiceVendorRegion.region`(ADR-0038) + partner 검색을 동시 수정해야 해 파급이 크다. 캐시 유지 시 이들은 **변경 0으로 하위호환**.
- 이후 `Villa.complex`는 서버가 마스터에서 파생해서만 쓴다(클라이언트 자유 문자열 수신 금지 — 봉인은 BE 후속 단계 D4).
- 마스터 `name` 변경(rename) 시: 서버가 한 트랜잭션으로 해당 빌라 전체 `complex` + `ServiceVendorRegion.region`(구 name 정확일치) 일괄 rewrite + AuditLog. 이것이 캐시 정합의 유일한 쓰기 경로.
- `ServiceVendorRegion.region` FK 전환·`Villa.complex` 컬럼 제거는 후속 태스크.

### D3. 초기 데이터 (2026-07-21 실측 기반 — 대규모 백필 불요)

- 라이브 프로브 실측: 빌라 2개(`Sonasea` 1 + null 1), `ServiceVendorRegion` 0건 → 계약서의 정규화 매핑·dry-run 백필 절차는 **불필요로 축소**(테오 확정).
- 초기 마스터 4개 시드(`scripts/seed-complex-areas.ts`, code 기준 멱등 upsert): Sonasea(쏘나씨)·Sunset Sanato(썬셋 사나토)·Vinpearl(빈펄)·Greenbay(그린베이).
- `complex="Sonasea"` 빌라 1건만 마스터에 연결. null 빌라는 미연결 유지.

### D4. 라이브 반영 규약

- `prisma/migrations-manual/2026-07-21-complex-area-master.sql` — additive only(CREATE TABLE, ADD COLUMN, 인덱스, FK는 `DO $$ pg_constraint` 멱등 블록). `migrate dev`·`db push` 금지 규약 준수, 적용 후 `prisma generate`.
- FK는 `ON DELETE SET NULL`(마스터 행 삭제는 운영상 없지만 방어) `ON UPDATE CASCADE`.

## 결과

- (+) 지역 매칭의 단일 원천 확보 — 표기 분열로 인한 조용한 매칭 실패 원천 차단.
- (+) 표시 전용 소비처 20여 곳 변경 0 (캐시 하위호환).
- (−) 캐시(`complex`)와 마스터(`name`)의 정합을 rename 전파 트랜잭션이 책임져야 함 — 이 경로 외 `Villa.complex` 쓰기 금지(grep 게이트).
- (−) 이중 표현(FK+문자열)이 당분간 공존 — 완전 이관은 후속.

## 후속 (이 ADR 범위 밖 — 계약서 §5·§9)

- BE: 서버 봉인(villa-schema `complexAreaId` 교체, villas API 마스터 lookup, vendors regions 마스터 대조) + `GET /api/complex-areas`
- FE: 관리자 CRUD(`settings/complex-areas`, rename 전파, **writeAuditLog 필수**) — 시드는 초기 데이터라 감사로그 없음, CRUD부터는 전 변경 기록
- UX-VN: 공급자 마법사 드롭다운 마스터 연동(하드코딩 삭제)
- QA: 계약서 §6 완료 기준 8종 전수 검증
