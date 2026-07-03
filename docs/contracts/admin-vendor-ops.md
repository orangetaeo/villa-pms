# 계약: 관리자측 벤더 운영 갭 해소 (admin-vendor-ops)

2026-07-03 관리자측 벤더 운영 점검(admin-vendor-ops-audit) 후속. 담당 세션: wt/admin-vendor-ops.

## 범위

- **A. [P0] 벤더 이행 완료 보고(vendorCompletedAt) 관리자 표시** — 허브(lib/service-orders-hub ROW_SELECT+HubOrder)·정산/중계 목록 배지·예약상세 부가옵션 패널 VendorCell에 완료 시각 표기.
- **B. [P1] 미해결 시간제안 가시성** — 허브 중계현황에 "제안 대기" 상태 칩(서버 필터)+행 배지. 고객확정 409를 PROPOSAL_UNRESOLVED로 분리(기존 VENDOR_NOT_ACCEPTED와 구분), 패널 에러 문구 분기.
- **C. [P1] 관리자 인앱 알림(벨)** — InAppNotification 재사용(스키마 무변경). 벤더 이벤트(수락/거절/제안/완료)+벤더 자가가입 대기를 활성 운영자 전원 userId로 적재(ko). `/api/admin/notifications` GET+`/read` POST(isOperator·본인 스코프). admin 사이드바 벨 컴포넌트(폴링). ※승인대기 사이드바 배지(P2)는 벨 알림으로 갈음.
- **D. [P1] 거절 후 대체 벤더 지정** — 스키마 주석의 의도("운영자 대체 가능") 구현: PATCH /api/service-orders/[id]에 vendorId 추가(isOperator·APPROVED 벤더 검증·상태 가드=REQUESTED이고 발주 전(null)/거절(VENDOR_REJECTED)만·변경 시 발주 사이클 리셋). 패널에 공급자 변경 셀렉터.
- **E. [P2] 벤더 마스터 카드에 진행 중 발주 건수.**

## 수정 금지 구역
- app/(supplier)·app/partner·app/cleaning·app/vendor(오늘 배포분 무변경), messages/*.json은 키 추가만.
- DB 스키마 변경 없음(InAppNotification·기존 컬럼 재사용).

## 완료 기준
1. 완료 보고된 발주가 허브 두 탭·예약 패널에서 "이행 완료 dd/MM" 배지로 식별 가능
2. 미해결 제안 발주가 중계현황 "제안 대기" 칩 필터로 조회되고 행 배지 표시, 고객확정 차단 409에 PROPOSAL_UNRESOLVED 반환
3. 벤더 수락/거절/제안/완료/가입대기 시 활성 운영자 전원에게 인앱 적재, admin 벨에서 열람·읽음 처리(본인 스코프, 타 운영자 알림 비노출)
4. 거절된 발주의 공급자를 승인된 다른 벤더로 변경→재발주 가능(수락·발주중 상태에선 변경 불가 409)
5. 누수 0(판매가는 admin 재무권한 경계 유지), i18n ko/vi 동등+ADMIN_CLIENT_NAMESPACES 등록, tsc·전체 테스트·build 그린, 독립 QA PASS
