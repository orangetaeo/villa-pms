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
- **부가서비스 픽업/방문 이행 모델 (마사지·이발 등 APPOINTMENT 타입)** (2026-06-27 테오 제기) — ✅ **v1 구현 완료**: `ServiceCatalogItem.pickupAvailable`(Boolean? null=미정·true=픽업·false=직접방문) + `pickupNote`(String? 주소·조건) 추가(additive raw SQL ALTER). 관리자 카탈로그 폼(설정>서비스)에 마사지·이발일 때만 "픽업 방식" 셀렉트 + 안내 입력 노출. 게스트 신청 카드·신청 내역에 픽업/방문 문구 표기(`lib/guest-fulfillment.ts`, 5개 언어). **v1 단순화 결정(테오 "추천대로")**: 픽업비 별도 과금 필드 없음 — 운영자가 판매가에 포함하거나 pickupNote에 표기. pickupNote는 번역 안 하고 그대로 표기. **후속(미구현)**: ①픽업비 별도 과금·정산 반영 ②공급자(ServiceVendor) Zalo로 픽업 가부 자동 질의 ③매장 위치 지도 임베드(realtime-reset-map-features 재사용). 관련: [[addon-source-vendor-brokerage]](발주 게이트)

## Zalo 리스너 전용 서비스 분리 (배포 블랙아웃 제거)
- 등록: 2026-07-06 (테오 "채팅 늦게 도착" 조사 후속)
- 문제: zca-js 리스너가 웹 프로세스에 있어 **배포마다 리스너가 끊기고**(수 분 블랙아웃, Zalo 재접속 시 일부만 백로그 재전송) 잦은 머지 날엔 수신 지연이 체감됨.
- 아이디어: 리스너를 Railway 별도 서비스(long-running worker)로 분리 — 웹 배포와 리스너 수명을 분리. SSE 신호는 인프로세스 버스 대신 DB 폴링/Redis pub-sub 필요(구조 변경 큼). Phase 2.
- 관련: lib/zalo-health.ts 워치독(끊김 경보, 2026-07-06 도입), deploy-restart-zalo-listener-blackout 메모리.

## 검색 확장 후속 (T-villa-search-expansion 범위 외)
- 등록: 2026-07-10 (검색 확장 회의에서 제외 결정분)
- **공급자 /my-villas 텍스트 검색**: 현재 200건 메모리 슬라이스 — 서버 where 전환 + supplierId 스코프 재검증 동반이라 별도 태스크로.
- **가격(요율) 범위 필터**: VillaRatePeriod 기간·isBase·시즌 + Net/소비자직판(ADR-0031) 통화 이원화로 "어느 기준 가격"이 모호 — Phase 2 가격 UI 나올 때 재검토.
- **guestPhoneDigits 생성 컬럼+인덱스**: /bookings 전화 검색이 regexp_replace 순차 스캔(현재 2.8k행 무해, ADMIN 저빈도) — 예약 수만 건 도달 시 정규화 컬럼 additive 추가.

## 티켓 구분 자동 판정 후속 (ADR-0036 개정 범위 외)
- 등록: 2026-07-12 (티켓 variant 인원 배정 회의)
- **생년월일 기반 연령구분 자동 추천(만 나이)**: 시설별 기준(신장 vs 나이·구간)이 달라 보류 — 현재는 운영자가 variant에
  bornBeforeYear/heightMaxCm 규칙을 직접 입력(데이터 주도). 시설 카탈로그가 표준화되면 나이→구분 자동 추천 UI 재검토.
- **신장 자가신고 검증 강화**: 현재 소비자 자가신고 + 현장 재측정(벤더 "신고 Ncm" 표기). 시설 API 연동 시 사전 검증 가능성.

## 티켓 부분 발행 동시 업로드 낙관적 가드 (QA 관찰 2026-07-12, 저위험)
- 발행 완료 게이트 도입으로 미달 append 경로에 낙관적 가드가 사라짐 — 멀티탭/멀티디바이스 동시 업로드 시
  last-write-wins로 티켓 URL 1건 조용히 유실 가능(UI 순차화로 실발생 희박, 보안·마진 무관).
- 강화안: 업로드 where에 `ticketUrls: { equals: 스냅샷 }` 추가 → count=0이면 409 재시도 유도.
