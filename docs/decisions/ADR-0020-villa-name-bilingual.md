# ADR-0020 — 빌라명 베트남어 병기 (nameVi)

- 상태: Accepted (2026-06-25, 테오 결정)
- 관련: ADR-0011(판매용 정보), [[settlement-pdf-korean-glyph-fix]]

## 배경

빌라명(`Villa.name`)이 한국어 음역으로 저장된다(예: `쏘나씨 V11`, `썬셋 사나토 A3` — Sonasea/Sunset Sanato 등 실제 푸꾸옥 리조트명의 한국어 표기 + 호수). 베트남 공급자·외부(여행사/고객)는 한국어를 못 읽어 정산서·수익·제안서에서 자기 빌라를 식별하기 어렵다(정산서 PDF 한글 깨짐 제보에서 발견).

## 결정 (테오 3택)

1. **표기 방식 = 병기**: 비운영자 화면·문서에 `한국어명 (베트남어명)` 형태로 함께 표시. 예: `쏘나씨 V11 (Sonasea V11)`. 운영자(ADMIN) 화면은 한국어 원문(name) 유지.
2. **데이터 출처 = Gemini 자동 음역 + ADMIN 확정**: Gemini가 한국어명을 라틴/베트남 통용 표기로 음역 제안 → ADMIN이 검수·수정·저장. nameVi는 **ADMIN이 확정한 값만** 기록(자동 무인 저장 금지 — 리조트명 오역 위험).
3. **적용 범위 = 외부 노출 전체**: 공급자·청소자·공개(/p)·정산서 PDF·Zalo 공유 등 비운영자가 보는 모든 빌라명 표시 지점.

## 설계

### 스키마 (additive)
`Villa.nameVi String?` 추가. `descriptionVi` 선례와 동일. nullable — 미확정 빌라는 폴백(name만).
라이브 DB는 드리프트 존재 → `prisma db push` 금지, **raw SQL `ALTER TABLE "Villa" ADD COLUMN IF NOT EXISTS "nameVi" TEXT`**(멱등·additive·무손실)로 적용. [[db-schema-drift-villa-source]]

### 표기 헬퍼 — `lib/villa-name.ts`
`formatVillaName({name, nameVi})` → nameVi 있고 name과 다르면 `name (nameVi)`, 아니면 name. 순수·테스트 가능. 운영자 화면은 미사용(name 직접).

### Gemini 음역 — `lib/gemini.ts` `romanizeVillaName(name)`
한국어 리조트명 → 공식 라틴 철자(Sonasea·Sanato 등), 호수·영숫자(V11·A3)는 그대로 보존. temperature 0. 키 미설정 시 `GeminiNotConfiguredError`. **제안값**일 뿐 — ADMIN 확정 전 저장 안 함.

### ADMIN 확정 UI
빌라 상세(app/(admin)/villas/[id])에 nameVi 편집 섹션: 현재값 표시 + "Gemini 제안" 버튼(suggest API 호출→입력칸 채움) + 수정 가능 입력 + 저장(PATCH). ADMIN(canManage) 전용.

### 누수 무관
빌라명은 마진·재고·가격이 아니므로 비공개 원칙과 무관. 단 select에 nameVi 한 줄 추가 외 다른 필드 확장 금지.

## 대안 기각
- 대체(베트남어만): 운영자·한국 고객이 못 알아봄 → 병기로 양측 모두 식별. (테오 선택)
- 공급자 입력: 빌라명은 운영자가 정하는 경우 많아 일관성 저하 → ADMIN 확정.
- 단일 CJK 폰트로 PDF 통일: 베트남어 정밀 글리프 미보장 → 병기 + 폰트 런 분리 유지([[settlement-pdf-korean-glyph-fix]]).
