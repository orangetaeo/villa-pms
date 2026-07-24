# 계약서: 웹챗 빌라 공유 이식 + 판매가 계층 버그 수정

- 담당: BE(구현) → FE/UX(웹챗 UI) → QA(독립 검증). 메인 세션=설계·병합
- 브랜치/worktree: `wt/webchat-villa-share`
- 배경(테오 2026-07-24):
  1. **판매가 계층 버그**: Zalo 빌라 공유가 요율의 `salePriceVnd`(= Net 여행사 도매가)를 그대로 읽어, 고객(일반소비자) 대화에도 **도매가**가 나감. 소비자 마진(consumerSalePrice) 미반영 → 마진 손실. 실측 M villa V01 비수기: Net 11,000,000 / 소비자 12,100,000.
  2. **웹챗 빌라 공유 부재**: Zalo엔 있는 빌라 공유가 웹챗엔 없음. 동일하게(간단정보+대표가+빌라상세링크) 이식. 웹챗 방문자=일반소비자 → 소비자가.

## 결정 (사업 원칙)
- **가격 계층은 상대 타입으로 결정**(ADR-0031):
  - CUSTOMER(일반소비자)·웹챗 방문자 → **CONSUMER**(`consumerSalePrice* ?? salePrice*` 폴백)
  - TRAVEL_AGENCY·LAND_AGENCY → **NET**(`salePrice*`)
- **통화는 빌라 공유 = 항상 VND**(직전 결정 유지). 대표가 = **시즌 우선-else-base** 최저(직전 결정 유지).
- 웹챗은 무금액 설계였으나 테오 승인으로 빌라 공유에 한해 소비자 VND 대표가 노출(AskUserQuestion 2026-07-24).
- 누수 불변식: consumerSalePrice*/salePrice*는 판매가라 조회 허용. **supplierCostVnd·marginType·marginValue는 계속 미조회.**

## 수정 금지 구역
- 없음. 공유 파일(`messages/ko.json`·`vi.json`, webchat-types)은 **추가만**.

---

## 범위 A — 판매가 계층 버그 수정 (Zalo)

### A1. `lib/pricing.ts` — 계층 인지 대표가 헬퍼
- 기존 `pickLowestSalePrice(rates, useKrw)`를 **계층 인지**로 확장(또는 신규 `pickLowestTierPrice`):
  - 시그니처: `(rates, useKrw, tier: PriceTier)` — tier 기본 `"NET"`(하위호환).
  - 각 행의 유효가 = `tier==="CONSUMER" ? (consumerSalePrice{Vnd|Krw} ?? salePrice{Vnd|Krw}) : salePrice{Vnd|Krw}`.
  - 규칙은 그대로 **시즌(비-base, 유효가>0) 최소 → 없으면 base(유효가>0) → 없으면 null**.
  - rates 타입에 `consumerSalePriceVnd:bigint|null`, `consumerSalePriceKrw:number|null` 추가(선택 필드).
- `PriceTier`·`priceTierForChannel`·계층 폴백은 기존 pricing.ts 정의 재사용.
- 상대 타입 → tier 매핑 헬퍼(신규, `lib/zalo-counterparty.ts` 또는 pricing.ts): `tierForCounterparty(type): PriceTier` — CUSTOMER=CONSUMER, TRAVEL/LAND=NET.
- 유닛테스트: 소비자 계층이 consumer가 사용·null이면 net 폴백·시즌 우선 확인. (기존 pickLowestSalePrice 테스트는 tier 미지정=NET로 통과 유지.)

### A2. `app/api/zalo/conversations/[id]/candidates/route.ts` (판매가측 villa)
- villa ratePeriods select에 `consumerSalePriceVnd`, `consumerSalePriceKrw` 추가(원가·마진은 계속 미조회).
- 대표가 = `pickLowestSalePrice(rates, false, tierForCounterparty(counterpartyType))` (VND, tier).
- CUSTOMER면 소비자 VND, 여행사·랜드사면 Net VND.

### A3. `app/api/zalo/conversations/[id]/share/route.ts` (handleVilla 판매가측)
- conv.counterpartyType → tier 결정.
- from 대표가 = `pickLowestSalePrice(rates, false, tier)`.
- **상세 폴백 빌더에도 계층 반영**: `buildVillaShareTextForCustomer`에 넘기는 CustomerRateView의 `salePriceVnd`/`salePriceKrw`를 **유효 계층가**(consumer??net)로 매핑해 구성(빌더 자체는 불변, 입력 값만 계층가). base 행 consumer=null이면 net 폴백값 들어가나 base는 0/생략 로직 유지.
- villa ratePeriods select에 consumerSalePrice* 추가.

---

## 범위 B — 웹챗 빌라 공유 이식

