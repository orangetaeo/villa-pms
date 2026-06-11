# CLAUDE.md — Villa PMS (푸꾸옥 빌라 임대 플랫폼)

## 프로젝트 개요

푸꾸옥 빌라 공급자(중계인·부동산·분양자, 베트남인)에게 무료 제공하는 빌라 관리 프로그램(PMS).
공급자가 빌라·공실 정보를 입력하면, 운영자(테오)가 비공개 재고를 한국 여행사·랜드사·여행객에게 판매한다.

**사업 핵심 원칙 (개발 시 절대 위반 금지):**
1. **재고 비공개** — 전체 공실 현황은 운영자(ADMIN)만 조회 가능. 공급자는 자기 빌라만, 외부인은 제안 링크로 받은 빌라만 볼 수 있다.
2. **마진 비공개** — 공급자는 자기 원가만 본다. 운영자 마진·판매가(KRW)는 공급자 화면에 절대 노출 금지.
3. **검수 게이트** — 청소 검수 승인 전에는 빌라가 판매가능(SELLABLE) 상태로 전환되지 않는다.
4. **베트남 사용자 우선 UX** — 공급자 화면은 베트남어 기본, 텍스트 입력 최소화, 사진 업로드 + 터치 중심. 모바일 우선.

## 기술 스택

- Next.js 15 (App Router) + TypeScript
- Prisma + PostgreSQL (Neon)
- Railway 배포, PWA (모바일 대응)
- 인증: NextAuth (Credentials) + Zalo 계정 연결(zaloUserId)
- 알림: Zalo 개인 계정(zca-js, QR 로그인) — Nike 방식 재사용, ADR-0005 (예약·홀드만료·청소요청·정산)
- 번역/OCR: Gemini API (KR↔VN 번역, 여권 OCR)
- 이미지 저장: Railway volume 또는 Cloudflare R2 (TBD — TASKS.md 참고)
- **디자인: Google Stitch** (stitch.withgoogle.com) — 모든 화면은 Stitch에서 먼저 생성, HTML/Tailwind export를 `design/stitch/`에 저장 후 Next.js 컴포넌트로 변환. 프롬프트와 변환 규칙은 `docs/DESIGN.md` 필독
- 다크 대시보드 (운영자), 라이트 단순 UI (공급자)

## 사용자 역할 (Role)

| Role | 사용자 | 언어 | 권한 |
|---|---|---|---|
| ADMIN | 테오 | ko | 전체 재고·예약·정산·검수 승인·요율 관리 |
| SUPPLIER | 중계인·부동산·분양자 | vi | 자기 빌라 등록·캘린더·원가 입력·청소 사진 업로드 |
| CLEANER | 청소 담당 (선택) | vi | 배정된 청소 태스크 + 사진 업로드만 |
| (비로그인) | 한국 여행사·여행객 | ko | 제안 링크 열람 + 가예약 클릭만 |

## MVP 기능 5개 (Phase 1)

1. **빌라 등록** — 공간별 사진 업로드 (외관/거실/주방/침실N/화장실N/베란다/수영장), 기본 정보, 조식 가능 여부
2. **캘린더** — 날짜 터치 토글(공실/차단), 예약 자동 반영, iCal 외부 채널 동기화(수신)
3. **예약·가예약** — 제안 링크 생성(빌라 2~3개, 유효기간), 24~48h 홀드, 입금 확정, 만료 자동 해제
4. **체크인·아웃 검수** — 여권 업로드, 동의서 서명, 보증금 기록, 사진 비교 검수, 청소 검수 게이트
5. **Zalo 알림** — 모든 상태 변경을 공급자 Zalo로 발송

Phase 2 (스키마에는 포함, UI는 나중): 시즌 요율 자동계산 고도화, 정산 페이지(다중 통화 + 환차), 품질점수, 부가서비스 판매(BBQ/입장권/가이드/차량/조식)

## 에이전트 팀 구성

| 에이전트 | 역할 |
|---|---|
| PM | 태스크 관리, TASKS.md/PROGRESS.md 갱신, 우선순위 |
| TDA | 기술 설계, 스키마 변경 승인, 마이그레이션 관리 |
| BE | API Routes, Prisma, 비즈니스 로직 (홀드 만료 cron, iCal 파서) |
| FE | 운영자 대시보드 (다크, ko) |
| UX-VN | 공급자 화면 (라이트, vi, 모바일 우선) — 베트남 사용자 단순성 책임 |
| INTEG | Zalo OA, Gemini(번역·OCR), iCal 연동 |
| QA | 테스트, 권한 누수 검사 (특히 마진·재고 노출 여부) |
| FIN | 환율·정산 로직 (Phase 2, 환전 시스템 LEDGER 패턴 재사용) |
| DESIGN | Stitch 디자인 생성·관리 (전 화면), 디자인 평가 4기준 1차 자가검토 — 코드 작성 안 함 |
| OPS | Railway 배포, 환경변수, cron 등록, PWA, 배포 전 보안 점검 |
| LOC | ko/vi 현지화 — next-intl 키 사전, 베트남어 감수, Zalo 문구·동의서·온보딩 가이드 |

