# 계약: VENDOR 포털 P1 갭 3종 + P2 2종 (vendor-gaps-p1)

2026-07-03 원천공급자 전수점검(코드 감사 + 프로덕션 워크스루) 후속. 담당 세션: wt/vendor-gaps.

## 범위

- **A. 서비스 장소 제공** — vendor orders API 응답에 빌라 주소(`Villa.address`) 추가, 발주함·예약현황 카드에 주소 + Google Maps 검색 링크 표시, Zalo `VENDOR_PO` 문구에 주소 한 줄 추가. ★판매가·마진과 무관, 이행에 필요한 최소 정보. 주소는 **본인에게 발주된 건**의 빌라만 노출.
- **B. 시간제안 결과 회신** — `apply-proposal`(적용/무시)에서 VENDOR 인앱 알림 적재(`VENDOR_PROPOSAL_APPLIED` / `VENDOR_PROPOSAL_DISMISSED`, InAppNotification.type=String이라 enum 변경 없음). Zalo는 범위 외(NotificationType enum 동결).
- **C. 서비스 완료 보고** — `ServiceOrder.vendorCompletedAt`(nullable, additive) + `POST /api/vendor/orders/[id]/complete`(본인 vendorId 스코프, VENDOR_ACCEPTED·미취소만, 멱등 updateMany) + 예약현황 카드 "서비스 완료" 버튼/완료 배지 + 운영자 Zalo `VENDOR_PO_RESPONSE` action="complete" 분기(기존 enum 재사용).
- **D. 통계 미지급 기준 통일** — /vendor/stats "미지급"을 발주함 정산탭 settleTotals와 동일 기준(VENDOR_ACCEPTED && !CANCELLED && vendorSettledAt null)으로.
- **E. 픽업 뱃지** — 카드에 catalogItem.pickupAvailable 표시(조회 비용 낮을 때만).

## 수정 금지 구역
- app/(admin)·app/(supplier)·app/partner·app/cleaning 레이아웃/화면 (다른 세션 활동 중: partner-workflow, supplier-ux-links)
- prisma/schema.prisma는 ServiceOrder.vendorCompletedAt 1줄 additive만. DB는 raw SQL `ALTER ... IF NOT EXISTS`(db push 금지)

## 완료 기준 (테스트 가능)
1. vendor orders API 응답에 villaAddress 포함, 타 vendor 발주엔 접근 자체 불가(기존 404 유지)
2. apply-proposal apply=true/false 각각 InAppNotification 1건 적재(수신자=해당 vendor 계정 userId), 발주 vendor 없거나 user 미연결 시 조용히 skip
3. complete API: 본인 발주만, PENDING_VENDOR/CANCELLED/이미 완료 시 409, 성공 시 vendorCompletedAt 기록 + 운영자 Zalo 적재
4. 통계 "미지급" == 정산탭 "지급대기" 동일 숫자
5. i18n ko/vi 동등, 누수 0(판매가·마진·타 vendor), tsc·lint·build 0, 기존 vendor-order 테스트 그린
