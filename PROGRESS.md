# PROGRESS.md — Villa PMS

| 날짜 | 스프린트 | 완료 내용 | 비고 |
|---|---|---|---|
| 2026-06-11 | - | 사업계획서 V1.0, CLAUDE.md/SPEC.md/TASKS.md/schema.prisma 스캐폴딩 완료 | 개발 착수 전 |
| 2026-06-11 | - | 에이전트 체계 완성: 기존 8개 + 신규 3개(DESIGN·OPS·LOC) 섭외, 스킬 3종 추가, CLAUDE.md/INDEX.md/TASKS.md 반영 | DESIGN은 Stitch MCP 직접 사용 |
| 2026-06-11 | - | 오픈 스펙 확정(ADR-0002): SPEC v1.1(F0 가입·F6 최소 정산·엣지 케이스), 스키마 AuditLog·AppSetting 추가, LAUNCH.md 신설, 태스크 6건 추가 | 오픈 이슈 4건 해소 |
| 2026-06-11 | - | SPEC v1.2: F7 운영자 대시보드·예약 관리 추가 (관리자 IA·대시보드·예약 목록·청소 검수 목록), DESIGN.md B5~B8 프롬프트 추가, 태스크 반영 | 관리자 페이지 기획 완결 |
| 2026-06-11 | T1.0/T2.0/T3.0/T4.0 | Stitch 1차 디자인 16장 전체 생성 완료 (A0~A4, B1~B8, C1) → design/stitch/ 저장, 디자인 시스템 2종 | 테오 검토 대기, 수정은 edit_screens |
| 2026-06-11 | 디자인 검수 | 기획 대비 검수: 누락 8장 추가(마법사 2·4단계, 내 빌라, 내 수익, 빌라 목록·상세, 예약 상세, 제안 목록) → 총 24장. 불일치 수정: C1 탭바 제거, B2 수수료 블록 제거, 사이드바 8메뉴 통일, A5 팁 카드 제거 | SPEC F1 마법사 4단계 확정, DESIGN.md 프롬프트 8종 추가 |
| 2026-06-11 | 디자인 전체 회의 | PM·UX-VN·FE·QA 4자 검토 → **조건부 통과**. 권한 누수 0건(QA). 누락 화면 4건 확정: 로그인, C1 상태 변형(만료·마감·가예약 완료), 청소 태스크 목록. 가독성 결함: A그룹 중요 6건(a6 영어 잔존, a5 원가 문구·Tết 0₫, a1 베란다 누락, a3 범례 대비, 마법사 용어 불일치), B그룹 중요 5건(b3·b6·b8 사이드바 비표준 재발, b4 VND 구분자 혼재, b3·b6·c1 영어 잔존), 환율 표기 USD 기준(b1) | 수정은 DESIGN 에이전트 edit_screens로 진행 예정, 상세는 회의록 참조 |

| 2026-06-11 | T5.1~T5.3 | 회의 후속 완료: 신규 4장 생성(a0-login, a8-cleaning-tasks, c2-proposal-expired, c3-booking-request) + 기존 12장 결함 수정 + LOC 2차 수정 + b8-users→b13-users 재번호. LOC 용어 사전 확정(i18n-pattern.md). QA 재검수 **통과**(누수 0건, 회귀 9건 ✓, 용어 0건 — 반려 2건 수정 완료) → 총 28장, 디자인 단계 종결 | 잔여: T5.4 Stitch 중복 화면 수동 삭제(테오), T5.5 변환 시 처리 목록 |

| 2026-06-11 | T0.1/T0.2/T0.6 | Next.js 15 프로젝트 초기화 + Railway 배포 완료. URL: villa-pms-production.up.railway.app. PostgreSQL 연결 + prisma db push 완료. GitHub: orangetaeo/villa-pms | Tailwind v4→v3 다운그레이드, nixpacks.toml로 npm install 강제 적용 |

