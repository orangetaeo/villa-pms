# T-fe-admin-2screens-cost-minibar — 운영자 2화면 (FE)

## 범위
1. **F 견적 중 원가 변경 경보** — 제안 상세에 RATE_CHANGED_DURING_PROPOSAL Notification 기반 원가 변경 경보 + 변경 전/후 비교 + 마진 영향 + 액션 (b15-cost-change-alert)
2. **G 체크아웃 미니바 차감 자동계산** — 기존 체크아웃 화면 미니바 섹션 업그레이드 (b16-checkout-minibar-auto): 비치/남은(스테퍼)/소모/단가/차감액 실시간 자동계산 + 보증금 정산 자동

## 담당 파일 (이 세션만 수정)
- app/(admin)/proposals/[id]/ (경보 컴포넌트 추가)
- app/(admin)/bookings/[id]/checkout/page.tsx + 관련 미니바 컴포넌트
- messages/ko.json, messages/vi.json (키 추가만)
- 필요 시 app/api 의 원가변경 알림 조회용 라우트 (읽기 전용)

## 수정 금지 구역 (타 세션 작업)
- lib/zalo*.ts, lib/cleaning.ts, lib/hold.ts, lib/proposal.ts, lib/zalo-share.ts
- prisma/seed-demo.ts, prisma/schema.prisma
- app/api/zalo/**, app/(admin)/messages/**

## 완료 기준
- 무영어(ko는 한국어만), 날짜 점표기, 마진 단일 소스
- 반응형 (lg 1024 사이드바↔드로어, md 768 테이블↔카드)
- typecheck 통과 (네 파일 기준)
- QA leak-checklist (마진/재고/판매가 노출 정당성 — 운영자 화면이라 허용)
