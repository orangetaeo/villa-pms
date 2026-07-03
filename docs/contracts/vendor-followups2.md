# 계약: VENDOR 후속 3종 — costVnd 이중곱 수정·인앱 로케일화·제안결과 Zalo (vendor-followups2)

vendor-gaps-p1(2026-07-03) 잔여 후속. 담당 세션: wt/vendor-followups2.

## 범위

- **① costVnd 의미 정합** — 확정된 사실: `ServiceOrder.costVnd`는 **라인 총액**(운영자 수기 입력, lib/revenue-ledger.ts:568·admin 통계와 동일 전제). 발주함 카드·정산탭·허브·통계 전역잔액은 이미 정상.
  - 수정: lib/vendor-stats.ts 매출/추이/품목의 `costVnd × quantity` 이중곱 제거(수량>1 과대집계 버그), `orderAmountVnd` 제거, prisma/schema.prisma의 낡은 주석("정산액=costVnd×quantity") 정정. 테스트 갱신.
- **② 인앱 알림 로케일화** — buildVendorNotifText(type, payload, locale)로 ko 변형 추가. 적재 시점에 수신자 User.locale(ko면 ko, 그 외 vi)로 빌드. 호출부 3곳(dispatch·service-orders/[id] 취소·정산·apply-proposal)에 vendor user locale select 추가. 기존 저장분은 재번역하지 않음.
- **③ 제안 결과 Zalo 회신** — `NotificationType.VENDOR_PROPOSAL_RESULT` enum 추가(additive). prisma/migrations-manual/2026-07-03-vendor-proposal-result-enum.sql = `ALTER TYPE ... ADD VALUE IF NOT EXISTS` **라이브 선적용 후 배포**(PR #183 선례). lib/zalo.ts buildNotificationText에 case 추가(payload.locale로 ko/vi 분기), apply-proposal에서 zaloUserId 연결 시 enqueueNotification.

## 수정 금지 구역
- app/(admin)·app/(supplier)·app/partner·app/cleaning 화면, lib/statistics.ts(관리자 통계 — 이미 정상), 발주함 카드 금액 표기(정상)

## 완료 기준
1. vendor-stats: quantity>1 발주의 매출=costVnd 그대로(이중곱 없음) — 테스트로 고정
2. 인앱: User.locale=ko 수신자는 ko 문구, vi/null은 vi — buildVendorNotifText 단위테스트
3. apply-proposal 적용/무시: 인앱(로케일) + Zalo 연결 시 VENDOR_PROPOSAL_RESULT 큐 적재, 미연결은 조용히 skip
4. exhaustive switch TS2366 해소(case 추가), 누수 0(판매가·마진), tsc·전체 테스트·build 그린, i18n 영향 없음(서버 상수 문구)