| 2026-06-11 | 2차 전체 회의 (테오 7건) | ① 글자 세로 낙하 전수 박멸 — 근본 원인: 한글 글리프 없는 폰트(Public Sans 등)+word-break → Noto Sans KR 폴백+keep-all/nowrap 16장 적용 ② ADR-0003 확정: 채널별 통화(여행사·랜드사 VND, 산정 기준 VND), 비품 VillaAmenity 모델+마법사 5단계, Zalo 채팅 b14(번역 통합, 48h 창), 관리자 반응형(1024px 햄버거·768px 카드) ③ 신규 3장(b14·b1-mobile·a9-amenities)+수정 9장+VND 변형 2장 → **총 33장** ④ QA 최종 **통과(반려 0건)** — 누수 0건·낙하 회귀 0건·스펙 반영 100% ⑤ SPEC v1.3, schema v1.2(validate 통과), a6·a7 재캡처 완료 | 주의: schema v1.2는 T0.2 db push 이후 변경 — **다음 세션에서 prisma db push 재실행 필요**. 잔여: T5.4(Stitch 웹 중복·고아 화면 수동 삭제), T5.5(변환 시 처리 목록), playwright-core devDependency 추가됨(OPS 인지) |

| 2026-06-11 | T0.3/T0.5 | 인증·i18n 완료: NextAuth v5 Credentials(전화번호+비밀번호), 자가 가입 /signup(SUPPLIER, AuditLog 기록), 로그인 /login — **화면은 Stitch a0-login·a0-signup 그대로 변환**(라이트 teal, Be Vietnam Pro, Material Symbols, 56px 터치 타겟). Role 미들웨어(역할별 허용 경로 맵 + locale 쿠키 자동: admin→ko, supplier·auth→vi), 라우트 그룹 (admin)/(supplier) 가드 레이아웃, lib/prisma.ts·lib/audit-log.ts(writeAuditLog), 루트 / role별 분기. Noto Sans KR 폴백+keep-all 전역 적용. 빌드·typecheck 통과, 미인증 보호 경로 6종 /login 리다이렉트 확인 | **교훈: UI는 반드시 design/stitch/ export 변환 — 초기에 임의 디자인으로 만들었다가 전면 재작업.** 메모리에 규칙 영구 저장. 잔여: 실 DB 연결 로그인 E2E(로컬 .env DATABASE_URL placeholder), dashboard·my-villas는 플레이스홀더(각 변환 태스크에서 구현) |

| 2026-06-11 | T0.4 | 이미지 저장소 완료 (ADR-0004): lib/storage.ts 백엔드 자동 선택 — STORAGE_* 5종 설정 시 Cloudflare R2(S3 SDK), 미설정 시 디스크. 인터림 Railway volume(villa-pms-volume, /data) + UPLOAD_DIR=/data/uploads — 재배포 시 파일 소멸 문제 해결. app/uploads/[name] 서빙 라우트(경로 탈출 차단·immutable 캐시), lib/image-resize.ts 클라 리사이즈(긴 변 1600px·EXIF 회전·HEIC 폴백). T1.1 세션과 lib/storage.ts 공동 작업(QA MIME 화이트리스트 반영). ADMIN 계정(테오) 시드 + 프로덕션 로그인 검증 | 잔여: 테오 Cloudflare R2 버킷+API 토큰 → STORAGE_* 입력 시 R2 전환(코드 무변경). sharp 서버 압축 미채택(nixpacks 네이티브 리스크) — 클라 리사이즈로 대체 |

| 2026-06-11 | T1.3 | 가용성 판정 완료 (병행 세션 — T1.1과 충돌 0건): lib/availability.ts 단일 소스 — 순수 판정층(overlapsHalfOpen·assertValidStayRange·evaluateAvailability: available/sellable 분리+사유 코드) + DB 래퍼층(checkAvailability·findSellableVillaIds, PrismaClient/$transaction 클라이언트 주입 — T2.3 HOLD 트랜잭션 재검증 재사용 설계). vitest 도입(`npm test`, vitest.config.ts), 단위 테스트 18개(half-open 경계·back-to-back 허용·비점유 4종 제외·검수 게이트 분리·복합 사유). typecheck·lint 통과, QA 독립 평가 **통과**(반려 0건) | QA 권고 2건을 TASKS.md에 부착: ① T2.3 — API 날짜 입력 UTC 자정 정규화 ② T2.1 — findSellableVillaIds 전체 조회는 ADMIN route 한정(누수 검사 항목). 계약: docs/contracts/T1.3-availability.md |

