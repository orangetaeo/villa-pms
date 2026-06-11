# TASKS.md — Villa PMS

## Sprint 0 — 기반 (M1 W1)
- [x] T0.1 프로젝트 초기화: Next.js 15 + TS + Prisma + next-intl + NextAuth (BE/TDA) — 2026-06-11 완료 (별도 세션, Railway 배포 포함)
- [x] T0.2 schema.prisma 1차 마이그레이션 + Neon 연결 (TDA) — 2026-06-11 Railway PostgreSQL `prisma db push` 완료. **주의: schema v1.2(통화·비품·Zalo) 추가분 push 재실행 필요**
- [x] T0.3 인증: 자가 가입(/signup, vi) + 전화번호+비밀번호 로그인, Role 미들웨어, 라우트 그룹 (admin)/(supplier) (BE/UX-VN) — 2026-06-11 완료. 화면은 Stitch a0-login·a0-signup 그대로 변환
- [x] T0.4 이미지 저장소 결정 및 업로드 파이프라인 (클라 리사이즈 → R2) (INTEG) — 2026-06-11 완료 (ADR-0004). R2 백엔드+디스크 폴백 자동 선택, 인터림 Railway volume(/data), 클라 리사이즈 유틸. **잔여: 테오 Cloudflare R2 버킷·API 토큰 발급 → Railway STORAGE_* 5종 입력 시 R2 전환**
- [x] T0.5 i18n 셋업: ko/vi 키 구조, 공급자 라우트 vi 기본 (FE/LOC) — 2026-06-11 완료. locale 쿠키 기반(미들웨어 자동 설정: admin→ko, supplier·signup·login→vi), auth 네임스페이스 키 등재. 화면별 키는 각 변환 태스크에서 추가
- [x] T0.6 Railway 배포 + CRON_SECRET 크론 라우트 골격 (OPS/TDA) — 2026-06-11 배포 완료 (villa-pms-production.up.railway.app), 크론 골격은 잔여
- [ ] T0.7 reference/ 수집: Nike zalo·gemini, 환전 LEDGER·WebPush, TravelDiary 업로드·PWA 코드 복사 (테오)
- [ ] T0.8 Playwright MCP 설치·연결 — QA 실사용 검증용 (QA/TDA)
- [ ] T0.9 AuditLog·AppSetting 마이그레이션 + lib/audit-log.ts(writeAuditLog) 유틸 — 이후 모든 변경 API에 동시 적용 (TDA/BE) — lib/audit-log.ts는 2026-06-11 T0.3에서 생성 완료(가입 시 적용 중), 스키마는 T0.2 db push에 포함. 잔여: v1.2 추가분 push 재실행 확인

