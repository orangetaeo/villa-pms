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
| iCal 동기화 | .claude/skills/integ/ical-pattern.md + lib/ical.ts |
| 코드 검토 | .claude/skills/qa/leak-checklist.md + evaluation-criteria.md |
| 태스크 착수 전 | docs/contracts/ 스프린트 계약 작성·합의 |
| 병렬 세션(여러 Claude 동시) | docs/parallel-worktree.md — scripts/wt-new·wt-finish.ps1 격리 워크플로(폴더·인덱스·포트 분리) |
| 정산·환율 | .claude/skills/fin/settlement-pattern.md |
| 디자인 생성 (Stitch) | docs/DESIGN.md + .claude/skills/design/stitch-design.md |
| 배포·환경변수·cron | .claude/skills/ops/deployment-pattern.md |
| Cron 등록 런북(미등록 4개 복붙값) | docs/ops/cron-registration.md |
| 이미지 업로드·저장소 | docs/decisions/0004-image-storage.md + lib/storage.ts·lib/image-resize.ts |
| Zalo 알림 방식(zca-js) | docs/decisions/ADR-0005-zalo-zca-js.md + reference/nike/ zalo 코드 |
| Nike↔villa Zalo 세션·채팅 공유(테오 계정) **[채택·풀스펙]** | docs/decisions/ADR-0010-nike-villa-zalo-session-chat-share.md — A안 확정(villa 허브·SPOF 수용), Nike 실사 완료, 모델 대조표·WBS·배포순서·ETL. **풀스펙 확정(R10/R12/R13 해소)**: 그룹채팅 포함(스키마 D: threadType·groupMembers·senderUid, S4 마이그레이션)·과거 첨부 R2 재업로드 영구보존·forward/alias/음성STT 동등구현(STT=lib/gemini.ts 재사용). 스프린트 S1~S5. **S1 계약: docs/contracts/zalo-integration-s1.md / S2 계약: docs/contracts/zalo-integration-s2.md(읽기 정본 전환 A2·A3·A4 + webhook→SSE B3·B4, villa→Nike HMAC) / S3 계약: docs/contracts/zalo-integration-s3.md(과거 대화·첨부 ETL C1·C2, 1:1 USER 한정, 멱등 zaloMsgId·quote 2-pass·첨부 R2 키 nike-attach/{zaloMsgId}/{index}) / S5 계약: docs/contracts/zalo-integration-s5.md(forward·alias·음성STT 동등 A6·B5, 스키마 무변경 — forward=zca-js forwardMessage 텍스트전달+ext kind:FORWARD, alias=기존 nickname·SET_NICKNAME 읽기단방향, STT=lib/gemini.ts transcribeVoice→translatedText)** |
| 빌라 판매용 정보(잠자리·위치·이용규칙·셀링포인트) **[채택]** | docs/decisions/ADR-0011-villa-sales-fields.md + docs/villa-sales-data-design.md(정본) — Villa 스칼라 13·VillaBedroom·VillaFeature·lib/features.ts·lib/bedding.ts. ⚠ wifiPassword·wifiSsid는 /p 공개페이지 select 제외(체크인 전용) |
| 빌라별 시즌·가격 판정 | docs/decisions/0008-per-villa-season-periods.md + lib/pricing.ts(resolveSeason·quoteStayForVilla) |
| 기간별 요금(다기간 요율) **[제안]** | docs/decisions/ADR-0014-villa-rate-periods.md — VillaRatePeriod(기본요금+웃돈기간), dual-read 폴백, lib/pricing.ts(resolveRatePeriod 신설 예정). 구현 별도 스프린트 |
| 번역·i18n 키·문구 | .claude/skills/loc/i18n-pattern.md |
| ADMIN 강제 판매가능(검수 게이트 오버라이드) **[채택]** | docs/decisions/ADR-0012-admin-force-sellable.md + lib/villa-gate.ts(forceOpenSellableGate, ACTIVE만·멱등·CHECKOUT 보존·전량 감사) — POST /api/villas/[id]/force-sellable, lib/cleaning.ts 불변 |
| 게스트 셀프 체크인·부가서비스 판매·미니바 실재고 **[제안]** | docs/decisions/ADR-0019-guest-checkin-and-addon-sales.md + docs/contracts/T-guest-checkin-and-inventory.md + SPEC F8/F9 — 미니바=실재고(onHandQty·입고원가→costVnd·부족경보), 서비스=주문형 카탈로그(ServiceCatalogItem·MOTORBIKE_RENTAL·옵션), 게스트 `/g/[token]`(QR·동의서서명·옵션요청), 체크아웃 통합정산(현금/이체). 누수0 화이트리스트 |
| 부가서비스 원천 공급자 중계(과일 바구니·도시락) **[채택·S1 진행]** | docs/decisions/ADR-0023-addon-source-vendor-brokerage.md + docs/contracts/T-addon-source-vendor.md + SPEC F11 — 신규 `ServiceVendor`(Role=VENDOR·로그인 `/vendor` 대시보드)·카탈로그 `vendorId`+`audiences`(과일바구니=PARTNER만/도시락=PARTNER+GUEST)·발주 2단계 게이트(Zalo 발주→공급자 가부→운영자 확정)·건별 정산·공급자 통계. 누수: 공급자에 우리 판매가·마진·타발주 비노출 |
| 운영자 권한 3단계(OWNER/MANAGER/STAFF) **[채택·S-RBAC-1 진행]** | docs/decisions/ADR-0013-operator-rbac-tiers.md + docs/contracts/S-RBAC-1.md — ADMIN→OWNER. 돈 경계 {OWNER,MANAGER} vs STAFF(§6.1 입금확인 금액숨김), OWNER↔MANAGER=시스템통제, 카뱅 알림파싱 Phase 2(§6.2). 핵심=lib/permissions.ts capability 헬퍼. additive 전략(ADMIN 유지→S-RBAC-2서 치환·제거) |
| 여행사·랜드사(B2B) 결제조건·미수(여신) 관리 **[제안·PARTNER-1 구현]** | docs/decisions/ADR-0022-partner-receivables-credit.md + docs/contracts/PARTNER-1.md — 돈흐름 2분리(B2B 객실료=Partner AR / B2C 보증금·미니바=게스트 현장). 등급제(A선불 의무·B 주15/30일여신·C특별), 신규=A의무·선금30%·Phase1 ADMIN전담·보증예치금 미도입. 신규모델 Partner·PartnerReceivable·PartnerInvoice(raw ALTER), LEDGER 현금주의 유지(ADR-0018 정합), **lib/partner.ts**(computeDepositDue·computeDueDate·outstandingForPartner·canCreateBookingFor·agingBuckets) 신용한도 게이트. 스프린트 PARTNER-1~3, 화면 /partners·/receivables·청구서 |

## 3열람실 — 참고 서가 (필요 시만)
| 문서 | 내용 |
|---|---|
| COSTS.md | 토큰 비용 기록 (FIN) |
| IDEAS.md | 범위 밖 아이디어 |
| reference/ | 기존 프로젝트(Nike·환전·TravelDiary) 코드 발췌 — [SHARED-MODULE] 주석 확인 |
| 사업계획서 V1.0 (외부) | 비즈니스 배경 전체 |

## 서가 관리 규칙
- 새 문서 추가 시 반드시 이 목차에 등록
- 문서가 길어지면 분권하고 목차 갱신 (1문서 = 1주제)
- 버그 교훈은 본문이 아니라 해당 skills 파일에 축적
