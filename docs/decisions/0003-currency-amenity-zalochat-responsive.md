# ADR-0003: 채널별 결제 통화·빌라 비품·Zalo 채팅·관리자 반응형 (SPEC v1.3)

- 날짜: 2026-06-11 / 상태: 승인 (테오 확정 지시 4건 — "할지 말지"가 아니라 "어떻게, 어느 Phase에" 설계)
- 배경: 2026-06-11 전체 회의(디자인 24장 검수)에서 테오가 신규 요구 4건 제기. TDA 설계.

## 결정 1 — 채널별 결제 통화 (Phase 1, F3)

**채널 → 통화 기본값**: DIRECT(직접 소비자) → KRW, TRAVEL_AGENCY·LAND_AGENCY(여행사·랜드사) → VND.
제안 생성 시 `Proposal.saleCurrency`로 확정 (ADMIN이 기본값 오버라이드 가능 — 예외 거래 대비).

**가격 산정 기준통화 = VND** (원가 통화와 동일):
- `VillaRate.salePriceVnd`(BigInt) = supplierCostVnd + 마진 자동계산 → ADMIN 오버라이드. **마진 기준통화도 VND로 통일** — `MarginType.FIXED_KRW` → `FIXED_VND` 변경 (KRW 고정 마진은 환율 변동 시 의미가 흔들림), `marginValue`는 BigInt(VND 컨벤션).
- `salePriceKrw`(Int, 유지) = salePriceVnd × 환율 환산 **제안값** → ADMIN 라운딩 오버라이드 (₩450,000 같은 깔끔한 가격 유지). 두 판매가 모두 시즌별 사전 확정 — 제안 시점 환율 계산에 의존하지 않는다.

**환율**: `AppSetting["FX_VND_PER_KRW"]` (1 KRW = x VND) — Phase 1은 ADMIN이 /settings에서 수동 갱신. 자동 갱신 cron은 Phase 2 (IDEAS).
**스냅샷 시점 = 제안 생성 시** `Proposal.fxVndPerKrw` 고정 → HOLD 생성 시 `Booking.fxVndPerKrw`로 복사. 용도는 참고 환산 표시·마진 리포팅(Phase 2)이며 판매가 자체는 요율 스냅샷이므로 환율에 영향받지 않는다.

**스키마**: Proposal·Booking에 `saleCurrency`, ProposalItem·Booking 금액 컬럼을 통화별 듀얼 nullable(`*Krw Int?` / `*Vnd BigInt?`)로 분리 — "saleCurrency에 해당하는 컬럼만 필수" 앱 레벨 규칙. 단일 BigInt 컬럼 통합안은 KRW=Int 컨벤션 위반이라 기각.

**정산(F6) 영향 없음**: 공급자 지급은 supplierCostVnd 기준 VND 그대로. 단 매출 집계·표기는 **통화별 분리, KRW+VND 합산 금지** (b1·b7).
**마진 비공개 유지**: /p/[token]은 해당 통화 판매가만 노출. 원가·마진·타통화 환산값 비노출 — 통화가 무엇이든 여행사가 보는 건 판매가뿐.

**화면 영향**: b2(채널 선택 → 통화 자동 전환 + 환율 참고 표시), c1·c3(VND ₫ 표기 변형 — 천단위 **쉼표**. 점 표기는 공급자 vi 화면 한정이라는 DESIGN.md 규칙 우선. 2026-06-11 QA 지적으로 정정), b5·b11·b12(금액 열 통화 기호 병기), b7(매출 통화별 분리), b1(매출/요약 카드 통화별), b9·b10(salePriceVnd 요율 열).

## 결정 2 — 빌라 비품 관리 (Phase 1 = 표기·조회, F1·F4)

**별도 모델 `VillaAmenity`** (Villa JSON 필드안 기각). 근거: ① 체크아웃 미니바 소모 확인(F4)·Phase 2 소모 차감과 품목 단위로 연결 가능 ② b10 카테고리별 조회 질의 ③ 품목 사전(itemKey) 기반 ko/vi i18n — 공급자 텍스트 입력 최소화.
- 카테고리 enum: KITCHEN(주방용품) / BATHROOM(화장실용품) / APPLIANCE(가전류) / MINIBAR(물·음료·과자 — 수량 의미 있음)
- 품목은 코드 상수 사전(itemKey → i18n 키) + "기타" 직접 입력(customLabel)만 텍스트 허용

