# T-guest-amenity-quantity — 게스트 체크인 G2 비품 수량 표시

- 상태: 완료 (2026-07-15, QA PASS 결함 0건 — tsc·lint·build 통과)
- 요청: 소비자(게스트) 체크인 화면에서 비품의 수량을 확인할 수 없음 → 수량 노출.

## 배경 (Triage)

- 공급자 마법사(T-amenity-quantity-custom, 2026-07-10)로 모든 비품에 수량(1~99) 입력·저장됨 (`VillaAmenity.quantity`).
- 운영자 체크인 시트는 품목별 수량을 인쇄함.
- 그러나 게스트 로더 `lib/guest-checkin-load.ts`의 villaAmenity select에 `quantity`가 없고,
  G2 화면(`app/g/_components/guest-flow.tsx`)은 품목 라벨 칩만 표시 — 수량 표시 없음 (미니바만 있음).
- /p 공개 제안 페이지는 빌라 비품 자체를 노출하지 않음 → 범위 외.

## 설계 결정

1. G2 비품 칩에 수량을 `×N` 접미로 표시하되 **N≥2일 때만** 표시. quantity 기본값 1은 "있음" 의미(스키마 주석)라
   ×1 전면 표기는 노이즈 — 수건 대/중/소 등 실수량 항목만 숫자가 붙는다.
2. `×N`은 언어 중립 표기 — 게스트 5언어(ko/vi/en/zh/ru) i18n 키 추가 불필요.
3. 미니바 섹션은 현행 유지(이미 수량 표시 있음).

## 범위 (파일)

- `lib/guest-checkin-load.ts` — amenities select에 `quantity: true` + 반환 타입에 `quantity: number`
- `app/g/[token]/page.tsx` — amenityGroups 조립 시 qty 전달
- `app/g/_components/types.ts` — `GuestAmenityGroup.items`를 `{ label, qty }[]`로 변경
- `app/g/_components/guest-flow.tsx` — 칩에 qty≥2일 때 `×N` 표시

## 수정 금지 구역

- 미니바(MinibarItem·villaMinibarStock), 카탈로그/주문, 동의서·여권 단계, messages/*.json, package.json

## 완료 기준 (테스트 가능)

1. quantity≥2인 비품이 게스트 G2 화면 칩에 `라벨 ×N`으로 표시.
2. quantity=1 비품은 기존과 동일하게 라벨만 표시.
3. 게스트 응답에 원가·마진·판매가 등 신규 노출 없음 (quantity만 추가 — 민감정보 아님).
4. `npm run lint && npm run typecheck && next build` 통과.

## 검증 방법

- QA 에이전트가 diff 검토(누수·타입 소비처 회귀) + 완료 기준 채점. 작성자 자기평가 무효.
