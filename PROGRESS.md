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

## 현재 상태 (2026-06-11 기준)

### 완료된 태스크
| 태스크 | 내용 |
|---|---|
| T0.1 | Next.js 15 + TypeScript + Prisma + next-intl + NextAuth v5 초기화 |
| T0.2 | schema.prisma → Railway PostgreSQL prisma db push 완료 |
| T0.6 | Railway 배포 완료 (nixpacks, Node 20, Tailwind v3) |
| T1.0~T4.0 | Stitch 디자인 28장 생성 + QA 통과 (design/stitch/ 저장) |
| T5.1~T5.3 | 디자인 결함 수정 + LOC 용어 사전 확정 |

### 진행 중 / 대기 중
| 태스크 | 상태 | 담당 |
|---|---|---|
| T5.4 | Stitch 중복 화면 3건 수동 삭제 대기 (테오) | 테오 직접 |
| 디자인 추가 작업 | **완료** — 2차 전체 회의(테오 7건) 처리: 낙하 수정+신규 3장+수정 9장, 총 33장, QA 통과 (위 이력 참조) | DESIGN/QA |
| schema v1.2 push | 대기 — 통화·VillaAmenity·ZaloConversation/Message 모델 추가분 `prisma db push` 재실행 필요 | TDA/BE |

### 다음 세션 시작 시 할 일 (2026-06-11 세션 종료 핸드오프)
**전제: T0.3(로그인·인증·라우트 그룹·미들웨어)은 다른 세션이 개발 중 — 충돌 금지 구역: `app/(auth)/`, `auth.ts`, `middleware.ts`, `lib/`(인증 관련), `messages/ko.json·vi.json`(키 추가는 가능하나 구조 변경 금지), `tailwind.config.ts`, `package.json`**

1. **schema v1.2 push** — `npx prisma db push` 재실행 (통화·VillaAmenity·ZaloConversation/Message 추가분 — additive라 안전) (TDA/BE)
2. **T1.1** — SUPPLIER 빌라 등록 마법사 5단계: design/stitch/ a2(기본정보)→a2b(위치)→a1(사진)→a9(비품)→a5(원가) 변환, `app/(supplier)/my-villas/new` (UX-VN) — 로그인과 겹치지 않는 첫 페이지 작업으로 지정
3. **T1.2** — ADMIN 빌라 목록·승인·요율: b9·b10 변환 (FE)
4. **T0.4** — 이미지 저장소: Cloudflare R2 업로드 파이프라인 (INTEG) — T1.1 사진 단계의 의존성

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