| 2026-06-11 | T1.1 | SUPPLIER 빌라 등록 마법사 5단계 완료: `app/(supplier)/my-villas/new` — Stitch a2(기본정보 1/5)→a2b(위치 2/5, 건너뛰기)→a1(사진 3/5, 침실·욕실 수 동적 슬롯+즉시 업로드+클라 리사이즈)→a9(비품 4/5, 4탭+미니바 스테퍼, lib/amenities.ts 품목 사전 25종)→a5(원가 5/5, 시즌 3카드+숫자 키패드, 미입력 시 제출 disabled). ICU `Bước {n}/{total}` N/5 재번호, VND 점 구분, 헤더 "Đăng ký villa" 통일. POST /api/villas($transaction: Villa PENDING_REVIEW+Photo+Amenity+Rate, supplierId 세션 강제, writeAuditLog), lib/villa-schema.ts 공유 zod. globals.css nowrap 전역 규칙(T5.5), my-villas에 "+ Thêm villa" FAB. QA 독립 검증 **통과**(권한 누수 0건, 완료 기준 7/7) — 1차 조건부 통과의 M1(업로드 SVG stored XSS)은 MIME 화이트리스트 강제로 수정 후 재검증 통과, 교훈 leak-checklist 등재. tsc·lint·build 통과 | 합의 편차: react-hook-form 미사용(제어 컴포넌트+zod — package.json 동결 시점 결정). VillaRate 마진·판매가는 0 초기화 — T1.2 운영자 화면에서 설정. 계약: docs/contracts/T1.1-villa-wizard.md. 비차단 권고: app/uploads/[name] 응답에 X-Content-Type-Options: nosniff 1줄(BE, 다음 스프린트) |
| T1.7(BE) | 가격 계산 lib/pricing.ts (박별 합산·통화 분기·마진·환산·듀얼 컬럼 검증) + vitest 22개 — T2.1·T2.3·T1.2 요율 제안의 기반 |
| T2.3/T2.4 | HOLD 수명주기 lib/hold.ts (생성 트랜잭션·만료 cron·확정/취소) + cron/expire-holds + bookings confirm·cancel API — QA 2차 통과 |
| T2.1(BE) | 제안 생성 lib/proposal.ts + proposals·candidates API — T2.2 /p/[token]의 기반, QA 2차 통과 |
| T2.2 | 공개 제안 페이지 /p/[token] (c1·c2·c3 변환) + 공개 HOLD API — F3 가예약 체인 완성, QA 3차 통과 |
| T3.4(BE) | 청소 검수 게이트 lib/cleaning.ts + cleaning-tasks API + 정기 방역 cron — isSellable 단일 setter, QA 통과 |

| 2026-06-11 | T1.7(BE)/T6.3(일부) | 가격 계산 완료 (병행 세션 — T1.2·T1.4·T1.6과 충돌 0건): lib/pricing.ts 단일 소스 — 순수층(resolveSeason [start,end) half-open·LOW 폴백·겹침 PEAK>HIGH 우선, quoteStay 박별 합산+KRW number/VND bigint 통화 분기+MissingRateError, computeSalePriceVnd 마진 PERCENT 내림/FIXED_VND, suggestSalePriceKrw 1e4 스케일 BigInt half-up 환산, assertSaleAmountColumns 듀얼 컬럼 검증) + DB 래퍼(quoteStayForVilla tx 주입, getFxVndPerKrw). vitest 22개(총 40), tsconfig target ES2020 1줄(BigInt 리터럴 — 계약서 선언, 전체 typecheck 회귀 0건). QA 1차 반려(D1 USD 무검증 통과·D2 원가 노출 가이드) → 수정 후 2차 **통과** | 교훈 2건 money-pattern 등재(통화 화이트리스트 게이트·BigInt 환율 반올림), 원가 누수 점검 항목 leak-checklist 등재. **StayQuote는 원가 포함 — ADMIN 외 응답 직렬화 금지.** 잔여: /settings/seasons·환율 입력 UI(FE). 계약: docs/contracts/T1.7-pricing.md |

| 2026-06-11 | T1.2 | ADMIN 빌라 목록·승인·요율 완료 (b9·b10 변환): 공통 사이드바 components/admin/sidebar.tsx(9메뉴·햄버거 드로어) + ResponsiveTable 컴포넌트, /villas 목록(상태 필터 탭+승인 대기 카운트), /villas/[id] 상세(사진·비품 읽기 전용·요율 편집·승인/중단/재개). API: PATCH /api/villas/[id] 상태 전이표(409 가드)·PUT rates 시즌 upsert(supplierCostVnd 수정 차단)·GET 목록(SUPPLIER는 supplierId 스코프+select 화이트리스트로 마진 쿼리 차단). lib/format.ts(BigInt 문자열 천단위)·lib/serialize.ts. QA 독립 평가 **통과**(완료 기준 7/7, 누수 4종 ✓ — 제2 공급자 시드 교차 실증, 교훈 3건 leak-checklist 등재). nosniff 헤더 권고 반영 | 반려(REJECT)는 T1.2b로 보류(VillaStatus 반려 상태 없음 — 공급자 수정 화면과 함께 설계). 권고: rate-editor 16자리+ 입력 시 오류 안내 부재(경미). QA 시드: ADMIN 0900000002·SUPPLIER2 0900000003 — 오픈 전 삭제 대상 |

