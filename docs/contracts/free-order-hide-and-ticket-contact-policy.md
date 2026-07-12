# 계약: 벤더 무료 항목 비노출 + 티켓 소비자 문의 본사 일원화

- 상태: 착수 (2026-07-12)
- 브랜치: wt/ticket-contact-policy
- 배경(테오):
  1. 티켓 업체 발주함/예약현황에 "무료 입장 — 발행 불필요" 항목을 보여줄 필요 없음.
  2. 소비자 신청 내역에 티켓업체 연락처 불필요 — 티켓 관련 연락은 **본사(Villa Go) 원칙**
     (업체=베트남인, 소비자 Zalo 미설치 가능성 — 직접 소통 비현실적).

## 설계

### 1. 벤더 보드에서 무료 항목 제외 (ADR-0034 §3-2 보강)
- `/api/vendor/orders` 전 탭(목록·cancelled 배너)·뱃지 카운트·정산 합계 where에
  **제외 조건: NOT(type=TICKET && priceVnd=0 && costVnd=0)** — 소비자 무료이면서 벤더 지급액도
  0인 라인만 숨김. costVnd>0(벤더 지급 있음) 건은 정산 누락 방지 위해 계속 표시(freeEntry 안내 유지).
- 무료 주문은 생성 시 이미 자동 확정(PR #256)이라 벤더 액션 불요 — 완전 비노출이 자연스러움.

### 2. 소비자 티켓 문의 본사 일원화 (ADR-0033 게이트 개정)
- 게스트 orders 로더: **type=TICKET이면 vendorName·vendorPhone 항상 null**(확정 후에도 미노출).
- guest-orders.tsx: TICKET 확정 라인에 담당자 연락처 대신 "티켓 관련 문의는 Villa Go로 연락해
  주세요" 안내(5언어) — 페이지에 회사 연락처(카카오/전화) 요소 있으면 재사용, 없으면 문구만.
- 마사지 등 비TICKET 서비스는 현행 유지(현장 조율 필요 — 픽업/방문).

## 범위
1. `app/api/vendor/orders/route.ts` — 무료(판매0·지급0) 제외 where
2. `app/g/[token]/orders/page.tsx` — TICKET 벤더 연락처 차단
3. `app/g/_components/guest-orders.tsx` — 본사 문의 안내
4. `lib/guest-i18n.ts` 5언어 키
5. 테스트: 벤더 목록·뱃지·정산에서 무료 제외 / costVnd>0은 표시 / TICKET 연락처 null·비TICKET 유지

## 수정 금지 구역
- prisma, 무료 자동 확정 로직(PR #256), 발행 게이트(PR #255)

## 완료 기준 (QA)
- [ ] 벤더 4탭·뱃지·정산 어디에도 무료(판매0·지급0) 라인 없음, 지급액 있는 건은 표시
- [ ] 소비자 TICKET 라인: 업체 이름·전화 미노출(확정 후 포함), 본사 문의 안내 표시. 비TICKET 현행
- [ ] 누수·회귀 없음, build 통과