**공급자 UX**: F1 마법사 4단계 → **5단계** (4/5 비품 — 카테고리 탭 + 체크박스, 미니바만 스테퍼 수량). 전체 **선택 입력·건너뛰기 가능** — 등록 장벽을 높이지 않는다. 등록 후 내 빌라 상세에서 수정 가능.
**운영자**: b10 빌라 상세에 비품 섹션(읽기 전용) 추가.
**b4 체크아웃 노출 = 한다(읽기 전용)**: 미니바 품목·비치 수량을 확인 체크리스트로 표시 — 소모분은 기존 차감액(VND) 수기 기록으로 처리. **소모 자동 차감·보충 알림·재고 추적은 Phase 2** (IDEAS).

## 결정 3 — 관리자 Zalo 채팅 (Phase 1 = 채팅 화면 포함, F7 신규 b14)

**Phase 1 범위 = 양방향 채팅 화면 + 발송/수신 로그** (단순 발송 이력 + 딥링크안 기각). 근거: T3.7에서 follow webhook을 어차피 구축 — message event 수신은 증분 비용이 작고, 운영자-공급자 소통이 Zalo 개인 계정으로 새면 기록·증빙이 사라진다.
- 수신: webhook(user_send_text/image) → `ZaloConversation`(zaloUserId 단위, User 매핑) / `ZaloMessage` 저장, `zaloMsgId`로 멱등 처리
- 발신: Zalo OA **CS(상담) 메시지 API — 공급자의 마지막 발신 후 48시간 창 내에서만 무료 발신 가능**. `lastInboundAt + 48h` 경과 시 입력창 비활성 + "공급자 응답 대기" 안내 (창 밖 유료 메시지(Tin Giao dịch)·재개 유도는 Phase 2). F5 시스템 알림은 별도 정책(거래성 메시지)으로 기존대로 발송
- **Gemini 번역 통합 = Phase 1 포함**: 수신 vi→ko 자동 번역 캐시(translatedText), 발신 ko 작성 → vi 번역 미리보기 확인 후 전송. 운영자(ko)와 공급자(vi) 간 채팅은 번역 없이는 기능하지 않음
- F5 알림 발송도 `ZaloMessage(OUTBOUND, source=SYSTEM)`로 미러 기록 — 대화창에서 알림 맥락까지 한눈에. Notification 모델은 상태 추적·재시도용으로 유지
- 화면: 신규 **b14** (다크, 인박스 + 대화창 + 번역 토글 + 48h 창 상태). 메뉴 IA 6번 "메시지 /messages" 삽입

## 결정 4 — 관리자 모바일 반응형 (Phase 1, 비기능 요구 명문화)

PWA 전제이므로 **관리자 전 화면 반응형 필수**를 SPEC 비기능 요구에 명문화.
- **브레이크포인트 1024px(lg)**: ≥1024 고정 사이드바 / <1024 상단 헤더 + 햄버거 드로어. 하단 탭은 미도입(메뉴 9개 — 오픈 후 사용 패턴 보고, IDEAS)
- **테이블 → 카드 전환 768px(md)**: b5·b9·b12·b13 등 테이블 화면은 <768에서 카드 리스트로 — 카드 구성 규칙: 식별자(1열) + 상태 뱃지 + 핵심 2필드 + 우측 chevron. 공통 컴포넌트(ResponsiveTable)로 1회 구현
- **별도 모바일 디자인은 b1 한 장만** 생성(b1-mobile, 390px) — 타임라인 매트릭스는 모바일에서 "오늘 중심 리스트"로 재구성이 필요해 변환 규칙으로 불충분. 나머지 화면은 변환 규칙으로 처리 (Stitch 디자인 추가 생성 없음)

## 영향

- prisma/schema.prisma v1.2 — VillaRate(salePriceVnd·marginValue BigInt·FIXED_VND), Proposal/ProposalItem/Booking 통화 컬럼, VillaAmenity, ZaloConversation/ZaloMessage (마이그레이션은 T0.2 초기화 시 일괄 — 프로젝트 초기화 전이므로 파일 반영만)
- docs/SPEC.md v1.3 — F1(5단계+비품), F3(결제 통화), F4(b4 미니바 체크리스트), F6(통화별 표기), F7(b14 메시지·반응형), 비기능(반응형)
- TASKS.md "신규 요구 후속" 섹션 (T6.x) — DESIGN 2라운드 화면 목록 포함
- IDEAS.md — Phase 2 이관 5건 기록