| 2026-06-11 | T1.4 | SUPPLIER 월 달력 완료 (a3 변환): `app/(supplier)/calendar` — 빌라 칩 행(supplierId 스코프), 월 이동, 셀 4상태 색+패턴(Trống 초록 외곽선/Đã đặt 파랑 실선/Giữ chỗ 파선/Đã khóa 빗금), 범례, 바텀시트 Khóa ngày·Hủy khóa(MANUAL만, ICAL은 안내·과거 읽기 전용). 서버 컴포넌트가 셀 상태로 가공해 전달 — **고객명·금액·예약 id 비전달 구조**(마진·재고 비공개). POST/DELETE /api/calendar-blocks(소유권 404, 겹침 409, UTC 자정 정규화, AuditLog). 하단 탭바 components/supplier/tab-bar.tsx(4탭, 마법사에서 숨김) + /cleaning·/earnings placeholder. QA 1차 조건부 통과 → D1(advisory lock — lib/availability.ts `lockVillaInventory()` 공용 헬퍼, T2.3 HOLD와 락 키 공유)·D2(401/403 분리)·D3(과거 블록 삭제 거부) 수정 → 재검증 **통과**(누수 0건) | 합의 편차: 기간 차단 대신 단일 날짜 토글(a3 확정 디자인 우선) — 기간 UI는 IDEAS. 교훈: READ COMMITTED 재조회 race → availability-pattern.md 등재. 계약: docs/contracts/T1.4-supplier-calendar.md. 잔여: 배포 후 Playwright UI 검증 |

| 2026-06-11 | T1.6 | iCal 수신 동기화 완료 (병행 세션 — T1.2·T1.7과 충돌 0건, 신규 파일만): lib/ical.ts 단일 소스 — 순수층(parseIcs: RFC 5545 언폴딩·VALUE=DATE·TZID 벽시계 직취·Z→Asia/Ho_Chi_Minh 변환·DTEND 시간 성분 올림·CANCELLED 제외, diffIcalEvents UID 멱등 분류, findEventBookingConflicts) + DB 래퍼(syncVillaIcal: **모든 URL 성공 시에만 합집합 기준 소멸 삭제 — 1개 실패 시 삭제 전면 스킵**(재고 보수), MANUAL 불변, 충돌이어도 블록 생성+보고, AuditLog 커밋 후 기록; runIcalSync 빌라 단위 실패 격리; findUnresolvedIcalConflicts — T2.6 배너용 ADMIN 전용). GET/POST /api/cron/ical-sync(CRON_SECRET Bearer 선검증, 미설정 500, force-dynamic). vitest 31개, typecheck·lint 통과, QA 계약 합의(조건 5건 반영)+독립 평가 **통과** | 공유 파일: vitest.config.ts `@` alias 1건(선언·회귀 0건). 잔여: **Railway 30분 cron 실등록(테오/OPS)**. TDA 백로그: NotificationType ICAL_CONFLICT. 교훈 .claude/skills/integ/ical-pattern.md 신설+ops cron 패턴 등재. 계약: docs/contracts/T1.6-ical-sync.md |

