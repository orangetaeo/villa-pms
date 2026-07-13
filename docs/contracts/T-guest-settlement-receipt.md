# T-guest-settlement-receipt — 게스트 정산 내역(영수증) 페이지

- 상태: 완료 (2026-07-13) — QA PASS(누수 0·전 항목). tsc0·vitest 2987·build 통과(SHOULDER 클라이언트 레이스는 재생성으로 해소, receipt 무관)
- 담당: TDA(설계) + FE(수직 슬라이스: 로더+페이지), QA 검증
- 배경 (테오 질문): "정산완료 된 내용을 소비자가 볼 수 있어야 — /g/…/orders 인가 체크인 링크인가? 고객은 본인이 사용한 총 금액을 확인해야."

## 설계 (TDA 결정)

### 위치 — 체크인 링크 포털(/g/[token]) 하위 `/g/[token]/receipt`
- 근거: 정산서는 **예약(숙박) 단위의 최종 영수증**(미니바+부가서비스+보증금+파손+수납) — 부가서비스 주문만 담는 /orders의 부분집합이 아님. /orders는 이용 중 신청 관리, /receipt는 체크아웃 후 정산 확인으로 역할 분리.
- 진입점 2곳: ① /g/[token] 메인에 체크아웃 완료 시 "정산 내역(영수증)" 카드 ② /g/[token]/orders 상단 배너(동일 조건).
- 노출 조건: booking.status=CHECKED_OUT && CheckOutRecord 존재. 그 전엔 /g/[token]으로 redirect.
- 토큰 수명: 기존 checkOut+24h 유지(정산 확인은 체크아웃 직후 니즈) — 연장은 IDEAS.

### 노출 화이트리스트 (★재고·마진 비공개 원칙 — QA 최중점)
포함: 미니바 소비 라인(nameKo·consumedQty·unitPriceVnd·lineVnd), 확정 부가서비스(표시명·수량·판매가 KRW/VND — 기존 /orders 해석 재사용), 게스트 청구 합계(guestChargeVnd/Krw), 보증금(depositAmount VND·파손 차감·보증금 상계·환불액), 수납 라인(method·currency·amount + 수단 라벨 5언어), settlementFx(환산 표시), settledAt.
**금지: costVnd·lineCostVnd(미니바 원가), 부가서비스 원가·벤더 정산, 공급자 정보, 다른 예약 데이터.** select 단계에서 원가 필드 자체를 조회하지 않는다.

### 파생 계산
- 보증금 상계 = Σ settlementLines(method=DEPOSIT). 파손 차감 = deductionVnd − 상계(음수 방지). 환불액 = depositAmount − deductionVnd.
- 구 데이터(라인 없음): 수납 내역은 settledVnd/Krw/Usd 합계 폴백, 보증금은 "차감 총액"으로만 표기.

### 구현
- lib/guest-receipt.ts 로더(RSC 전용, token→state 검증은 기존 guestTokenState 재사용, guestRateLimit 적용은 페이지 GET 특성상 로더 내 불필요 — 기존 /g 페이지 관례 따름).
- app/g/[token]/receipt/page.tsx — 게스트 라이트 톤(기존 /g 디자인 패턴), 모바일 우선, guest-i18n 5언어 키.
- 스키마 변경 없음.

## 완료 기준
1. 체크아웃 완료 예약: /receipt에서 미니바·부가서비스·총 청구·보증금 가감산·수납 내역(수단별)·환불액 표시.
2. 체크아웃 전: /receipt → /g/[token] redirect. 만료 토큰: 기존 만료 안내. 없는 토큰: 404.
3. 원가·마진 필드 select 0건(코드 grep + QA 검증), 다른 예약 접근 불가(토큰 스코프).
4. /g 메인·/orders 진입점 노출(체크아웃 완료 시에만).
5. guest-i18n 5언어 전체, 모바일 확인. tsc·vitest·build 통과.

## 수정 금지 구역
- app/(admin)/**, lib/checkout*.ts(읽기만), design-audit/, 루트 *.png. messages/guest-i18n은 키 추가만.