## Sprint 1 — F1 빌라 등록 + F2 캘린더 (M1 W2~3)
- [x] T1.0 Stitch 디자인 생성: A0~A4, B1 (docs/DESIGN.md 프롬프트) → design/stitch/ 저장 (DESIGN, 테오 확인) — 2026-06-11 전체 회의 검수 — 조건부 통과
- [x] T1.1 SUPPLIER 빌라 등록 마법사 (Stitch A1·A2 변환) (UX-VN) — 2026-06-11 완료. 5단계(a2→a2b→a1→a9→a5) `/my-villas/new`, POST /api/villas(supplierId 세션 강제+AuditLog), 비품 품목 사전 lib/amenities.ts, QA 통과(누수 0건, M1 업로드 XSS 수정 후 재검증 ✓). 계약: docs/contracts/T1.1-villa-wizard.md
- [x] T1.2 ADMIN 빌라 승인 화면 + 요율(VillaRate) 편집 (FE) — 2026-06-11 완료 (b9·b10 변환, 공통 사이드바 9메뉴 + ResponsiveTable 컴포넌트, PATCH 상태 전이 + PUT 요율 API + GET 목록(SUPPLIER 스코프·마진 차단), QA 독립 평가 **통과** — 누수 0건·교차 스코프 실증. 계약: docs/contracts/T1.2-villa-approval.md)
- [ ] T1.2b 빌라 반려(REJECT) 플로우 — VillaStatus 반려 상태 설계(TDA) + 공급자 빌라 수정·재제출 화면과 함께 (T1.2에서 보류 합의)
- [x] T1.3 lib/availability.ts 가용성 판정 + 단위 테스트 (BE/QA) — 2026-06-11 완료. 순수 판정층(evaluateAvailability·overlapsHalfOpen)+DB 래퍼층(checkAvailability·findSellableVillaIds, $transaction 클라이언트 주입 가능) 분리, vitest 도입(`npm test`, 18 테스트), QA 독립 평가 통과(계약: docs/contracts/T1.3-availability.md)
- [x] T1.4 SUPPLIER 월 달력 (탭 토글 차단) (UX-VN) — 2026-06-11 완료. a3 변환 /calendar(셀 4상태 색+패턴, 바텀시트 토글), POST/DELETE /api/calendar-blocks(advisory lock `lockVillaInventory`+409+AuditLog), 공급자 하단 탭바+cleaning·earnings placeholder. QA 통과(D1~D3 수정 후 재검증, 누수 0건). 계약: docs/contracts/T1.4-supplier-calendar.md. 기간 차단 UI는 IDEAS 보류
- [x] T1.5 ADMIN 타임라인 매트릭스 뷰 (FE) — 2026-06-11 완료. b1 변환: lib/timeline.ts(셀 상태 6종 enum 고정 — T2.6 재사용 호환 계약, half-open·우선순위 CHECKED_IN>CONFIRMED>HOLD>BLOCKED, 오늘=Asia/Ho_Chi_Minh 기준) + components/admin/timeline-matrix.tsx + /dashboard 렌더(RSC 직접 호출, 신규 API 표면 없음). vitest 14개, QA **최종 통과**(프로덕션 HTTP 3종 증적: 비로그인·SUPPLIER 307 차단, ADMIN 200+마크업 / messages 혼입 0건). 계약: docs/contracts/T1.5-timeline.md. T2.6 잔여: todayIndex 하드코딩 → 기간 이동 UI 도입 시 계산식 교체
- [x] T1.6 iCal 수신 동기화 cron + 충돌 경보 (INTEG) — 2026-06-11 완료. lib/ical.ts(parseIcs·diff 멱등 upsert·충돌 감지·findUnresolvedIcalConflicts) + GET/POST /api/cron/ical-sync(CRON_SECRET Bearer, 미설정 500), vitest 31개, QA 독립 평가 **통과**(계약: docs/contracts/T1.6-ical-sync.md). ~~잔여: Railway 30분 cron 실등록~~(2026-06-11 완료 — `cron-ical-sync` 서비스 */30, 첫 자동 실행 SUCCESS, 등록 패턴은 ops/deployment-pattern.md). 의존 메모: 충돌 경보의 사람 노출은 T2.6 배너(`findUnresolvedIcalConflicts` import, ADMIN 전용)·T3.5 Zalo 알림에서 완성. **TDA 스키마 백로그: NotificationType에 ICAL_CONFLICT 추가**(현재 enum에 없음 — QA 합의 조건 ③)
- [x] T1.7 시즌 달력 설정 화면 + 홀드 시간 + 환율 + lib/pricing.ts (Stitch B8) (FE/BE) — 2026-06-11 전체 완료. FE: /settings(b8 변환 — 시즌 CRUD·홀드 스테퍼·환율 카드), API: /api/seasons CRUD(겹침 경고)·/api/settings(화이트리스트 2키). QA 독립 평가 **통과**(7/7, 403/401/400 전수 확인). 계약: docs/contracts/T1.7-settings-ui.md·T1.7-pricing.md — **BE 완료분**: lib/pricing.ts(quoteStay 박별 합산·resolveSeason LOW 폴백·computeSalePriceVnd 마진·suggestSalePriceKrw 환산·assertSaleAmountColumns 듀얼 컬럼 검증·quoteStayForVilla tx 주입·getFxVndPerKrw), vitest 22개, QA 2차 통과. 잔여: /settings/seasons UI + 홀드 시간 설정 (FE). 계약: docs/contracts/T1.7-pricing.md
- [x] T1.8 ADMIN 사용자 목록(/users): Zalo 연결 뱃지·수동 매칭·비활성화 (Stitch b13 변환) (FE) — 2026-06-11 완료. GET /api/users(passwordHash 차단)·PATCH(비활성화 본인 락아웃 방지 400·LINK_ZALO 중복 409·ZaloConversation 동기화). QA 독립 평가 **통과**(비활성화→로그인 거부 실증). 계약: docs/contracts/T1.8-users.md