| 2026-06-11 | T2.3/T2.4 | HOLD 수명주기 완료 (병행 세션 — 충돌 0건): lib/hold.ts 단일 소스 — `createHoldFromProposalItem` 단일 $transaction(lockVillaInventory 공용 빌라 잠금 → 제안 검증 → checkAvailability 재검증[더블부킹 최종 방어선] → 스냅샷 생성: 판매가=ProposalItem 복사·원가=quoteStayForVilla HOLD 시점 합산·fx=Proposal 복사), Proposal ACTIVE→USED **원자 가드**(QA D-1: 빌라 락이 못 지키는 제안 레벨 race를 updateMany status 가드로 차단), `expireHolds`(cron, status 가드)·`confirmHold`(만료 경과 거부)·`cancelBooking`(사유 필수). 라우트: cron/expire-holds(CRON_SECRET)·bookings/[id]/confirm·cancel(ADMIN 전용, serializeBigInt). 공급자 Notification PENDING 큐 적재(payload에 판매가·마진·원가 없음 — 실발송 T3.5). lib/audit-log.ts tx 주입(additive)·lib/availability.ts lockVillaInventory 공용 헬퍼 추가. vitest 19개(전체 85), QA 1차 반려(D-1 제안 race·D-2 상태 가드) → 수정 후 2차 **통과** | QA 편차 판정: HOLD→CANCELLED 허용 **수용**(SPEC v1.4 반영 권고), holdHours 영속 방식은 T2.1로 이관(TASKS 메모). T2.2 완료 기준 2건 이관(SOLD_OUT detail 비노출·MissingRateError 처리). 교훈 availability-pattern 등재(락 단위 밖 불변식은 원자 가드). 잔여: Railway cron 등록(OPS). 계약: docs/contracts/T2.3-T2.4-hold.md |

| 2026-06-11 | T1.7(FE) | 운영 설정 화면 완료 (b8-settings 변환): /settings — 시즌 달력 CRUD(LOW/HIGH/PEAK 뱃지, 겹침 시 경고 — PEAK>HIGH 우선 규칙 안내), 홀드 시간 스테퍼(1~168h), 환율 카드(1 KRW = x VND, 마지막 수정 시각). API: /api/seasons GET/POST/PUT/DELETE(UTC 자정 정규화·half-open·겹침 overlaps 응답) + /api/settings GET/PUT(화이트리스트 2키 — 임의 키 주입·노출 차단), 전부 ADMIN 전용+AuditLog. 환율 저장 → T1.2 요율 KRW 자동 제안 연동 확인. QA 독립 평가 **통과**(완료 기준 7/7, 6메서드 403/401 전수, 경계값 400 전수) | 비고: QA 테스트로 FX_VND_PER_KRW=18.6·HOLD=48 설정됨(무해 — 의도값 아니면 /settings에서 수정). rate-editor의 KRW 제안 float 중복 구현은 기록만(저장값 아님). 교훈 2건 leak-checklist 등재 |

| 2026-06-11 | cron 등록 (OPS) | T1.6·T2.4 잔여 해소 — Railway cron 2종 실등록·가동 확인: `cron-ical-sync`(*/30)·`cron-expire-holds`(*/5), 각각 `curlimages/curl` 미니 서비스 + CRON_SECRET 참조 변수(`${{villa-pms.CRON_SECRET}}`) + Bearer 호출. **후속 장애·해결**: 등록 직후 스케줄 실행이 양쪽 모두 연속 401 — 원인은 Start Command의 `$CRON_SECRET`가 **스케줄 트리거에서만 셸 확장이 안 됨**(Deploy 직후·Run now는 확장됨 — 경로별 실행 방식 차이). `sh -c '...'` 래핑으로 해결, 스케줄 자동 실행 성공(12:40 expiredCount 로그)까지 확인. 테오 대시보드 작업 + CLI 변수 설정·진단 협업 | 교훈 정정: ① Start Command `$VAR`는 `sh -c` 필수 ② 검증은 4단계(무인증 401 → 수동 200 → Run now → **스케줄 트리거 성공**) — Run now와 스케줄은 실행 경로가 다름. ops/deployment-pattern.md 등재. Zalo 재시도 cron(10분)은 T3.5에서 동일 패턴 |

| 2026-06-11 | T2.1(BE) | 제안 생성 BE 완료 (병행 세션 — 충돌 0건): lib/proposal.ts — defaultCurrencyForChannel(DIRECT→KRW·여행사/랜드사→VND), effectiveProposalStatus(시각 기준 서버 판정 — c2 단일 렌더 소스), uniformNightlyPrice(균일가만 perNight, 시즌 경계 null — 평균 가공 금지), generateProposalToken(crypto 192bit — cuid 추측 가능성 차단), createProposal(트랜잭션: 항목별 sellable 재검증→박별 합산 스냅샷→듀얼 컬럼 검증, 부분 생성 금지, fx 스냅샷, AuditLog). 라우트: POST·GET /api/proposals, GET /api/proposals/candidates(전체 재고 ADMIN 강제, 요율 미설정 빌라 warnings 분리). vitest 14개(전체 101). QA 1차 반려 → 2차 **통과** | **QA D-1(중대)**: Prisma.Decimal(fxVndPerKrw)이 serializeBigInt에서 {s,e,d}로 파손 — FX 미설정이면 null이라 안 보이는 "공허 통과". serialize.ts isDecimal 분기로 단일 수정(bookings/confirm 잠재 결함 동시 치유) + 교훈 leak-checklist 등재. 401/403 분리 5핸들러. 스코프 확정: holdHours Phase 1 전역값만·항목 1~3(QA 수용). 잔여: B2·b12 FE 변환. 계약: docs/contracts/T2.1-proposal-be.md |

