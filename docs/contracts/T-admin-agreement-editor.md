# T-admin-agreement-editor — 이용 동의서 운영자 편집 화면

> 상태: **Phase A 구현완료(QA 조건부통과, 브랜치 wt/agreement-editor 23c8e5f) / Phase B 대기(BLOCKED)**
> 담당(제안): TDA(스키마 결정) → BE(API) → FE(설정 폼) → LOC(다국어 입력 검수) → QA
> 작성일: 2026-06-24 · 갱신: 2026-06-25

## ⓿ 진행 분할 (QA 검수 23c8e5f 반영 — 완료 오인 방지)

QA 결과 인프라는 전부 PASS(권한 ADMIN전용·감사로그·검증·폴백·이력·i18n·client/server 경계, 보안 누수 0).
단 "편집→실제 서명 문서 반영"(D1)·"서명 버전 스탬프"(D2)는 충돌 구역(체크인/인쇄 읽기 경로 = 진행 중 리팩터링 소유)이라 의도적으로 후속 분리.

- **Phase A (완료, 브랜치 보류)** — DB 저장소·편집 화면·API·검증·감사·이력·i18n. main 미병합(리팩터링과 lib/agreement.ts·messages 충돌 회피).
  - 저장소 결정: **TDA가 AppSetting JSON 채택**(전용 모델 대신) — 병렬 세션 `prisma db push`/`generate` EPERM이 타 세션 빌드를 깨는 기록된 사고 회피. 전용 모델은 Phase B에서 안전한 창에 마이그레이션.
- **Phase B (대기, 의존성 해소 후)** — D1: `agreement-section.tsx`·인쇄 시트가 `getAgreementContent()`를 읽도록 일원화. D2: `CheckInRecord.agreementVersion` 컬럼 + 서명 시 `agreementVersionLabel` 스탬프. 둘 다 리팩터링 머지 후 충돌 없이 수행.

> 완료 기준 §5.2(저장→체크인 반영)·§5.3(서명 버전 일치)은 **Phase B에서 충족**. Phase A 단독으로 "전체 완료" 주장 금지.

## 1. 배경 / 문제

- 이용 동의서(빌라 이용 수칙·안전 동의서)는 **모든 빌라 공용**(수영장 조항만 hasPool 시 자동 삽입). 빌라별 설정 아님.
- 현재 동의서 문구는 **소스 코드에 하드코딩**되어 있어, 운영자(테오)가 직접 못 고친다. 수정하려면 개발자가 코드 수정 + 재배포해야 한다.
  - 과거: `lib/agreement.ts` 단일 상수(ko/vi/en/zh/ru + `AGREEMENT_VERSION`)
  - 현재(리팩터링 중, 미커밋): `messages/*.json`의 `adminCheckin.agreement` 키로 이동 중 — 여전히 코드라 운영자 편집 불가
- **법적 추적 공백**: 서명 레코드 `CheckInRecord`에 `agreementSignedAt`만 있고 **어느 판본(version)에 서명했는지 저장 안 됨** (`schema.prisma:423`). 조항이 바뀌면 과거 서명이 어떤 문구였는지 증명 불가.

## 2. 목표 (이번 태스크 범위)

운영자 설정 화면(`/settings`)에서 동의서 본문을 **텍스트박스로 입력·수정·저장**하고, 저장 시 **버전이 올라가며**, 이후 체크인 서명은 그 시점 버전을 레코드에 **스탬프**한다.

### 범위 (IN)
1. **저장소**: 동의서 콘텐츠를 코드가 아닌 **DB**에서 읽도록 전환 (저장 방식은 §4 TDA 결정).
2. **편집 화면**: `/settings`에 "이용 동의서" 카드 추가 — 5개 언어(ko/vi/en/zh/ru) × 조항(c1, c2, poolClause, c4~c7)별 textarea + 저장 버튼. 기존 `hold-hours-form.tsx` 패턴(react-hook-form + zod + 저장 토스트) 재사용.
3. **버전 관리**: 저장 시 `AGREEMENT_VERSION` 자동 증가(또는 운영자 수동 입력). 인쇄 시트·디지털 동의서에 버전 표기 유지.
4. **서명 버전 스탬프**: 서명 시 `CheckInRecord.agreementVersion`(신규 컬럼)에 현재 버전 기록.
5. **읽기 경로 일원화**: 디지털 체크인(`agreement-section.tsx`)·인쇄 시트가 DB 콘텐츠를 단일 소스로 읽음.
6. **감사 로그**: 동의서 저장 시 `writeAuditLog()` (글로벌 절대 규칙).
7. **권한**: 편집 API는 ADMIN 전용(`isOperator`). 공급자·게스트 접근 차단.