## Sprint 2 — F3 제안·가예약 (M1 W4 ~ M2 W1)
- [x] T2.0 Stitch 디자인: B2, B5, B8, C1 → design/stitch/ (DESIGN, 테오 확인) — 2026-06-11 전체 회의 검수 — 조건부 통과
- [ ] T2.1 제안 생성 플로우 (Stitch B2 변환) (FE/BE) — **BE 완료(2026-06-11)**: lib/proposal.ts(채널→통화 기본값·effectiveProposalStatus 시각 판정·uniformNightlyPrice·crypto 토큰) + POST·GET /api/proposals + GET /api/proposals/candidates(전체 재고 — ADMIN 강제). vitest 14개, QA 2차 통과(D-1 Decimal 직렬화 수정 — serialize.ts 단일 소스). 잔여: B2·b12 화면 변환(FE). **스코프 확정(계약)**: holdHours는 Phase 1 AppSetting 전역값만(제안별 24/48h 선택 UI 금지 — 동작 안 함), 항목 1~3개 허용(SPEC "2~3개" 완화 — QA 수용, SPEC v1.4 정오표 대상). 계약: docs/contracts/T2.1-proposal-be.md. (기존 권고: **T1.3 QA 권고**: `findSellableVillaIds`를 villaIds 생략(전체 재고) 호출하는 route는 반드시 ADMIN role 검사 — leak-checklist 점검 항목. **T2.3 QA 이관**: "제안 생성 시 24/48h 선택"의 영속 방식 결정 필요 — (a) Proposal.holdHours 컬럼 추가(TDA 검토) 또는 (b) Phase 1은 AppSetting 전역값만 사용으로 축소. createHold는 holdHours override 인자로 양쪽 모두 수용 가능)
- [ ] T2.2 공개 제안 페이지 /p/[token] (ko, 카운트다운) (FE) — **T2.3 QA 이관(완료 기준에 포함)**: ① HoldRejectedError("SOLD_OUT")의 detail(reasons — 검수 게이트 상태 포함)을 공개 응답에 노출 금지, "마감되었습니다"만 표시 ② quoteStayForVilla의 MissingRateError 미래핑 — 라우트에서 500 아닌 안내로 처리
- [x] T2.3 HOLD 생성 트랜잭션 (동시성 잠금 + 클릭 시점 가용성 재검증·마감 안내) + 가격 스냅샷 (BE) — 2026-06-11 완료. lib/hold.ts `createHoldFromProposalItem`: 단일 $transaction(lockVillaInventory 공용 잠금 → 제안 검증 → checkAvailability 재검증 → 스냅샷 생성), 판매가=ProposalItem 복사·원가=HOLD 시점 합산·fx=Proposal 복사, Proposal ACTIVE→USED 원자 가드(QA D-1 — 제안 레벨 race 차단), 공급자 Notification 큐(판매가 미포함). QA 2차 통과. 계약: docs/contracts/T2.3-T2.4-hold.md
- [x] T2.4 홀드 만료 cron + 확정/취소 액션 (BE) — 2026-06-11 완료. `expireHolds`(status 가드 updateMany — 확정 경합 차단) + app/api/cron/expire-holds(CRON_SECRET Bearer), `confirmHold`(만료 시각 경과 거부)·`cancelBooking`(cancelReason 필수, HOLD 취소 허용 — QA 편차 수용) + app/api/bookings/[id]/confirm·cancel(ADMIN 전용). vitest 19개. ~~잔여: Railway cron 5분 주기 등록~~(2026-06-11 완료 — `cron-expire-holds` 서비스 */5, 자동 실행 SUCCESS 확인. 교훈: 변수는 Deploy 전에 — ops/deployment-pattern.md)
- [ ] T2.5 예약 목록(/bookings, 필터·카운트다운) + 예약 상세(상태별 액션 버튼) (Stitch B5) (FE/BE)
- [ ] T2.6 대시보드(/dashboard): 스탯 카드 4종 + 타임라인 + 활동 피드 + iCal 충돌 경보 배너 (Stitch B1) (FE/BE)