| 2026-06-11 | T1.8 | ADMIN 사용자 관리 완료 (b13-users 변환): /users — 검색·역할 탭, 역할/Zalo 연결/활성 뱃지, 활성 토글(본인 행 disabled+API 400 이중 방어), Zalo 수동 매칭(미연결 ZaloConversation 선택 연결·해제, 웹훅 전 빈 상태 안내). API: GET(select 화이트리스트 — passwordHash 차단)·PATCH(discriminated union 4액션, LINK_ZALO 중복 409, $transaction으로 ZaloConversation userId 동기화), AuditLog 전 변경 기록. QA 독립 평가 **통과**(34항목 — 비활성화→로그인 실거부→재활성화 복구 실증, 누수 0건) | CLEANER 계정 0명이라 해당 뱃지는 코드 경로 확인만 — CLEANER 생성 태스크에서 재확인. 교훈 2건 leak-checklist 등재. ResponsiveTable rowClassName prop 추가(비파괴) |

| 2026-06-11 | T1.5 | ADMIN 타임라인 매트릭스 완료 (b1 변환, 병행 세션 — T1.8·T2.1·T2.2와 충돌 0건): lib/timeline.ts 단일 소스 — 순수층(buildDayAxis UTC 자정 축·M/D 라벨 getUTC*, computeVillaRow: half-open·우선순위 CHECKED_IN>CONFIRMED>HOLD>BLOCKED·isSellable=false 공실=NOT_SELLABLE·윈도우 클리핑, 오늘=Asia/Ho_Chi_Minh 기준 — QA 합의 조건) + DB층 loadTimeline(ACTIVE 전체 — ADMIN 전용 소비 주석, select 최소화). 셀 상태 6종 enum 고정(T2.6 재사용 호환). components/admin/timeline-matrix.tsx(b1 충실: sticky 빌라명 열·범례 4종·빗금 HOLD — striped/sticky는 arbitrary value로 globals.css 무수정), /dashboard placeholder 교체. 셀에 상태만 — 고객명·금액·예약 id 비전달. vitest 14개(전체 115), QA 조건부 통과 → 배포 후 프로덕션 HTTP 3종 증적(비로그인 307·SUPPLIER 세션 307 차단·ADMIN 200+타임라인 마크업) 제출 → **최종 통과** | messages는 T1.8 미커밋 키 혼입 방지 위해 git update-index 부분 스테이징(adminDashboard만 — QA가 b48110a diff 전수 확인, 배포 원자성 유지 편차 승인). 교훈 후보: 공유 JSON 부분 스테이징 패턴. T2.6 잔여: todayIndex 계산식 교체. 계약: docs/contracts/T1.5-timeline.md |

| 2026-06-11 | T2.2 | 공개 제안 페이지 완료 (병행 세션 — 충돌 0건): /p/[token] Stitch c1·c1-vnd 변환(통화 분기 — KRW "1,350,000원"/VND "25,500,000₫" 쉼표, 만료 배지, 사진 캐러셀, 날짜 요약/카드별 분기), c2 변환(만료 EXPIRED·REVOKED/마감 USED·notice — **서버 판정 단일 렌더**, 카카오·전화 버튼 AppSetting), c3 변환(가예약 입력 RHF+zod+인원 추가, 완료: 입금 안내 카드+계좌 복사+실시간 카운트다운, bg-mesh 재현) + 공개 HOLD API(교차 토큰 404, 거부 사유 expired/closed 2종 축약 — T2.3 QA 이관 이행, MissingRateError 500 금지). 미들웨어 공개 통과 확인. tests/public-format 8개(전체 123). QA 1차 반려(M1~M7 디자인 충실도·L1~L4)→수정→2차 반려(MESH_BG radial 위치)→3차 **통과**, 누수 0건 | AppSetting 신규 키 5종(은행 3·연락처 2) — T1.7 /settings 입력 UI 잔여. 교훈 2건 leak-checklist 등재(미신고 편차 반려 원칙·globals.css 동결 시 컴포넌트 내 해결). rate limit은 Phase 1 수용(QA) — IDEAS 후보. 계약: docs/contracts/T2.2-public-proposal.md |

