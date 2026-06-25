# 계약: 공급자 정산서 목록 UI (T-supplier-settlement-list)

- **담당**: UX-VN
- **브랜치/worktree**: `wt/supplier-settlement-ui` (`C:\Projects\_worktrees\villa-pms-supplier-settlement-ui`)
- **상태**: 착수(선점)
- **선행**: 정산 2차 P2-4(정산서 PDF, `lib/settlement-statement*.ts`, `GET /api/settlements/[id]/statement`) 배포 완료 — 본 태스크는 그 PDF의 **공급자 열람 UI**.

## 범위 (Scope)

공급자(SUPPLIER)가 자기 월별 정산서를 **목록**으로 보고 PDF를 내려받는 신규 화면.
베트남어 기본, 모바일 우선(390px), 라이트 teal 테마(`a7-my-earnings` 디자인 언어 계승).

포함:
1. 신규 페이지 `app/(supplier)/settlements/page.tsx` (RSC, `earnings/page.tsx` 패턴 준용)
   - 세션 SUPPLIER 강제, `supplierId = session.user.id` 자동 스코프
   - `Settlement` 목록 조회: `where supplierId = 본인`, `yearMonth desc`
   - **DRAFT 제외** — 내부 초안은 공급자 비노출. CONFIRMED 이상만 표시
   - 행: 월(YYYY년 M월 / Tháng M, YYYY) · 상태 배지 · 총액 VND(점 구분) · PDF 버튼
   - 상태 표기 **2단 축약**: PAID → "지급 완료", 그 외(CONFIRMED·COLLECTED·FX_ADJUSTED) → "지급 대기"
     (COLLECTED·FX_ADJUSTED 등 내부 운영 상태는 공급자에 **비노출** — 누수 방지)
   - PDF: `statementUrl` 존재 시 `<a href="/api/settlements/{id}/statement" target="_blank">` 다운로드/보기, 없으면 "준비 중" 비활성 표기
   - 빈 상태 카드(정산 내역 없음)
2. 진입점: `app/(supplier)/earnings/page.tsx` 헤더에 `/settlements` 링크 추가(새 탭 미추가 — 단순성 원칙4)
3. i18n: `messages/{vi,ko}.json` 신규 네임스페이스 `supplierSettlements` (vi 기본·ko 동시) + 키 동등성 테스트
4. `app/(supplier)/layout.tsx` 화이트리스트 — 본 페이지는 RSC(`getTranslations`)이므로 클라 네임스페이스 추가 **불필요**(earnings와 동일). earnings 진입 링크도 서버 렌더

## 누수 차단 (원칙2 마진 비공개)

- `Settlement` select: `id, yearMonth, status, totalVnd, paidAt, statementUrl`만. **마진·판매가·KRW·고객 필드 조회 금지**
- PDF는 기존 `GET /api/settlements/[id]/statement`가 소유 공급자에게만 서빙(생성기가 원가 VND만 포함 보장). 본 태스크 API 무변경
- `totalVnd`는 BigInt — `Number()` 캐스팅 금지, `formatVndDot` 문자열 처리

## 수정 금지 구역 (다른 세션 영역)

- `lib/settlement.ts`, `lib/settlement-statement*.ts`, `lib/ledger.ts`, `app/api/settlements/**` — **읽기만**, 수정 금지
- `app/(admin)/**`, statistics 관련 — 무관, 수정 금지
- 공유 파일은 **추가만**: `messages/{vi,ko}.json`(키 추가), `components/supplier/tab-bar.tsx`(미변경 예정)

## 디자인

- Stitch: `a7-my-earnings` 언어 계승. 신규 export `design/stitch/a8-my-settlements/`(DESIGN 생성·4기준 자가검토)

## 테스트 가능한 완료 기준 (QA 독립 평가)

1. 공급자 로그인 → `/settlements` 200, 자기 정산만 노출(타 공급자 정산 0건 — 교차 스코프 차단 실증)
2. DRAFT 정산은 목록에 **미노출**, CONFIRMED 이상만 노출
3. PAID 행 PDF 버튼 → 본인 정산 PDF 200(application/pdf), 타인 정산 id 직접 요청 403
4. 판매가·마진·KRW·고객정보 **0건 노출**(HTML·네트워크 응답 grep)
5. 비로그인 307/리다이렉트, ADMIN/CLEANER 접근 차단(미들웨어)
6. vi/ko 키 동등성 테스트 통과, 하드코딩 한국어 0(vi 렌더)
7. `npm run lint && npx tsc --noEmit` 0 에러, `npm test` 그린, `next build` 통과(배포 게이트)

## 검증 방법

- vitest: i18n 키 동등성 + (가능 시) 목록 파생 로직 단위
- Playwright/HTTP: SUPPLIER 200·교차 403·비로그인 차단·PDF content-type
- 누수: 렌더 HTML + API 응답에서 margin/salePrice/KRW/고객 grep 0
