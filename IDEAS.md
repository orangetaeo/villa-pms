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
- **매출관리 페이지(/sales 등) — 정산과 별개** (2026-06-24 테오): 정산(/settlements=공급자 원가 지급·정산)과 매출(판매 실적·기간별 매출 집계)은 다른 개념·다른 페이지로 분리. 신설 시 ADMIN 모바일 하단 네비 중앙 돌출 항목을 정산→매출로 교체 검토(현재는 정산이 중앙, components/admin/sidebar.tsx centerItem)
- 캘린더 기간 차단 UI: 바텀시트에서 시작~종료 범위 선택 (Phase 1은 a3 확정 디자인대로 단일 날짜 탭 토글 — T1.4 계약 합의)
- 빌라 시즌 겹침 DB 레벨 제약: VillaSeasonPeriod 겹침 차단이 현재 앱 레벨 check-then-write(Read Committed) — 이론상 동시성 틈. 운영 부담 증가 시 PostgreSQL `EXCLUDE USING gist` 제약 또는 직렬화 격리 검토 (Phase 1은 단일 공급자 단말 편집이라 실위험 극저 — QA 2026-06-16)
- **Nike↔villa-pms Zalo 공유 세션 통합** (2026-06-16 테오 검토 — 현상유지 결정, 나중 재검토): 같은 Zalo 계정을 두 앱이 동시 로그인하면 zca-js `code 3000(DuplicateConnection)`으로 세션 충돌(번갈아 끊김). 별명·아바타·대화도 별도 DB라 미공유. **해결책 = 공유 세션 서비스**: Zalo WebSocket 세션을 1곳(공유 worker/서비스)이 유지하고 Nike·villa-pms가 REST/공유 DB로 송수신 → 같은 QR 사용 가능 + 별명·아바타·대화 전부 자동 공유. 규모: 별도 서비스 신설 + 양쪽 앱 연동 + Nike 코드 변경(모노레포/Turborepo 통합 맥락). 대안: ②Zalo 계정 2개 분리(충돌 없으나 공유 안 됨) ③현상유지(같은 계정 동시 사용 시 충돌 감수 — 현 선택). 재검토 트리거: 두 앱 동시 운영 빈도↑ 또는 별명·대화 공유 필요성↑
- **부가서비스 픽업/방문 이행 모델 (마사지·이발 등 APPOINTMENT 타입)** (2026-06-27 테오 제기): 마사지/이발은 ①원천공급자(ServiceVendor)가 픽업(차량 모심) 제공 ②고객이 직접 매장 이동 — 두 경우가 있어 기획 필요. 현재 1차 구현=게스트 신청 화면에 placeholder 문구("픽업 가능 여부는 운영자 확인 후 안내")만 표기(lib/service-catalog.ts `fulfillmentMode`=APPOINTMENT). **제안 설계**: (a) `ServiceVendor.pickupAvailable`(bool) 또는 `ServiceCatalogItem.fulfillmentDetail`(JSON: pickup가부·매장주소·픽업비용·소요시간) 필드 추가(additive, TDA 검토) → (b) 운영자가 발주(dispatch) 시 공급자 Zalo로 픽업 가부 질의하거나 카탈로그에 미리 설정 → (c) 게스트 신청 내역/체크아웃에 "픽업: 차량이 모시러 갑니다(무료/유료)" 또는 "고객 직접 방문(주소·지도)" 확정 표기 → (d) 픽업비용이 있으면 옵션 가산 또는 정산 반영. 의사결정 필요: 픽업비 유무·과금 방식, 매장 위치 노출 방식(지도 임베드 재사용 가능). 관련: [[addon-source-vendor-brokerage]](발주 게이트), 지도 embed(realtime-reset-map-features)