| 2026-06-11 | T3.4(BE) | 청소 검수 게이트 완료 (병행 세션 — 충돌 0건): lib/cleaning.ts 단일 소스 — 상태기계(PENDING→제출→승인|반려→재제출, 직행 금지), createCheckoutCleaningTask(tx 주입 — T3.3 체크아웃 트랜잭션에서 게이트 닫기와 원자 묶임), **게이트 규칙 canOpenSellableGate: 같은 빌라 미결 CHECKOUT 0건일 때만 isSellable=true — PERIODIC 승인 우회 차단**, 반려는 게이트 닫힌 채 유지, 정기 방역 월 1회 멱등(monthKeyVn VN 시차 기준). API: GET 목록(ADMIN 전체/SUPPLIER 자기 빌라/CLEANER 배정분 스코프 강제), submit(3자 권한)·approve·reject(ADMIN), cron/periodic-cleaning(CRON_SECRET). vitest 11개(전체 154). QA **통과** — 동적 DB 검증 17건(throwaway 시드 실측): PERIODIC 우회 불가·연속 체크아웃 마지막 승인에만 개방·동시 제출 가드·멱등 실증, isSellable=true setter는 전 코드베이스에서 승인 함수 1곳뿐 | QA 비차단 3건 TASKS 백로그(승인 tx 직렬화·404/403 순서·cron 중복 방어), **TDA 안건 T3.4b 신설: 신규 빌라 게이트 초기 개방 절차**(닭과 달걀 — 첫 판매 경로 부재). 결함 #1(status 필터 프로토타입 체인 500)은 즉시 수정(Object.hasOwn). 계약: docs/contracts/T3.4-cleaning-gate.md |

## 현재 상태 (2026-06-11 기준)

### 완료된 태스크
| 태스크 | 내용 |
|---|---|
| T0.1 | Next.js 15 + TypeScript + Prisma + next-intl + NextAuth v5 초기화 |
| T0.2 | schema.prisma → Railway PostgreSQL prisma db push 완료 |
| T0.6 | Railway 배포 완료 (nixpacks, Node 20, Tailwind v3) |
| T1.0~T4.0 | Stitch 디자인 28장 생성 + QA 통과 (design/stitch/ 저장) |
| T5.1~T5.3 | 디자인 결함 수정 + LOC 용어 사전 확정 |
| T0.3 | 인증 완료 — NextAuth v5, /signup·/login (Stitch a0 변환), Role 미들웨어, (admin)/(supplier) 라우트 그룹 |
| T0.5 | i18n 완료 — locale 쿠키 기반 ko/vi, auth 네임스페이스 키, Noto Sans KR 폴백 전역 |
| T1.3 | 가용성 판정 lib/availability.ts + vitest 단위 테스트 18개 — T1.4·T1.5·T2.1·T2.3의 기반 |
| T0.4 | 이미지 저장소 — R2 백엔드+디스크 폴백 자동 선택, Railway volume 인터림, 클라 리사이즈 (ADR-0004) |
| T1.1 | SUPPLIER 빌라 등록 마법사 5단계 (a2·a2b·a1·a9·a5 변환) + POST /api/villas + 비품 품목 사전 — QA 통과 |
| T1.2 | ADMIN 빌라 목록·승인·요율 (b9·b10 변환) + 공통 사이드바·ResponsiveTable — QA 통과 (반려는 T1.2b 보류) |
| T1.7(BE) | 가격 계산 lib/pricing.ts (박별 합산·통화 분기·마진·환산) + vitest 22개 — /settings UI는 잔여 |
| T1.4 | SUPPLIER 월 달력 (a3 변환) + /api/calendar-blocks + 공급자 하단 탭바 — QA 통과 (D1~D3 수정 후 재검증) |

### 진행 중 / 대기 중
| 태스크 | 상태 | 담당 |
|---|---|---|
| T5.4 | Stitch 중복 화면 3건 수동 삭제 대기 (테오) | 테오 직접 |
| 디자인 추가 작업 | **완료** — 2차 전체 회의(테오 7건) 처리: 낙하 수정+신규 3장+수정 9장, 총 33장, QA 통과 (위 이력 참조) | DESIGN/QA |
| schema v1.2 push | **완료** — 2026-06-11 T1.1 세션에서 `prisma db push` 확인 결과 already in sync (Railway CLI `railway link` 후 DATABASE_PUBLIC_URL로 실행 — 로컬 .env는 placeholder 유지) | TDA/BE |
| R2 전환 | 대기 — 테오가 Cloudflare R2 버킷·API 토큰 발급 → Railway STORAGE_* 5종 입력 (코드 무변경) | 테오 직접 |

