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
| API·로직 패턴 | .claude/skills/backend/ 해당 패턴 |
| 베트남어 화면 | .claude/skills/ux-vn/vn-ux-principles.md |
| Zalo·Gemini | .claude/skills/integ/zalo-pattern.md |
| iCal 동기화 | .claude/skills/integ/ical-pattern.md + lib/ical.ts |
| 코드 검토 | .claude/skills/qa/leak-checklist.md + evaluation-criteria.md |
| 태스크 착수 전 | docs/contracts/ 스프린트 계약 작성·합의 |
| 정산·환율 | .claude/skills/fin/settlement-pattern.md |
| 디자인 생성 (Stitch) | docs/DESIGN.md + .claude/skills/design/stitch-design.md |
| 배포·환경변수·cron | .claude/skills/ops/deployment-pattern.md |
| 이미지 업로드·저장소 | docs/decisions/0004-image-storage.md + lib/storage.ts·lib/image-resize.ts |
| Zalo 알림 방식(zca-js) | docs/decisions/ADR-0005-zalo-zca-js.md + reference/nike/ zalo 코드 |
| 빌라별 시즌·가격 판정 | docs/decisions/0008-per-villa-season-periods.md + lib/pricing.ts(resolveSeason·quoteStayForVilla) |
| 번역·i18n 키·문구 | .claude/skills/loc/i18n-pattern.md |

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
