# T-minibar-supplier-leak-close — 미니바 공급자 노출 누수 차단 (#2a)

## 배경 / 근거
2026-06-24 테오 신규요구 #2: "미니바는 우리 회사가 직접 운영(공급자 미관여)."
QA 감사 결과(전체 회의): `VillaAmenity.unitPrice`는 코드·주석·소비처(체크아웃 차감) 어디로 봐도
**고객 청구가 = 우리 판매가**다. 그런데 현재 **공급자가 입력·수정·열람** 가능 →
사업원칙 2(판매정보 공급자 노출 금지) **위반 중**. 즉시 차단 대상.

근거 위치:
- `prisma/schema.prisma:226` — `unitPrice BigInt? // 미니바 고객 청구 단가`
- `app/(admin)/bookings/[id]/checkout/checkout-form.tsx` — 차감액 = 소모수량 × unitPrice (고객 보증금 차감)
- 누수 경로: `PATCH /api/villas/[id]/amenities` SUPPLIER 통과(route.ts:65) + MINIBAR unitPrice 저장(106-109)
- 의미혼선: `app/(supplier)/.../amenities-editor.tsx` 주석이 unitPrice를 "공급자 원가"로 **오라벨**(오판 근원)

## 범위 (이 태스크가 하는 것)
1. **공급자 쓰기 차단 (1차 방어선 — 필수)**: `PATCH /api/villas/[id]/amenities`의 SUPPLIER 경로에서 **MINIBAR 카테고리 입력·수정 제거**.
   - 운영자(isOperator) 경로는 무변경(ADMIN은 계속 미니바 운영).
   - **silent drop 확정(403 금지)**: SUPPLIER 분기에서 들어온 amenity 배열 중 MINIBAR 항목만 필터로 드롭(`a.category !== "MINIBAR"`). 마법사·에디터가 전 카테고리를 한 배열로 보내므로 403을 던지면 타월 등 비-MINIBAR 저장까지 실패함 — 반드시 드롭.
   - **UI 제거는 보조**: 범위 2번(UI)만으로는 직접 PATCH 호출로 우회 가능. **API 드롭이 진짜 게이트**다.
2. **공급자 읽기/UI 제거**: 공급자 비품 에디터·prefill에서 MINIBAR 탭·단가 입력 UI 제거.
   - `app/(supplier)/my-villas/[id]/amenities/amenities-editor.tsx`
   - `app/(supplier)/my-villas/[id]/amenities/page.tsx` (prefill에서 MINIBAR 제외)
3. **의미혼선 주석 정정**: unitPrice를 "공급자 원가"라 부르는 주석을 "고객 청구가(우리 판매가) — 공급자 비노출"로 정정.

## 범위 밖 (이 태스크가 안 하는 것)
- #2b 회사 표준 `MinibarItem` 모델 신설·체크아웃 차감 재배선 → **별도 태스크**(B10-S 머지 후, TDA 스키마).
- ADMIN 미니바 운영 UI 개편(현 `app/(admin)/villas/[id]/.../amenities-editor.tsx`가 이미 편집 제공 — 무변경).
- 기존 공급자 입력 미니바 데이터 폐기/이관 → #2b에서 처리.

## 수정 금지 구역 (병렬 세션)
- `lib/cleaning.ts`·`lib/hold.ts`·`lib/proposal.ts`·`docs/DESIGN.md`·`messages/*.json` — 타 세션 WIP, 비접촉.
- `app/(admin)/bookings/[id]/checkout/*` — **B10-S 작업 영역, 비접촉**(#2b에서만 손댐).
- `prisma/schema.prisma` — 본 태스크 스키마 무변경.

## 완료 기준 (테스트 가능)
- [ ] SUPPLIER가 `PATCH /api/villas/[id]/amenities`로 MINIBAR amenity(unitPrice 포함)를 보내도 **저장되지 않음**(DB에 MINIBAR 미생성/미변경). 비-MINIBAR amenity는 정상 저장.
- [ ] SUPPLIER 빌라 상세/비품 에디터 화면에 **미니바 탭·단가 입력 UI가 없음**(렌더 0).
- [ ] SUPPLIER 빌라 상세(`(supplier)/my-villas/[id]/page.tsx`)에 **미니바 단가 미표시**(회귀 가드 — 현재도 미표시, 명시적으로 고정). 단 빌라 시즌 원가(supplierCostVnd)는 정상 노출 유지.
- [ ] ADMIN 경로의 미니바 입력·체크아웃 차감은 **회귀 0**(기존 동작 유지).
- [ ] unitPrice "공급자 원가" 오라벨 주석 0건(grep).
- [ ] `npm run typecheck` 0, `npm test` 그린(신규 단위테스트 포함), 누수 매트릭스: SUPPLIER가 미니바 판매가에 접근 불가 실증.

## 검증 방법
- 단위테스트: amenities PATCH의 SUPPLIER+MINIBAR 입력 드롭, 비-MINIBAR 정상.
- QA 독립 평가(작성자≠평가자): SUPPLIER 세션으로 미니바 입력 시도 차단 실증 + ADMIN 미니바·체크아웃 회귀 확인.

## 담당 / 파이프라인
BE(API 차단) + UX-VN(공급자 UI 제거) → QA 독립 평가 → PM 보고.