## 하네스 시스템 (기존 프로젝트 표준과 동일)

### 핵심 문서 체계 (매 세션 확인)
| 문서 | 역할 | 갱신 주체 |
|---|---|---|
| CLAUDE.md | 프로젝트 규칙·아키텍처 (매 세션 자동 로드) | TDA 승인 시만 |
| PROGRESS.md | 작업 메모리 — 완료/진행/막힌 작업, 결정사항 | 매 작업 완료 시 PM |
| TASKS.md | 작업 큐 (스프린트·우선순위) | PM |
| COSTS.md | 토큰 비용·모델 분포 | FIN (세션 종료 시) |
| IDEAS.md | MVP 범위 밖 아이디어 — 구현 금지, 기록만 | 전원 |
| docs/decisions/ | ADR — 주요 기술 결정 기록 (0001부터 순번) | TDA |

### 작업 사이클 (Anthropic 엔지니어링 패턴 적용)
1. **Explore** — PM이 TASKS.md에서 태스크 선택, 담당 에이전트가 INDEX.md 경유로 관련 문서·코드만 탐색
2. **Contract** — 담당 에이전트가 스프린트 계약 초안(docs/contracts/<태스크>.md: 범위·테스트 가능한 완료 기준·검증 방법) 작성 → QA 합의. **합의 전 코딩 금지**
3. **Plan** — Plan 모드로 구현 계획 수립 (모호한 지시로 광범위 스캔 금지)
4. **Code** — 서브에이전트가 fresh context에서 구현, 결과 요약만 반환
5. **Evaluate** — QA(독립 평가자)가 Playwright로 실사용 검증 + 하드 임계치 채점. **작업자의 자기평가는 무효** — 작성자와 평가자는 반드시 분리
6. **Commit** — 통과 시 커밋 + PROGRESS.md 갱신 / 실패 시 구체적 결함 목록과 함께 재작업

### 컨텍스트 관리
- 평시: 80% 도달 전 `/compact` → PROGRESS.md 재로드
- 큰 작업 경계(스프린트 전환, 방향 전환): `/clear`로 **완전 리셋** + 핸드오프(PROGRESS.md의 현재 상태·다음 단계)로 새 출발 — compact보다 강력하며 "마무리 조급증(context anxiety)" 방지

### 서브에이전트 (.claude/agents/ — 11개)
pm, tda, be, fe, ux-vn, integ, qa, fin, design, ops, loc — 각 파일에 절대 규칙과 "완료 후 액션"(인계 규칙)이 정의되어 있음. 파이프라인: (UI 작업은 DESIGN 선행) → 코드 작업 → QA → PM 보고.

### 모델 라우팅 (비용 통제)
- Haiku: 파일 탐색·로그 파싱·단순 분류
- Sonnet: 코드 작성·수정 (전체의 ~80%)
- Opus: 아키텍처 결정·난해한 디버깅만 (~5-10%)

### 도서관 규칙 (컨텍스트 절약 — 필수)
모든 문서를 한 번에 읽지 않는다. 작업 시작 시 **docs/INDEX.md(도서관 목차)를 먼저 확인**하고, 현재 작업에 필요한 문서·스킬만 골라 읽는다. 새 문서를 만들면 반드시 INDEX.md에 등록한다.

### 스킬 체계 (.claude/skills/)
부서별 작업 패턴 문서: backend(api·availability·money), frontend(stitch-conversion), ux-vn, integ(zalo), qa(leak-checklist·evaluation-criteria), fin(settlement), design(stitch-design), ops(deployment), loc(i18n). 각 에이전트는 해당 스킬을 읽고 작업한다.
**스킬 축적 규칙**: QA가 버그를 발견하거나 교훈이 생기면 코드 수정과 함께 해당 스킬 파일의 "교훈 축적" 섹션에 패턴화하여 추가한다 (환전 프로젝트의 asset.name 교훈 방식). 스킬은 살아있는 문서다.

### 기존 프로젝트 재사용 (공유 모듈)
- 재사용 소스: Nike(Zalo OA·Gemini OCR·번역 파이프라인), 환전 시스템(LEDGER 정산·Web Push 알림), TravelDiary(Leaflet 지도·PWA 설정·이미지 업로드)
- 별도 레포 코드는 직접 읽을 수 없으므로 필요한 파일을 `reference/` 폴더에 복사해서 참조
- 복사·이식한 코드 상단에 `// [SHARED-MODULE] from <프로젝트> v1.x` 주석 표기 — 원본 수정 시 동기화 대상 식별용
- 중기: 프로젝트 안정화 후 Turborepo 모노레포 통합 검토 (IDEAS.md)

## 컨벤션