### 다음 세션 시작 시 할 일 (2026-06-11 T1.4 세션 종료 핸드오프)
**Sprint 1 잔여: T1.5(타임라인)·T1.6(iCal)·T1.7 FE(/settings)·T1.8(사용자). T1.6·T2.3/T2.4는 병행 세션 진행 중이었음(lib/ical.*, lib/hold.*, app/api/bookings·cron 미커밋) — 착수 전 git status로 충돌 확인 필수**

1. **T1.5** — ADMIN 타임라인 매트릭스 뷰 (b1 변환) (FE) — components/admin/sidebar.tsx·ResponsiveTable(T1.2 산출) 재사용
2. **T1.7(FE)** — /settings/seasons 시즌 달력 + 홀드 시간 + 환율(FX_VND_PER_KRW) 입력 UI (b8 변환) (FE) — lib/pricing.ts getFxVndPerKrw 연동
3. **T1.8** — ADMIN 사용자 목록 (b13 변환) (FE)
4. 프로덕션 Playwright 검증: T1.1 마법사 + T1.4 캘린더 E2E (SUPPLIER 테스트 계정 0900000001)
5. 재고 경합 쓰기 규칙: 같은 빌라 재고를 만지는 모든 트랜잭션은 첫 줄에 `lockVillaInventory(tx, villaId)` (availability-pattern.md 교훈 — T2.3 HOLD·T1.6 iCal upsert 필수)

**변환 공통 규칙 (docs/DESIGN.md 필독)**: Noto Sans KR 폴백 + word-break keep-all/nowrap을 globals.css 전역 강제, 사이드바 9메뉴 공통 컴포넌트, ADMIN VND 쉼표·공급자 VND 점, 마법사 단계는 ICU `Bước {n}/{total}` (N/5), T5.5 변환 시 처리 목록(TASKS.md) 확인

### 인프라 정보 (다음 세션 참조용)
| 항목 | 값 |
|---|---|
| 배포 URL | https://villa-pms-production.up.railway.app |
| GitHub | https://github.com/orangetaeo/villa-pms |
| DB | Railway PostgreSQL (내장) — `${{Postgres.DATABASE_URL}}` |
| Railway 프로젝트 | outstanding-vibrancy / production |
| 기술 스택 | Next.js 15, Prisma 6, NextAuth v5 beta, next-intl 3, Tailwind v3 |

### 알려진 기술 결정사항
- Tailwind CSS v3 사용 (v4는 Railway nixpacks 네이티브 바이너리 충돌로 제외)
- nixpacks.toml로 `npm install` 강제 (`npm ci` lockfile 불일치 우회)
- `prisma db push` 방식 사용 (migration 파일 없음 — 코드 안정화 후 migrate dev로 전환 예정)
- **헬스체크는 `/api/health` 전용** (railway.toml) — 루트 `/`는 role 리다이렉트(307)라 헬스체크 불가. 인증 등 리다이렉트 추가 시 헬스체크 경로 주의
- **NextAuth v5 Railway 필수 변수**: `NEXTAUTH_URL`=실제 서비스 도메인(villa-pms-production…, 프로젝트 도메인 아님!) + `AUTH_TRUST_HOST=true` (프록시 뒤 필수). 잘못되면 모든 리다이렉트가 엉뚱한 호스트로 가고 세션 판정 오작동
- 로컬 .env의 DATABASE_URL은 Railway Postgres `DATABASE_PUBLIC_URL`(thomas.proxy.rlwy.net) 사용 — `railway variables --service Postgres --json`으로 조회
- QA 테스트 계정: SUPPLIER `0900000001` (프로덕션 DB, 오픈 전 삭제 — LAUNCH.md 체크리스트에 추가 필요)

### 프로덕션 E2E 검증 (2026-06-11, 인증 배포 후)
/login·/signup 렌더링 200(Stitch 화면), 미인증 보호 경로 → /login 리다이렉트, 테스트 계정 실로그인 → 세션 쿠키 발급 → / → /my-villas role 분기, SUPPLIER의 /dashboard 접근 차단, 오비밀번호 로그인 거부 — 전부 통과
