# INDEX.md — 문서 도서관 목차

> **도서관 규칙**: 모든 문서를 한 번에 읽지 않는다. 이 목차에서 지금 작업에 필요한 문서만 골라 읽는다 (컨텍스트 절약). 에이전트는 작업 시작 시 이 목차를 먼저 확인한다.

## 1열람실 — 항상 로드 (자동)
| 문서 | 내용 |
|---|---|
| CLAUDE.md | 사업 4대 원칙, 스택, 하네스, 컨벤션 |

## 2열람실 — 작업 유형별 필독
| 작업 유형 | 읽을 문서 |
|---|---|
| 기능 구현 전체 | docs/SPEC.md (해당 F# 섹션만) |
| UI 화면 작업 | docs/DESIGN.md + design/stitch/해당화면 |
| 스키마·아키텍처 | prisma/schema.prisma + docs/decisions/ 최신 ADR |
| 작업 시작·종료 | TASKS.md, PROGRESS.md |
| 오픈 기준·KPI·개선 루프 | docs/LAUNCH.md |
| 오픈까지 남은 일·테오님 액션 대기 | docs/BACKLOG-WAITING.md — 외부/테오님 대기 항목 통합 트래커(A 차단요인·B Zalo실연결·C 실행대기·D 타세션영역·E 자원·F Phase2). 상태 요약, 진실원천은 TASKS·LAUNCH |
| API·로직 패턴 | .claude/skills/backend/ 해당 패턴 |
| 베트남어 화면 | .claude/skills/ux-vn/vn-ux-principles.md |
| Zalo·Gemini | .claude/skills/integ/zalo-pattern.md |
| 알림 문구·수신자·트리거 전체(검토·수정 시) | docs/NOTIFICATIONS.md — 전 알림 내역서(ID 부여, 테오 검토용). 알림 추가·문구 수정 시 이 문서도 동시 갱신 |
| iCal 동기화 | .claude/skills/integ/ical-pattern.md + lib/ical.ts |
| 코드 검토 | .claude/skills/qa/leak-checklist.md + evaluation-criteria.md |
| 코치마크 튜토리얼(온보딩 투어) — 추가·화면변경 시 동기화 | components/tour/tour-definitions.ts(단일 소스) + docs/contracts/T-tutorial-onboarding.md — data-tour 앵커 화면 UI 변경 시 스텝·messages tour NS(ko/vi) 동시 갱신, tests/tour-onboarding.test.ts가 앵커 실존·패리티 강제 |
| 실사용 테스트(전산 초보 관찰) — 테오가 사용자 만날 때 | docs/usability-test-checklist.md — 역할별 과제 시나리오·개입 금지 규칙·기록 표·판정 기준. 결과를 세션에 붙여넣으면 개선 태스크化 |
| 태스크 착수 전 | docs/contracts/ 스프린트 계약 작성·합의 |
| 병렬 세션(여러 Claude 동시) | docs/parallel-worktree.md — scripts/wt-new·wt-finish.ps1 격리 워크플로(폴더·인덱스·포트 분리) |
| 정산·환율 | .claude/skills/fin/settlement-pattern.md |
| 디자인 생성 (Stitch) | docs/DESIGN.md + .claude/skills/design/stitch-design.md |
| 배포·환경변수·cron | .claude/skills/ops/deployment-pattern.md |
| ★보안 잔여 마스터 핸드오프(에픽 종료 후 OPS/인프라/제품 트랙) | docs/ops/security-handoff.md |
| Cron 등록 런북(8개 등록·검증 완료) | docs/ops/cron-registration.md |
| DB 자동 백업(R2 논리 스냅샷)·복원 런북 | docs/ops/db-backup.md — 왜 pg_dump 아닌 JSON 스냅샷(서버 PG18 vs 로컬 17)·프라이빗 버킷 준비(BACKUP_BUCKET_NAME)·보존(daily 14/monthly 12)·복원 절차·검증. cron `0 20 * * *`. `lib/db-snapshot.ts`·`app/api/cron/db-backup`·`scripts/restore-from-snapshot.ts` |
| 시크릿 스캔 결과(P0-4, 노출 0건) | docs/ops/secret-scan-2026-06-28.md |
| 시크릿 교체 런북(런칭 전·유출 시, 순서 제약) | docs/ops/secret-rotation-runbook.md |
| 인시던트 대응 절차서(P3-S4, 탐지·격리·통지·시나리오 플레이북) | docs/ops/incident-response.md |
| ★보안 강화 에픽(정본 계획서) | docs/SECURITY-HARDENING-PLAN-2026-06-27.md — 보안 전수점검(5영역 병렬감사 + 인젝션·외부공격 심층) 결과를 에픽화. CRITICAL 0·HIGH 8, P0~P3 ~29건, 구조신설 4종(SecurityEvent·중앙 가드헬퍼·rate-limit 추상화·회귀테스트 CI게이트). T-sec-* 계약서·ADR-0029·시크릿 런북이 이 문서를 참조. OWASP Top10 + LLM Top10 대조 매트릭스 |
| 이미지 업로드·저장소 | docs/decisions/0004-image-storage.md + lib/storage.ts·lib/image-resize.ts |
| Zalo 알림 방식(zca-js) | docs/decisions/ADR-0005-zalo-zca-js.md + reference/nike/ zalo 코드 |
| Zalo 리스너 전용 워커 분리(배포 블랙아웃 제거) **[제안·설계확정]** | docs/decisions/ADR-0032-zalo-listener-worker-split.md — zca-js 세션을 웹에서 떼어 Railway `zalo-worker`(long-running, replica=1, 유일 세션 보유자)로 이전. 인바운드 신호=Postgres LISTEN/NOTIFY→realtime-bus 재emit(Redis 불필요, 스키마 무변경), 아웃바운드=워커 내부 발송 API 위임(ext/send 패턴 재사용), Nike 공개 ext/send는 웹 유지(→워커 포워딩). **밴 위험 마이그레이션: 세션 보유자 항상 ≤1 — 옛 보유자 내림 확인 후 새 보유자 접속**(플래그 `ZALO_SESSION_LOCAL`/`ZALO_WORKER_CONNECT`). 태스크 BE-1~9·OPS-1~3. ADR-0010 C안 진화경로 실행 |
| Nike↔villa Zalo 세션·채팅 공유(테오 계정) **[채택·풀스펙]** | docs/decisions/ADR-0010-nike-villa-zalo-session-chat-share.md — A안 확정(villa 허브·SPOF 수용), Nike 실사 완료, 모델 대조표·WBS·배포순서·ETL. **풀스펙 확정(R10/R12/R13 해소)**: 그룹채팅 포함(스키마 D: threadType·groupMembers·senderUid, S4 마이그레이션)·과거 첨부 R2 재업로드 영구보존·forward/alias/음성STT 동등구현(STT=lib/gemini.ts 재사용). 스프린트 S1~S5. **S1 계약: docs/contracts/zalo-integration-s1.md / S2 계약: docs/contracts/zalo-integration-s2.md(읽기 정본 전환 A2·A3·A4 + webhook→SSE B3·B4, villa→Nike HMAC) / S3 계약: docs/contracts/zalo-integration-s3.md(과거 대화·첨부 ETL C1·C2, 1:1 USER 한정, 멱등 zaloMsgId·quote 2-pass·첨부 R2 키 nike-attach/{zaloMsgId}/{index}) / S5 계약: docs/contracts/zalo-integration-s5.md(forward·alias·음성STT 동등 A6·B5, 스키마 무변경 — forward=zca-js forwardMessage 텍스트전달+ext kind:FORWARD, alias=기존 nickname·SET_NICKNAME 읽기단방향, STT=lib/gemini.ts transcribeVoice→translatedText)** |
| 빌라 판매용 정보(잠자리·위치·이용규칙·셀링포인트) **[채택]** | docs/decisions/ADR-0011-villa-sales-fields.md + docs/villa-sales-data-design.md(정본) — Villa 스칼라 13·VillaBedroom·VillaFeature·lib/features.ts·lib/bedding.ts. ⚠ wifiPassword·wifiSsid는 /p 공개페이지 select 제외(체크인 전용) |
| 빌라별 시즌·가격 판정 | docs/decisions/0008-per-villa-season-periods.md + lib/pricing.ts(resolveSeason·quoteStayForVilla) |
| 기간별 요금(다기간 요율) **[제안]** | docs/decisions/ADR-0014-villa-rate-periods.md — VillaRatePeriod(기본요금+웃돈기간), dual-read 폴백, lib/pricing.ts(resolveRatePeriod 신설 예정). 구현 별도 스프린트 |
| 번역·i18n 키·문구 | .claude/skills/loc/i18n-pattern.md |
| ADMIN 강제 판매가능(검수 게이트 오버라이드) **[채택]** | docs/decisions/ADR-0012-admin-force-sellable.md + lib/villa-gate.ts(forceOpenSellableGate, ACTIVE만·멱등·CHECKOUT 보존·전량 감사) — POST /api/villas/[id]/force-sellable, lib/cleaning.ts 불변 |
| 게스트 셀프 체크인·부가서비스 판매·미니바 실재고 **[제안]** | docs/decisions/ADR-0019-guest-checkin-and-addon-sales.md + docs/contracts/T-guest-checkin-and-inventory.md + SPEC F8/F9 — 미니바=실재고(onHandQty·입고원가→costVnd·부족경보), 서비스=주문형 카탈로그(ServiceCatalogItem·MOTORBIKE_RENTAL·옵션), 게스트 `/g/[token]`(QR·동의서서명·옵션요청), 체크아웃 통합정산(현금/이체). 누수0 화이트리스트 |
| 부가서비스 원천 공급자 중계(과일 바구니·도시락) **[채택·S1 진행]** | docs/decisions/ADR-0023-addon-source-vendor-brokerage.md + docs/contracts/T-addon-source-vendor.md + SPEC F11 — 신규 `ServiceVendor`(Role=VENDOR·로그인 `/vendor` 대시보드)·카탈로그 `vendorId`+`audiences`(과일바구니=PARTNER만/도시락=PARTNER+GUEST)·발주 2단계 게이트(Zalo 발주→공급자 가부→운영자 확정)·건별 정산·공급자 통계. 누수: 공급자에 우리 판매가·마진·타발주 비노출 |
| 업체 담당 지역 커버리지·지역 자동 지정 **[채택]** | docs/decisions/ADR-0038-vendor-region-coverage.md — ServiceVendorRegion(업체×타입×지역=Villa.complex), 해석 3단계(빌라 수동지정 > 지역 매칭 1곳 자동 > 카탈로그 기본). ADR-0037 확장. lib/regional-vendor.ts·PUT /api/vendors/[id]/regions |
| 지역(단지) 마스터 ComplexArea **[채택]** | docs/decisions/ADR-0046-complex-area-master.md + docs/contracts/T-complex-area-master.md — 단지 단일 원천(name=라틴 정본·nameKo=운영자 병기·매칭 금지). Villa.complexAreaId additive FK, Villa.complex=마스터 name 비정규화 캐시(표시 소비처 하위호환). 시드 scripts/seed-complex-areas.ts(멱등). rename=서버 트랜잭션 일괄 rewrite 단일 경로. CRUD API=writeAuditLog 필수(FE) |
| 운영자 Zalo 알림 그룹방 발송 **[채택]** | docs/decisions/ADR-0040-zalo-admin-group-notify.md + docs/contracts/zalo-admin-group-notify.md — 운영자 A 시리즈 알림을 개별 DM→그룹방 1건(설정 시). Notification.groupThreadId(additive)·lib/operator-notify(enqueueOperatorNotification·GROUP_ROUTED_TYPES 화이트리스트·3중 게이트)·dispatchGroupOne(NO_ZALO_LINK 미적용). 미설정=개별 DM 폴백. SECURITY_ALERT·ZALO_LISTENER_DOWN 제외. 설정 UI /settings + AppSetting ZALO_ADMIN_NOTIFY_GROUP_ID |
| 프리미엄일(요일·공휴일) 2단 요금 **[채택·구현중]** | docs/decisions/ADR-0042-premium-day-pricing.md + docs/contracts/premium-day-pricing.md — 박별 판정(getUTCDay∈Villa.premiumDays ∨ 날짜∈HolidayDate 전역), VillaRatePeriod.premium* 6컬럼(nullable, 컬럼 단위 평일 폴백=무중단), 프리미엄 마진 컬럼 없음(같은 행 margin*으로 UI 제안 파생). premiumSalePrice*/premiumConsumer* 누수 금지 |
| 게스트 여권 사진 Zalo 전달(임시거주신고 tạm trú) **[승인·구현완료]** | docs/decisions/ADR-0029-passport-zalo-forward.md + docs/contracts/img-compress-coverage.md — Phase 2 여권 사진면 1장 실발송(zca-js Buffer 직접, 공개URL 미경유). 수신=SUPPLIER만, 미동의 시 체크인 차단 게이트(lib/checkin.ts), 전달 SecurityEvent(PII_FORWARD)+AuditLog, 미연결 시 Buffer 읽기 전 short-circuit. 동의서 c8 조항 5언어+VERSION. 이미지 압축 사각지대 3곳+여권 HEIC 폴백(증빙 2400/0.90, isUnprocessableEvidenceBlob). QA PASS·누수0 |
| 운영자 권한 3단계(OWNER/MANAGER/STAFF) **[채택·S-RBAC-1 진행]** | docs/decisions/ADR-0013-operator-rbac-tiers.md + docs/contracts/S-RBAC-1.md — ADMIN→OWNER. 돈 경계 {OWNER,MANAGER} vs STAFF(§6.1 입금확인 금액숨김), OWNER↔MANAGER=시스템통제, 카뱅 알림파싱 Phase 2(§6.2). 핵심=lib/permissions.ts capability 헬퍼. additive 전략(ADMIN 유지→S-RBAC-2서 치환·제거) |
| 여행사·랜드사(B2B) 결제조건·미수(여신) 관리 **[제안·PARTNER-1 구현]** | docs/decisions/ADR-0022-partner-receivables-credit.md + docs/contracts/PARTNER-1.md — 돈흐름 2분리(B2B 객실료=Partner AR / B2C 보증금·미니바=게스트 현장). 등급제(A선불 의무·B 주15/30일여신·C특별), 신규=A의무·선금30%·Phase1 ADMIN전담·보증예치금 미도입. 신규모델 Partner·PartnerReceivable·PartnerInvoice(raw ALTER), LEDGER 현금주의 유지(ADR-0018 정합), **lib/partner.ts**(computeDepositDue·computeDueDate·outstandingForPartner·canCreateBookingFor·agingBuckets) 신용한도 게이트. 스프린트 PARTNER-1~3, 화면 /partners·/receivables·청구서 |

| 웹챗 게스트 링크 전달(세션↔예약 연결+원클릭 발송+제안 발송) **[배포완료 PR #340+#344]** | docs/plans/webchat-guest-link-share.md + docs/contracts/T-webchat-guest-link-share.md + T-webchat-proposal-link-send.md — WebChatSession.bookingId additive·자동 후보(sourcePage g:토큰8자 매칭)·빠른 링크 3종(체크인/부가서비스/영수증, 5언어 사전 템플릿=Gemini 미경유)·**제안(/p) 발송(#344)**=예약 미연결 세션 가능·간이 생성 체이닝·생성=canSetPrice 이원화·핵심 위험=오발송(확인 다이얼로그+revoke 동선+AuditLog) |

## 3열람실 — 참고 서가 (필요 시만)
| 문서 | 내용 |
|---|---|
| docs/marketing/youtube-shorts-plan.md | 유튜브 쇼츠 기획 v1 (2026-07-16) — 빌라 정보 숏츠(릴스 재사용)+직접 촬영 자동 편집+YouTube API 자동 업로드. ★감사(audit) 전 업로드=강제 비공개·쇼츠 링크 클릭 불가 |
| docs/business/contracts/ | ★사업 계약서(법무) 체계 — 00 프레임워크(돈 흐름·유리 조항 7종·법률 플래그 6건·서명 운영) + 초안 3종: 01 빌라 공급(체크인 전일 지급·back-to-back 취소) / 02 랜드사 B2B(선금 30%+D-14 완납·미납 자동취소, ADR-0022 정합) / 03 부가서비스 벤더(이행 완료 후 일/주/월 정산·티켓 특약). 상태=테오 검토 대기, 서명 전 계약 주체 확정+변호사 검토 필수. ADMIN 열람=/documents |
| docs/marketing/instagram-marketing-plan.md | 인스타그램 마케팅 기획 v1 (2026-07-16) — 한국인 대상 일 3건 자동 포스팅·Graph API 발행 파이프라인·DM 인박스·카카오 유도. 착수 전 필독 |
| docs/marketing/instagram-account-setup.md | 테오(비개발자)용 IG 계정·API 셋업 가이드 (2026-07-16) — 계정 생성→비즈니스 전환(서류X)→Meta Business앱→"API setup with Instagram login" 계정 연결→60일 토큰 발급/전달→2주 워밍업→보안. ★App Review·Business Verification 배제(자기계정+개발모드) |
| COSTS.md | 토큰 비용 기록 (FIN) |
| IDEAS.md | 범위 밖 아이디어 |
| reference/ | 기존 프로젝트(Nike·환전·TravelDiary) 코드 발췌 — [SHARED-MODULE] 주석 확인 |
| 사업계획서 V1.0 (외부) | 비즈니스 배경 전체 |

## 서가 관리 규칙
- 새 문서 추가 시 반드시 이 목차에 등록
- 문서가 길어지면 분권하고 목차 갱신 (1문서 = 1주제)
- 버그 교훈은 본문이 아니라 해당 skills 파일에 축적