- 커밋: `feat:`, `fix:`, `chore:` + 한국어 설명. Co-authored-by Claude 에이전트명 표기
- 금액: VND는 `BigInt`(동 단위), KRW는 `Int`(원 단위). 부동소수점 금지
- 날짜: 숙박일은 `DateTime` @db.Date (시간 없음), 타임스탬프는 UTC 저장 + Asia/Ho_Chi_Minh 표시
- i18n: `next-intl`, 키 기반. 공급자 라우트 기본 vi, 운영자 라우트 기본 ko
- 모든 사진 업로드는 타임스탬프 + 업로더 기록 (증빙 목적, 수정 불가)
- API 권한: 모든 route handler 첫 줄에서 role 검사. SUPPLIER는 `supplierId` 스코프 강제

## 주요 명령어

```bash
npm run dev          # 개발 서버
npx prisma migrate dev --name <이름>
npx prisma studio
npm run lint && npm run typecheck
```

## 환경 변수 (.env)

```
DATABASE_URL=          # Neon PostgreSQL
NEXTAUTH_SECRET=
ZALO_CREDS_KEY=        # zca-js credential 암호화 키 (DB에 AES-256-GCM 저장, ADR-0005)
GEMINI_API_KEY=
STORAGE_*=             # 이미지 저장소 (TBD)
CRON_SECRET=           # 홀드 만료 처리용
```

## 파일 구조

```
app/
  (admin)/         # 운영자 대시보드 (ko, 다크)
    dashboard/ villas/ bookings/ proposals/ inspections/ settlements/
  (supplier)/      # 공급자 화면 (vi, 라이트, 모바일)
    my-villas/ calendar/ cleaning/
  p/[token]/       # 공개 제안 링크 (비로그인, ko)
  api/
lib/               # zalo.ts gemini.ts ical.ts pricing.ts hold.ts availability.ts
design/stitch/     # Stitch export HTML (화면별 폴더) — 구현 시 참조
.claude/agents/    # 서브에이전트 11개 (pm tda be fe ux-vn integ qa fin design ops loc)
.claude/skills/    # 부서별 작업 패턴 + 교훈 축적 (살아있는 문서)
reference/         # 기존 프로젝트 코드 발췌 ([SHARED-MODULE] 주석)
prisma/schema.prisma
docs/INDEX.md      # 도서관 목차 — 작업 시작 시 최우선 확인
docs/SPEC.md       # 기능 상세 명세 (필독)
docs/DESIGN.md     # Stitch 프롬프트 + 변환 규칙 (필독)
docs/decisions/    # ADR
COSTS.md  IDEAS.md  PROGRESS.md  TASKS.md
```

## 작업 규칙

1. 작업 시작 전 `docs/SPEC.md`와 `TASKS.md` 확인
2. 스키마 변경은 TDA 검토 후 마이그레이션
3. 완료 시 PROGRESS.md 갱신
4. 공급자 화면 작업 시 항상 자문: "베트남 중계인이 설명 없이 쓸 수 있는가?"

## 병렬 세션 규칙 (여러 Claude 세션 동시 작업 시 — 필수)

여러 세션이 같은 작업 폴더를 공유하므로, 아래 규칙 위반 시 다른 세션의 미완성 작업이 파손된다.

1. **커밋은 자기 계약서 범위 파일만 명시적으로 add** — `git add -A` / `git add .` 절대 금지. git status에 모르는 파일이 있으면 다른 세션의 진행 중 작업이므로 건드리지 않는다
2. **계약서에 "수정 금지 구역" 선언** — 다른 세션이 작업 중인 파일·디렉터리를 docs/contracts/<태스크>.md에 명시하고 절대 수정하지 않는다
3. **공유 파일은 추가만 + 빠른 커밋** — `messages/ko.json`·`vi.json`(키 추가만), `app/globals.css`(규칙 추가만), `package.json`(원칙적 동결, 필요 시 계약서에 선언). 작업 완료 즉시 커밋해서 겹침 시간 최소화
4. **PROGRESS.md/TASKS.md는 커밋 직전에 한 번만 갱신** — 자기 태스크 행만 수정
5. **dev 서버는 한 세션만 실행** — 포트·Prisma 엔진 파일 잠금 충돌 방지. `prisma generate` EPERM 발생 시 다른 세션의 dev 서버가 원인
6. **schema 변경·`prisma db push`는 한 세션 전담** (TDA 담당 세션). 다른 세션은 push 완료 확인 후 새 모델 사용
7. **파괴적 git 명령 금지** — `git checkout .`, `git reset --hard`, `git stash` 등은 다른 세션 작업까지 날린다. 절대 실행하지 않는다
8. **태스크 선점은 계약서 즉시 커밋으로 선언** — 태스크 착수 결정 즉시 `docs/contracts/<태스크>.md`를 **단독 커밋+푸시**한다(`chore: <태스크> 착수 선점`). 착수 전에는 반드시 ① `git pull` ② `git status`(untracked 계약서 포함) ③ `docs/contracts/` 목록 순으로 확인하고, **계약서가 이미 존재하는 태스크는 즉시 회피**한다. 동시 선점은 push 거부로 드러나므로, 푸시가 거부되면 pull 후 선점 여부를 재확인하고 늦은 쪽이 양보한다
