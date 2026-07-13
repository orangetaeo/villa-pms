# T-season-shoulder — 시즌 구분자 "준성수기(SHOULDER)" 추가

## 배경·요청
사용자 요청: 빌라 기간별요금에서 "준성수기" 구분자 추가 — **admin/공급자(빌라관리자) 페이지 모두**.
현행 SeasonType = LOW(비수기) / HIGH(성수기) / PEAK(극성수기). 여기에 SHOULDER(준성수기)를 LOW와 HIGH 사이 단계로 추가한다.

## 범위 (전수 grep 기반 — 공유 enum 값 추가 시 좁혀 쓰는 소비처 전수 수정 교훈 적용)

### DB·스키마
- [ ] Railway 라이브 DB: `ALTER TYPE "SeasonType" ADD VALUE IF NOT EXISTS 'SHOULDER' BEFORE 'HIGH';`
- [ ] `prisma/migrations-manual/2026-07-13_seasontype_add_shoulder.sql` 보존
- [ ] `prisma/schema.prisma` enum SeasonType에 SHOULDER 추가(LOW 다음) + `npx prisma generate`

### lib (좁힌 union·Record 전수)
- [ ] `lib/pricing.ts` — SEASON_PRECEDENCE(Record<SeasonType,number>) 재번호: PEAK 3 > HIGH 2 > SHOULDER 1 > LOW 0. `extractSeasonRates` 루프 [SHOULDER, HIGH, PEAK]. `buildRatePeriodRowsFromSeasonCosts` — costs에 해당 시즌 키 없으면 그 전역 기간 스킵(방어). SeasonCostsVnd에 `SHOULDER?: bigint` 선택 추가
- [ ] `lib/villa-schema.ts` — SEASONS 배열 + rates z.object에 `SHOULDER` **선택**(하위호환: 구 클라이언트 payload 3종은 계속 유효)
- [ ] `lib/zalo-share.ts` — SEASON_LABEL에 SHOULDER: "준성수기"
- [ ] `lib/cost-alerts.ts` — season union 3곳 + 시즌 루프에 SHOULDER

### API (z.enum 검증)
- [ ] `app/api/villas/[id]/rate-periods/route.ts` SEASONS
- [ ] `app/api/villas/[id]/rate-periods/cost/route.ts` (union 확인 후 동일)
- [ ] `app/api/seasons/route.ts`, `app/api/seasons/[id]/route.ts` z.enum
- [ ] `app/api/villas/route.ts`·`[id]/route.ts` — villa-schema 경유 자동, SHOULDER 원가 pass-through 확인

### UI — admin (다크)
- [ ] `app/(admin)/villas/[id]/rate-period-editor.tsx` — Season union·SEASONS·뱃지색(SHOULDER=amber 계열, emerald<amber<orange<red 단계감)
- [ ] `app/(admin)/settings/season-manager.tsx` — union·zod·SEASON_OPTIONS·뱃지색
- [ ] `app/(admin)/cost-alerts/cost-alerts-view.tsx` — 시즌 표시 확인
- [ ] `app/(admin)/villas/[id]/page.tsx` — 시즌 표시 확인

### UI — 공급자 (라이트·vi)
- [ ] `app/(supplier)/my-villas/[id]/rate-periods/rate-period-cost-editor.tsx` — Season union·SEASONS 칩
- [ ] `app/(supplier)/my-villas/[id]/page.tsx`·`edit/page.tsx` — 시즌 표시 확인
- [ ] 신규 등록 마법사 원가 스텝(`wizard-types.ts` 등) — SHOULDER 원가 입력 **선택 필드**로 추가(필수 3종은 유지)

### i18n (ko+vi 동시 — 하드코딩 금지 규칙)
- [ ] `messages/ko.json` seasons 라벨 블록 전수(최소 4곳): SHOULDER="준성수기"
- [ ] `messages/vi.json` 동일 위치: SHOULDER="Cận cao điểm"

### 테스트
- [ ] pricing/rate-periods 기존 테스트 통과 + SHOULDER 케이스(precedence·extractSeasonRates·API enum 수용) 추가

## 완료 기준 (검증 방법)
1. `npm run lint && npm run typecheck && npx next build` 통과
2. admin 기간별요금 편집기·공급자 원가 편집기·시즌 달력 설정에서 준성수기 선택/표시 가능 (ko·vi)
3. `SHOULDER` 미포함 구 payload(빌라 생성·요율 저장) 하위호환 유지
4. grep 재검: `z.enum.*LOW|Record<SeasonType|"LOW"\s*\|` 잔여 좁힌 소비처 0건

## 수정 금지 구역
- design-audit/, kakao-icon-*, villa-go-* (타 세션 진행분)
- 체크아웃·정산 관련 파일 일절

담당: BE(구현, opus) → QA(검증, opus). 선점: 2026-07-13.
