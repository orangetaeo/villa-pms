# T-tutorial-onboarding — 역할별 튜토리얼(코치마크 온보딩) 1단계: 공통 인프라 + SUPPLIER/CLEANER

- 상태: 착수 (2026-07-09, worktree `worktree-tutorial-onboarding`)
- 배경: 실데이터 전환 직후 신규 사용자(베트남 공급자·청소직원) 유입 시점. 설명 없이 쓸 수 있어야 한다는 UX 원칙을 화면 위 코치마크로 보강. 테오 합의 완료(메모리 `tutorial-onboarding-plan`).
- 우선순위 합의: **1단계 SUPPLIER+CLEANER(이 계약)** → 2단계 PARTNER+VENDOR → 3단계 ADMIN.

## 범위 (이 계약)

### 1. 공통 코치마크 인프라 (외부 라이브러리 추가 없음 — package.json 동결 준수)
- `components/tour/coach-mark.tsx` (client): 오버레이 + 대상 요소 하이라이트(구멍) + 말풍선 + 다음/이전/건너뛰기. 모바일 우선(390px).
- `components/tour/tour-definitions.ts` (순수 모듈 — RSC spread 함정 회피): 화면별 투어 정의. 스텝 = `{ anchor: data-tour id, titleKey, descKey }`.
- **앵커 연결 = `data-tour="..."` 속성** (위치·순서 기반 금지 — UI 변경 내성).
- **안전장치: 앵커가 화면에 없으면 해당 스텝 자동 스킵**, 전 스텝 부재 시 투어 자체 미표시(깨진 화면 금지).
- 완료 저장 = `localStorage` (`villa-tour:<tourId>` 키, 디바이스 단위). **스키마 변경 없음** → 라이브 DB ALTER·TDA 불필요. 새 기기·브라우저 초기화 시 재노출은 허용(오히려 이득).
- 재보기 진입점: 투어 적용 화면 우측에 "?" 도움 버튼(해당 화면 투어 재생) + 공급자 `/guide` 페이지에 "화면 안내 다시 보기" 연결.

### 2. SUPPLIER 투어 (vi 기본, ko 병행)
- `/my-villas`: 빌라 등록 버튼 → 빌라 카드(상태 배지) → 하단 탭바.
- `/calendar`: 빌라 선택 → 날짜 터치 토글(공실/차단) → 범례.
- `/cleaning`: 태스크 목록 → 사진 제출 진입.

### 3. CLEANER 투어 (vi 고정)
- `/cleaning` 목록: 배정 태스크 카드 → 예정일.
- `/cleaning/[id]` 상세: 기준사진 비교 → 슬롯별 사진 업로드 → 청소 메모 → 제출 버튼.

### 4. i18n
- 새 네임스페이스 `tour` — ko/vi 동시 등록 (운영자 화면도 vi 필수 규칙 준수).
- **`SUPPLIER_CLIENT_NAMESPACES`에 `tour` 추가 필수** (누락 시 raw 키 노출 — admin-client-namespace-whitelist와 동일 함정).

### 5. 유지보수 규칙 명문화 (테오 요구사항)
- `.claude/skills/frontend/` 관련 스킬 + QA 체크리스트에 추가: "투어가 걸린 화면(data-tour 앵커 보유)의 UI 변경 시 `tour-definitions.ts` 스텝·ko/vi 문구 동시 갱신". docs/INDEX.md 등록.

## 완료 기준 (테스트 가능)
1. 신규(localStorage 없는) 공급자 데모 계정으로 `/my-villas` 첫 진입 시 코치마크 자동 표시, 완주/건너뛰기 후 재진입 시 미표시, "?" 버튼으로 재생 가능.
2. CLEANER 데모 계정 `/cleaning` 및 상세에서 동일 동작. CLEANER에게 공급자 투어 미노출.
3. `data-tour` 앵커를 임의 제거해도 해당 스텝만 스킵되고 에러·빈 오버레이 없음 (단위 테스트).
4. ko/vi 문구 패리티 (기존 i18n 패리티 테스트 통과), raw 키 노출 없음.
5. 마진·판매가·재고 데이터 무참조 (투어는 정적 문구만 — leak-checklist 자명 통과).
6. `next build` + 기존 vitest 전체 통과.

## 수정 금지 구역
- `prisma/schema.prisma`(스키마 변경 없음), `worker/`, `lib/zalo-*`(타 작업 영역), `package.json`(의존성 추가 없음).

## 검증 방법
- 로컬 prod 빌드 + Playwright 실측(390px 모바일 뷰포트, 데모 계정: Tyy 0791234567 / Nguyễn 0791234560).
- QA 독립 평가 (작성자 자기평가 무효).
