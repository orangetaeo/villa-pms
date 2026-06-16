# 계약: T-util-tests — 순수 유틸 회귀 테스트 보강 (date-vn·format·intl-messages)

## 배경
Phase 1 기능 보드가 사실상 완료된 상태에서, 광범위하게 재사용되는 순수 유틸 3종이
단위 테스트 없이 운영 중. 금액(부동소수점 금지)·VN 타임존 날짜·누수 방지 화이트리스트는
회귀 시 영향이 크고(전 화면·정산·가용성·보안) 결정적이라 테스트 가치가 높다.

## 범위 (신규 파일만 — 이 세션 전용)
- `lib/date-vn.test.ts` (신규) — parseUtcDateOnly(롤오버/형식 거부)·toDateOnlyString·todayVnDateString(VN 자정 경계, now 주입)·addUtcDays
- `lib/format.test.ts` (신규) — formatThousands(BigInt/문자열/음수)·formatVnd(₫)·formatKrw(₩·trunc)·formatDateTime(Asia/Ho_Chi_Minh)
- `lib/intl-messages.test.ts` (신규) — pickMessages(화이트리스트만 통과·미존재 무시·불변·admin 라벨 누수 차단 시나리오)
- `docs/contracts/T-util-tests.md`(본 파일)

## 수정 금지 구역 (다른 세션 점유 — import만, 무수정)
- lib/cleaning.ts·lib/hold.ts·lib/proposal.ts (활성 세션), 대상 3개 소스(date-vn·format·intl-messages)도 **테스트만 추가, 소스 무변경**
- 기존 vitest.config.ts·다른 *.test.ts 무변경

## 완료 기준
1. 3개 테스트 파일 신규, 각 함수 핵심 경로+경계 커버
2. VN 타임존 경계 1건 이상(UTC 늦은 시각이 VN 익일로 넘어가는 케이스) — now 주입으로 결정적
3. intl-messages: admin 네임스페이스가 공급자 화이트리스트에 없으면 결과에서 제외됨을 실증(누수 차단 회귀 가드)
4. `npx vitest run lib/date-vn.test.ts lib/format.test.ts lib/intl-messages.test.ts` 전부 통과
5. 소스 무변경 — 순수 회귀 테스트 추가만

## 검증
- vitest 3파일 실행 통과