### 비범위 (OUT)
- 빌라별 동의서 분기 (전 빌라 공용 유지)
- 조항 추가/삭제 UI(동적 조항 수) — 이번엔 **고정 조항 7종 텍스트 편집만**. 동적 조항은 IDEAS.md.
- 게스트가 서명한 과거 PDF 재생성

## 3. 의존성 (착수 전 필수 해소)

⚠️ **진행 중인 동의서 리팩터링이 main에 반영될 때까지 착수 금지.**
- 현재 작업트리(미커밋)에서 `lib/agreement.ts` 삭제 + `messages/*.json`으로 동의서 이동이 진행 중(다른 세션).
- 이 태스크는 "동의서를 어디서 읽는가"를 또 바꾸므로, 리팩터링과 충돌하면 한쪽 작업이 파손된다.
- **해소 조건**: 리팩터링 커밋이 origin/main에 머지되어 동의서의 "현재 단일 소스"가 확정될 것. 그 뒤 본 계약서의 §4를 그 소스 기준으로 갱신.

## 4. TDA 결정 필요 — 저장소 방식 (회의 안건)

| 안 | 방식 | 장점 | 단점 |
|---|---|---|---|
| **A (권장)** | 전용 모델 `AgreementTemplate`(version PK, locale별 조항 JSON, publishedAt) — 버전별 행 보존 | 판본 이력 보존, 서명 추적 정확, 롤백 가능 | 스키마 마이그레이션 필요(TDA 전담 세션) |
| B | `AppSetting` 키(`AGREEMENT_CONTENT` = JSON 문자열) 1행 + `CheckInRecord.agreementVersion` 스탬프 | 마이그레이션 최소(`AppSetting` 재사용), `PUT /api/settings` 재사용 | 과거 판본 본문 미보존(버전 번호만 남고 그 시점 문구는 못 복원) |

- 법적 문서 특성상 **"서명 시점의 정확한 문구 보존"**이 중요 → **안 A 권장**.
- 어느 안이든 `CheckInRecord.agreementVersion String?` 컬럼 추가는 공통(서명 추적).

## 5. 완료 기준 (테스트 가능)

1. `/settings`에서 ko 조항 c5를 수정·저장 → 페이지 새로고침 후에도 수정값 유지(DB 영속).
2. 저장 후 디지털 체크인 동의서 화면에 수정된 c5가 즉시 반영.
3. 저장 시 버전이 이전보다 증가하고, 그 이후 신규 서명 레코드의 `agreementVersion`이 새 버전과 일치.
4. 5개 언어 모두 입력 가능, 빈 조항 저장 시도 시 검증 에러(법적 누락 방지).
5. SUPPLIER 계정으로 편집 API 호출 시 403.
6. 동의서 저장 1건당 `AuditLog` 1행 생성.
7. `npm run lint && npm run typecheck && next build` 통과.

## 6. 검증 방법
- QA(독립): Playwright로 ADMIN 로그인 → 설정에서 조항 수정·저장 → 체크인 화면 반영 확인 → SUPPLIER 권한 누수 테스트. 작성자 자기평가 무효.

## 7. 수정 금지 구역 (다른 세션 보호)
- `lib/agreement.ts`, `messages/ko.json`·`vi.json`의 `adminCheckin.agreement` 블록, `app/(admin)/bookings/[id]/checkin/*` — **리팩터링 세션이 작업 중. main 반영 전 절대 수정 금지.**
- 본 태스크는 그 작업이 끝난 소스 위에서 "DB화 + 편집 폼"만 얹는다.

## 8. 예상 변경 파일 (착수 시)
- `prisma/schema.prisma` (TDA 전담) — 안 A: `AgreementTemplate` 모델 + `CheckInRecord.agreementVersion`
- `app/api/settings/...` 또는 신규 `app/api/agreement/route.ts` (GET/PUT, ADMIN)
- `app/(admin)/settings/agreement-form.tsx` (신규) + `page.tsx` 카드 추가
- `lib/agreement.ts`(또는 후속 단일 소스) — DB read 헬퍼로 전환
- `messages/ko.json`·`vi.json` — `adminSettings.agreement` UI 라벨 키 추가(조항 본문 아님)