### B1. 후보 API — 신규 `app/api/webchat/sessions/[id]/villa-candidates/route.ts`
- 패턴: `proposal-candidates/route.ts` 준용(운영자 게이트 `requireCapability(isOperator)`, 세션 존재 확인).
- ACTIVE·isSellable 빌라 최대 50(createdAt desc): id, name, complex, bedrooms, bathrooms, maxGuests, hasPool, breakfastAvailable, 대표 photoUrl.
- 대표가 = **소비자 VND**(`pickLowestSalePrice(rates,false,"CONSUMER")`) — 웹챗 방문자=소비자. ratePeriods select=salePrice*/consumerSalePrice*/season/isBase만(원가·마진 금지).
- 응답 후보에 `priceVnd`(bigint 직렬화), `priceIsFrom`.

### B2. 발송 — `app/api/webchat/sessions/[id]/send-link/route.ts` 확장
- zod `kind` enum에 `"villa"` 추가. villa일 때 body `villaId: z.string().min(1)`.
- villa 분기(제안 분기처럼 예약 무관, bookingId 불필요):
  - 빌라 로드(메타 + ratePeriods salePrice*/consumerSalePrice*/season/isBase — 원가·마진 미조회).
  - from = 소비자 VND 대표가. 공개 상세페이지 = `getPublicVillasByIds([villaId])` → 있으면 `blogPaths.villa(slug)` (절대 URL). 없으면 링크 없이 간단정보만(웹챗은 무-URL 카드 허용).
  - **메시지 구성(웹챗 카드 패턴)**: `text`(ko) = 간단정보 + 대표가(₫… ~ / 박) **캡션만**(URL은 text에 넣지 말 것 — 카드가 payload.url로 렌더, Gemini URL 훼손 회피). `payload = { villaId, url? }`, `kind="villa"`.
  - **번역**: 캡션(ko, URL 없음)을 방문자 언어로 번역해 translatedText/To 채움. reply route의 번역 헬퍼 재사용(URL 미포함이라 안전). 번역 실패 시 translationFailed=true + ko 폴백(reply 패턴).
  - lastMessage* 비정규화 갱신 + SSE fan-out + writeAuditLog(linkKind="villa", villaId).
- 빌라 공유용 캡션 빌더 신규 `lib/webchat-villa-share.ts`(또는 zalo-share에 함수 추가): `buildWebchatVillaCaption(villa, from, locale?) → { ko:string }`. shareHeader류 재사용하되 URL 미포함.

### B3. 웹챗 클라 UI
- `app/(admin)/messages/webchat-types.ts`: `QuickLinkKind`에 `"villa"` 추가. `VillaCandidate` 타입(villaId,name,complex,bedrooms,bathrooms,maxGuests,hasPool,breakfastAvailable,photoUrl,priceVnd,priceIsFrom).
- `webchat-quick-links.tsx` 또는 신규 `webchat-villa-modal.tsx`: "빌라 공유" 버튼 → villa-candidates 로드 → 목록(사진·이름·침실/욕실·₫대표가) → 선택 → `POST send-link {kind:"villa",villaId}`. 제안 모달(`webchat-proposal-modal.tsx`) UX 준용.
- 카드 렌더(`webchat-thread.tsx` 등 kind별 렌더): `kind="villa"` 케이스 추가 — 제목/아이콘 + 캡션(text/translated) + payload.url 있으면 "상세 보기" 링크 버튼(proposal 카드 렌더 재사용).
- i18n ko/vi 추가(버튼·모달·카드 제목).

---

## 테스트 가능한 완료 기준 (QA)
1. **계층 정확성**: 고객(CUSTOMER) 대화 빌라 공유 대표가 = 소비자 VND(M villa V01 → ₫12,100,000). 여행사·랜드사 대화 = Net VND(₫11,000,000). (실 DB 또는 헬퍼 유닛으로 검증)
2. **웹챗 빌라 공유**: 웹챗 세션에서 빌라 공유 버튼→모달→발송 시 WebChatMessage kind="villa"+payload.url(`/blog/villa/{slug}`) 생성, 캡션에 소비자 VND 대표가, URL은 payload에만(text 미포함).
3. **누수 불변식**: A2/A3/B1/B2 쿼리·본문에 supplierCostVnd·marginType·marginValue 미조회(grep). consumerSalePrice/salePrice만.
4. **폴백**: 공개 상세페이지 없는 빌라 웹챗 공유 시 링크 없이 간단정보만(크래시 없음). Zalo 상세 폴백은 계층가로 표시.
5. `npm run lint && typecheck && build` + 대상 vitest 통과.

## 검증 방법
- 유닛: 계층 헬퍼(consumer 사용·null→net 폴백·시즌 우선), tierForCounterparty.
- 통합: candidates/share/villa-candidates/send-link 스냅샷(계층가 값 + 누수 필드 부재 + kind="villa"·payload.url).
- 실 DB 스팟체크: V01 CUSTOMER=₫12,100,000 / 여행사=₫11,000,000.
