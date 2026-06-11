# IDEAS.md — 범위 밖 아이디어 보관소

> MVP(SPEC.md F1~F5) 범위 밖 아이디어는 구현하지 말고 여기에만 기록한다.

- TravelDiary 연계 직판 (Phase 2 백로그에 있음)
- 공급자 Zalo 로그인
- 빌라 위치 지도 뷰 (Leaflet — TravelDiary 코드 재사용 가능)
- 한국 여행사용 월간 리포트 자동 발송
- 빌라별 정기 방역 주기 설정 (Phase 1은 월 1회 고정 — ADR-0002)
- 여권 사진 자동 삭제 cron (Phase 1은 분기별 수동, 정책: 체크아웃 90일)
- 예약 변경 기능 (Phase 1은 취소 후 재생성 — 오픈 후 수요 보고 판단)
- SMS 폴백 (Zalo 미연결 사용자 알림)
- ADMIN 감사 로그 조회 화면 (Phase 1은 DB 직접 조회 — AuditLog는 기록만)
- ADMIN 알림 발송 로그·실패 재발송 화면 (Phase 1은 재시도 cron만)
- 비밀번호 자가 재설정 (Phase 1은 ADMIN 수동 재설정으로 대체 — 2026-06-11 전체 회의)
- PWA 설치 안내 화면 (온보딩 가이드 T4.3에 포함 검토 — 2026-06-11 전체 회의)
- 미니바 소모 자동 차감: 체크아웃 입력 → VillaAmenity 수량 차감 + 보충 필요 알림 + 소모 요금 청구 (Phase 1은 읽기 전용 체크리스트 + 차감액 수기 — ADR-0003)
- 환율(FX_VND_PER_KRW) 자동 갱신 cron (Phase 1은 ADMIN /settings 수동 입력 — ADR-0003)
- 관리자 하단 탭 내비게이션 (Phase 1은 햄버거 드로어만 — 오픈 후 사용 패턴 보고, ADR-0003)
- Zalo 채팅 고도화: 48h 창 밖 유료 메시지(Tin Giao dịch) 발신·대화 재개 유도, 관리자 이미지 발신, CLEANER 대화 인박스 (Phase 1은 텍스트 수신·48h 내 응답 중심 — ADR-0003)
- 통화별 마진 리포트 (Booking.fxVndPerKrw 스냅샷 활용 — KRW/VND 매출·마진 분리 대시보드, ADR-0003)
- 캘린더 기간 차단 UI: 바텀시트에서 시작~종료 범위 선택 (Phase 1은 a3 확정 디자인대로 단일 날짜 탭 토글 — T1.4 계약 합의)
