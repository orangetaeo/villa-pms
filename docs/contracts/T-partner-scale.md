# T-partner-scale — 파트너 예약목록 서버 페이지네이션 + 상세 체크인·서비스요청 노출

- 담당: BE+FE (worktree `wt/partner-scale`), 독립 QA 별도
- 배경: 파트너 백로그 잔여(PR #182~#192 후속). 예약 수백 건 대비 + 중개자 정보 완결.

## 범위
1. **예약목록 서버 페이지네이션**: loadPartnerBookings → {rows,total} + where(partnerId AND q(빌라명/병기/단지/게스트 contains-insensitive) AND 기간 겹침) + skip/take. /partner 페이지 URL 파라미터(q·from·to·page·pageSize) 기반, 목록 컴포넌트는 URL 모드(ListSearch URL·PaginationBar URL·날짜 입력 URL 갱신) — 클라 전량로드/슬라이스 제거.
2. **상세 체크인·서비스요청**: PartnerBookingDetail에
   - checkInAt(CheckInRecord.createdAt)·agreementSignedAt(서명 여부·시각) — 여권·서류 URL 등 PII 절대 미노출.
   - serviceOrders: type·status·serviceDate·serviceTime·quantity·guestNote만. ★금액(costVnd·priceKrw/Vnd)·vendor·selectedOptions(가격 포함 JSON) 절대 미노출 — lib/partner-portal.ts 헤더 누수 규칙의 "ServiceOrder 금지"를 "금액·공급자·옵션 금지(비금액 요청 메타는 중개자 정당)"로 명문 갱신.
   상세 화면에 체크인 정보 행 + 부가서비스 요청 카드(게스트 메모 강조).

## 완료 기준
- 목록: 서버 where 스코프 partnerId 유지(테스트) + q/기간 필터 서버 적용 + count 기반 페이지네이션. 검색·페이지 이동이 URL로 동작(빌드+실사용).
- 상세: 금액·PII 미노출 select 테스트(flattenSelectKeys에 costVnd·priceKrw·priceVnd·passportPhotoUrls 등 부재).
- tsc 0·build·전체 테스트 그린·i18n ko/vi(serviceType 9·serviceOrderStatus 4 라벨 포함).
## 수정 금지 구역: 스키마 무변경·messages 키 추가만·타 세션 파일 비접촉.