## Sprint 3 — F4 검수 + F5 Zalo (M2 W2~3)
- [x] T3.0 Stitch 디자인: B3, B4, B6 → design/stitch/ (DESIGN, 테오 확인) — 2026-06-11 전체 회의 검수 — 조건부 통과
- [ ] T3.1 체크인: 여권 업로드 + Gemini OCR + 보증금 기록 (Stitch B3 변환) (INTEG/BE)
- [ ] T3.2 동의서 표시 + 터치 서명 패드 (FE)
- [ ] T3.3 체크아웃: 기준사진 비교 UI + 차감 기록 (FE/BE)
- [ ] T3.4 CleaningTask 자동 생성 + isSellable 게이트 + 검수 목록·승인 화면(/inspections) (Stitch B6) (BE/FE)
- [ ] T3.5 lib/zalo.ts OA 발송 + Notification 로그 + 재시도 cron (INTEG)
- [ ] T3.6 여권 Zalo 전달 (임시거주신고) (INTEG)
- [ ] T3.7 Zalo 계정 연결 온보딩: OA follow webhook + 전화번호 매칭 + ADMIN 미연결 뱃지·수동 매칭 (INTEG/UX-VN)

## 디자인 후속 — 2026-06-11 전체 회의 (Stitch 24장 산출, QA 권한 누수 0건, 조건부 통과)
- [x] T5.0 (소급 등재) Stitch 추가 화면 산출 — 태스크 미등재 상태로 생성: A0-zalo-connect, A2b(위치정보), A5(요율입력), A6(내 빌라), A7(내 수익), B9(빌라 목록), B10(빌라 상세), B11(예약 상세), B12(제안 목록) (DESIGN) — 2026-06-11 전체 회의 검수 — 조건부 통과
- [x] T5.1 누락 화면 4장 생성: a0-login, c2-proposal-expired, c3-booking-request, a8-cleaning-tasks + 기존 화면 결함 수정: a1·a3·a5·a6, b1·b3·b4·b6·b8-settings·b8-users·b11, c1 + b8-users → b13-users 폴더 재번호 (DESIGN) — 2026-06-11 완료, LOC 피드백 2차 수정(a5 문구·a4 용어·헤더·Bước 표기·b4/b6/b10 영어) 포함
- [x] T5.2 디자인 수정 완료 후 QA 재검수 — 전 화면 + 권한 누수 재확인 (QA) — 2026-06-11 **통과**: 누수 0건, 회귀 9건 ✓, 용어 0건. 반려 2건(c2 export 파손·c3 스크린샷 미달) 수정 후 형식 검증 완료
- [x] T5.3 LOC 용어 사전(ko/vi) 확정 (LOC) — 2026-06-11 완료, .claude/skills/loc/i18n-pattern.md 등재 (용어 20항목 + 호칭 규칙 + 키 네이밍)
- [ ] T5.4 Stitch 웹 UI에서 미사용 중복 화면 3건 수동 삭제 (테오) — a8 중복본(1bef1975), b13 중복본(ee420eae), c2 구버전(83ca80d7) — MCP에 삭제 도구 없음
- [ ] T5.5 변환 시 처리 목록 (FE/UX-VN 변환 단계에서 일괄 해소): b3 "지우기 (CLEAR)" 괄호 영문, title 메타 11건 누락·2건 영어(Next.js metadata로 정의), c1·c2 푸터 © 영문 보일러플레이트, c2 만료/마감 2상태 병기(서버 판정값으로 1개만 렌더), 다크 디자인 시스템 designMd "VND with dots" 갱신, [2R 추가] 마법사 단계 표기 Bước N/4→N/5 재번호(ICU 변수 `Bước {n}/{total}`), b10 요율 5열 너비 조정(KRW 환산 열 클리핑), c3·c3-vnd "Step 01/02"→"단계 1/2" i18n, keep-all/nowrap 규칙 globals.css 전역 강제, 사이드바 9메뉴(메시지 추가)는 공통 컴포넌트에서 일괄 적용

## 신규 요구 후속 — 2026-06-11 테오 4건 (ADR-0003, SPEC v1.3, schema v1.2)

