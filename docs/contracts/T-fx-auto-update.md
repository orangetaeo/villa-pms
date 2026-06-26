# 계약: 시즌 요율 환율 opt-in 자동 갱신 (Phase 2 백로그)

## 배경
판매가 기준 환율 `FX_VND_PER_KRW`(1 KRW = x VND)는 `/settings`에서 **수동 입력**만 가능했다(lib/pricing
`getFxVndPerKrw`·`suggestSalePriceKrw`가 소비, 제안·정산·마진 환산의 기준). 매일 수동 갱신은 번거로움.
게스트 표시용 환율(lib/fx-rates, open.er-api)은 이미 일 1회 자동 캐시 중 — 같은 소스로 판매가 환율도 자동화.

## 사업 안전 (방향 결정 회피 — opt-in)
판매가·마진의 기준 환율을 자동으로 바꾸는 것은 사업 판단이 갈리는 영역이므로 **기본 OFF**.
- 새 토글 `FX_AUTO_UPDATE`("on"/"off", 미설정=off). 운영자가 `/settings`에서 **명시적으로 켜야** 동작.
- OFF면 cron은 무동작(skipped_off) — 승인 없이 환율이 바뀌지 않음. ON이어도 게스트 표시 환율과 동일 소스라 일관.

## 범위 (전부 신규/additive — 라이브 로직 무변경)
- `lib/fx-auto-update.ts`(신규) — 순수: `FX_AUTO_UPDATE_KEY`·`isFxAutoUpdateOn`·`formatFxVndPerKrw`(소수4자리,
  FX_VND_PER_KRW 파서 호환)·`runFxAutoUpdate(db,{now,getRates})`(토글 게이트→getDailyRates 재사용→변경 시만
  upsert+AuditLog(userId=null)). getRates 주입으로 네트워크 분리(단위 테스트 가능).
- `app/api/cron/fx-update/route.ts`(신규) — CRON_SECRET Bearer(미설정 500·불일치 401, cron-ical-sync 패턴), `runFxAutoUpdate(prisma)`.
- `app/api/settings/validators.ts` — `FX_AUTO_UPDATE_KEY` 화이트리스트 추가 + 검증자("on"|"off"만). 비-clearable.
- `app/(admin)/settings/fx-rate-form.tsx` — 자동 갱신 토글(switch) + ON 시 "매일 덮어쓰여짐" 안내. 수동 입력은 override로 유지.
- `app/(admin)/settings/page.tsx` — FX_AUTO_UPDATE 조회 + `autoUpdate` prop 전달.
- `prisma/seed.ts` — `buildAppSettings`에 `FX_AUTO_UPDATE: "off"`(기본 OFF) 추가(seed-data 테스트 SETTING_KEYS 전수 충족).
- `messages/ko.json`·`vi.json` — `adminSettings.fx.auto.{title,description,activeNote,enabled,disabled}`.
- `lib/fx-auto-update.test.ts` — 토글/포맷/전이(skipped_off·no_rate·invalid·unchanged·updated).

## 수정 금지 구역
- lib/pricing(환율 소비)·lib/fx-rates(getDailyRates는 import만)·정산·제안 로직 — 무수정.
- prisma/schema.prisma 무변경(AppSetting 키만 사용, additive 데이터). 공유 폴더 활성 세션 영역 무접촉.

## 완료 기준 (테스트 가능)
1. 토글 OFF/미설정 → cron skipped_off, FX_VND_PER_KRW 불변·AuditLog 없음 ✅
2. ON + 새 환율 → FX_VND_PER_KRW 갱신 + AuditLog(userId null·source=fx-auto-update) ✅
3. ON + 동일값 → unchanged(쓰기·로그 생략) / 조회 실패 → no_rate / 변환불가 → invalid, 모두 기존값 유지 ✅
4. formatFxVndPerKrw 결과는 항상 `/^\d+(\.\d{1,4})?$/`·양수 (lib/pricing 파서 호환) ✅
5. /settings 토글 PUT("on"/"off")만 허용(그 외 INVALID_VALUE) ✅
6. typecheck 0 · lint 0(에러) · vitest 전체 통과 · next build 성공 ✅
7. 권한: cron CRON_SECRET, /api/settings ADMIN 전용(기존 가드 재사용)

## 배포 후 (OPS/테오)
- Railway cron 등록: `/api/cron/fx-update` **일 1회**(예: 매일 09:00 ICT) GET/POST + `Authorization: Bearer $CRON_SECRET`
  (cron-ical-sync·cron-expire-holds 등록 패턴, ops/deployment-pattern.md). **토글 OFF 기본이라 등록해도 안전**.
- 운영자가 `/settings` 환율 카드에서 자동 갱신을 켜면 그날부터 일 1회 갱신.
