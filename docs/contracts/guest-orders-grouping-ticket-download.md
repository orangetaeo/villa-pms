# 계약: 게스트 신청 내역 품목별 그룹핑 + QR 티켓 사전 다운로드

- 상태: 착수 (2026-07-12)
- 브랜치: wt/guest-orders-grouping
- 배경(테오): ① 신청 내역이 산만 — 부가서비스 **품목별로 모아서** 표시 필요(구분별 주문 분리로
  같은 티켓이 여러 줄로 흩어짐). ② 현장 인터넷 불가 대비 — QR 티켓 **사전 다운로드** 필요.

## 설계 (TDA·UX-VN)

### 1. 품목별 그룹핑
- 현재 주문 표시명이 type 기준(`catalogNameByType`) — **품목(catalogItemId) 기준으로 교체**:
  orders 페이지 payload에 catalogItemId+품목명(pickI18n) 추가.
- guest-orders.tsx: `catalogItemId`(없으면 type) 기준 그룹 카드 — 헤더=품목명·총 수량·이용일,
  내부에 주문 라인(구분 라벨·수량·금액·상태 칩·시간제안 배너·티켓 그리드). 그룹 정렬=이용일→최신.

### 2. QR 티켓 다운로드 (오프라인 대비)
- ticketUrls는 R2 공개 URL(교차 출처)이라 `<a download>` 미동작 → **동일 출처 프록시 신설**:
  `GET /api/g/[token]/service-orders/[id]/ticket-download?u=<idx>` — 토큰 유효성(guestTokenState)+
  주문이 그 booking 소속인지 검증, `u`는 ticketUrls 인덱스(임의 URL 미수용 — SSRF 차단),
  서버가 R2에서 fetch해 `Content-Disposition: attachment; filename="<품목>-<n>.png"` 스트림.
  guestRateLimit 적용.
- UI: 티켓 썸네일마다 "저장" 버튼 + 주문(또는 그룹) 단위 "티켓 모두 저장"(순차 트리거).
  iOS 대비 보조 안내 1줄("이미지를 길게 눌러 사진에 저장할 수도 있어요") — 5언어.

## 범위
1. `app/g/[token]/orders/page.tsx` — payload에 catalogItemId·품목명(품목 기준 명칭으로 교체)
2. `app/g/_components/guest-orders.tsx`(+types) — 그룹 카드 재구성, 다운로드 버튼
3. `app/api/g/[token]/service-orders/[id]/ticket-download/route.ts` — 신규 프록시
4. `lib/guest-i18n.ts` — 5언어 키(저장·모두 저장·오프라인 안내 등)
5. 테스트: 프록시(토큰 무효 410·타 booking 404·인덱스 범위 400·정상 attachment)·그룹핑 순수 함수

## 수정 금지 구역
- 주문 생성·벤더 경로(app/api/vendor/**, service-orders 생성), prisma

## 완료 기준 (QA)
- [ ] 신청 내역이 품목별 그룹 카드로 표시(구분 분리 주문이 한 그룹 안에), 기존 정보(상태·제안·연락처 게이트) 유실 없음
- [ ] 티켓 저장 버튼 → 파일 다운로드(동일 출처 attachment), 모두 저장 동작, 타 예약 티켓 접근 차단
- [ ] 프록시에 임의 URL 주입 불가(인덱스 방식), 만료 토큰 410, 레이트리밋
- [ ] 5언어, build 통과