### DESIGN 2라운드 (신규·수정 화면 목록 — DESIGN이 이 목록으로 작업)
- [x] T6.1 신규 3장 (DESIGN): **b14-zalo-chat** (다크, 인박스+대화창+번역 토글+48h 창 비활성 상태), **b1-mobile** (대시보드 모바일 변형 390px — 타임라인을 "오늘 중심 리스트"로 재구성), **a9-amenities** (공급자 비품 입력 — 마법사 4/5, vi 라이트, 카테고리 탭 4종+체크박스+미니바 스테퍼) — 2026-06-11 완료, QA 통과. 단 Stitch 클라우드 생성 타임아웃으로 로컬 컴포지션(프롬프트는 DESIGN.md 기록 — 추후 수정 시 재컴포지션 필요)
- [x] T6.2 수정 9장 (DESIGN): b2(채널 선택→통화 자동 전환+환율 참고 표시), c1·c3(VND 변형 — ₫ 천단위 쉼표, 별도 폴더 c1-vnd·c3-vnd), b5·b11·b12(금액 열 통화 기호 병기), b7(매출 통화별 분리 — KRW/VND 합산 금지), b10(비품 섹션 읽기 전용 + salePriceVnd 요율 열), b4(미니바 확인 체크리스트 섹션) — 2026-06-11 완료, QA 통과(반려 0건). 글자 세로 낙하 전수 수정(Noto Sans KR 폴백+keep-all/nowrap) 포함, 총 33장

### 구현 (각 스프린트에 흡수 — 담당 표기)
- [ ] T6.3 결제 통화: ~~lib/pricing.ts 통화 분기(saleCurrency별 박별 합산)~~(2026-06-11 T1.7 BE에서 완료 — KRW number/VND bigint 분기, USD 명시 거부 게이트) + VillaRate salePriceVnd 편집(빌라 승인·요율 화면) + 제안·HOLD 통화/환율 스냅샷 + /settings 환율(FX_VND_PER_KRW) 입력 UI (BE/FE — Sprint 2 T2.1~T2.3과 병행, 잔여 3건). **주의: StayQuote는 원가 포함 — ADMIN 외 응답 직렬화 금지(leak-checklist 등재)**
- [ ] T6.4 비품: ~~마법사 4/5 비품 단계(a9 변환, 품목 사전 i18n 키는 LOC)~~(2026-06-11 T1.1에서 완료 — lib/amenities.ts 25종 + amenities.* i18n 키) + 내 빌라 상세 비품 수정 + ADMIN b10 비품 조회 (UX-VN/FE/LOC — Sprint 1 T1.2와 병행, 잔여 2건)
- [ ] T6.5 체크아웃 미니바 확인 체크리스트 (읽기 전용, b4 변환에 포함) (FE — Sprint 3 T3.3과 병행)
- [ ] T6.6 Zalo 채팅: webhook message 이벤트 수신(T3.7 엔드포인트 분기) → ZaloConversation/ZaloMessage 저장 + /messages 채팅 화면(48h 창 비활성) + Gemini 번역(수신 자동·발신 미리보기) + F5 알림 OUTBOUND 미러 기록 (INTEG/FE/BE — Sprint 3 T3.5·T3.7과 병행)
- [ ] T6.7 관리자 반응형: <1024px 햄버거 드로어 레이아웃 + ResponsiveTable 공통 컴포넌트(<768px 카드 전환 — b5·b9·b12·b13 적용) (FE — 각 화면 변환 시 적용, QA가 360×800 뷰포트 검증)

## Sprint 4 — QA·온보딩 (M2 W4)
- [x] T4.0 Stitch 디자인: B7 → design/stitch/ (DESIGN, 테오 확인) — 2026-06-11 전체 회의 검수 — 조건부 통과
- [ ] T4.1 권한 누수 테스트 4종 (SPEC 공통 요구) (QA)
- [ ] T4.2 시드 스크립트: 쏘나씨 V11/V12/V25 + 썬셋 사나토 실데이터 입력 (PM)
- [ ] T4.3 공급자 온보딩 가이드 (vi, 이미지 1장짜리) (LOC/UX-VN)
- [ ] T4.4 베트남 사용자 1명 실사용 테스트 → 피드백 반영 (PM/UX-VN)
- [ ] T4.5 F6 최소 정산: ADMIN 월 집계·PAID 처리 + SUPPLIER /my-earnings 원가 조회 (Stitch B7 — DESIGN 선행) (BE/FE)
- [ ] T4.6 LAUNCH.md 오픈 체크리스트 최종 점검 → 오픈 (PM/QA/OPS)

## Phase 2 백로그
- [ ] 정산 페이지 (다중 통화 수납 + VND 지급 + 환차 기록, 환전 LEDGER 패턴)
- [ ] 월 정산서 PDF (vi) 자동 생성
- [ ] 품질점수 로직 + 판매 후순위 정렬
- [ ] 부가서비스(ServiceOrder) 판매 UI
- [ ] 시즌 요율 환율 자동 갱신
- [ ] TravelDiary 연계 직판
