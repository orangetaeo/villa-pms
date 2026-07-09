# T-audit-fixes-2026-07-09 — 전수검사 발견 결함 6건 수정

## 배경
2026-07-09 대표 지시 5부서 전수검사(PM·QA누수·BE로직·모바일실측·OPS)에서 발견된 비차단 결함 6건을 일괄 수정한다. P0/P1은 0건이었고 전부 P2/경미 등급.

## 범위 (수정 대상)

| ID | 심각도 | 내용 | 예상 파일 |
|---|---|---|---|
| D-1 | 중 | 파트너 승인대기 화면 헤더(360px) 로그아웃 아이콘·언어토글 터치타겟 11px 겹침 | 포털 헤더/승인대기 화면 컴포넌트 |
| P2-1 | 경미 | /p 사후 route 만료 규약 불일치 — service-orders만 expiresAt 410, roster·payment-notice는 미검사 | app/api/p/[token]/roster·payment-notice |
| P2-2 | 경미 | 게스트 체크인 로더가 서명 전에도 wifiPassword를 RSC payload에 직렬화 (출입정보 서명 후 정책과 비대칭) | lib/guest-checkin-load.ts |
| W-2 | 경미 | lib/statistics.ts loadOverviewStats에 seller 필터 부재 — 건수 KPI가 /revenue(OPERATOR만)와 불일치 가능 | lib/statistics.ts |
| M-1 | 경미 | 청소원 태스크 화면 날짜만 vi 포맷 혼재(한국어 UI + "9 tháng 7") | 청소 태스크 목록 날짜 포맷 |
| M-2 | 경미 | /villas 탭 행 밝은 가로 스크롤바 다크 테마 상시 노출 | app/(admin)/villas 탭 컨테이너 |

## 수정 금지 구역 (다른 세션 진행 중 — ADR-0032)
`instrumentation.ts`, `lib/zalo-runtime.ts`, `lib/zalo-inbound.ts`, `app/api/zalo/qr/route.ts`, `lib/zalo-worker-client.ts`, `lib/zalo-runtime-role.ts`, `lib/realtime-notify.ts`, `worker/`, `prisma/*.ts` 신규 스크립트 일체.

## 완료 기준 (테스트 가능)
1. D-1: 360px에서 승인대기 헤더의 로그아웃 버튼과 언어토글 bounding box가 겹치지 않음 (수평 간격 ≥ 8px)
2. P2-1 (방향 정정 — 구현 중 분석 결과): roster·payment-notice에 410을 **추가하지 않는다**. 두 route는 예약 수명주기(HOLD/CONFIRMED) 기준의 "예약 완결 액션"이라 제안 만료와 무관 — D-3 roster-reminder cron이 만료 한참 뒤 CONFIRMED 예약에 roster 링크를 보내고, 막판 HOLD는 만료를 넘겨 생존하므로 410 추가 시 정상 업무가 깨진다. 실결함은 반대쪽: done 페이지가 만료 후에도 부가서비스 주문 폼을 렌더해 "폼은 보이는데 제출은 410". 수정 = ① done 페이지 만료 판정(orderingClosed) → 폼 숨김+5언어 마감 안내+기존 요청 내역 유지 ② roster·payment-notice에 만료 규약 의도 주석 명문화
3. P2-2: agreementSignedAt이 null이면 /g 로더 반환값의 wifiSsid·wifiPassword가 null (서명 후에는 기존대로 노출)
4. W-2: loadOverviewStats 예약 집계가 seller=OPERATOR로 게이트되어 /revenue와 동일 모수 (의도 주석 포함)
5. M-1: 청소원 화면 날짜가 UI 로케일과 동일 로케일로 포맷
6. M-2: /villas 탭 스크롤바가 다크 테마에서 두드러지지 않음 (스크롤 기능은 유지)
7. `npm run typecheck`·`npm test`·`npm run build` 전부 통과
8. QA 독립 평가 통과 (작성자≠평가자)

## 검증 방법
- 단위: 기존 vitest 스위트 + P2-1/P2-2/W-2 대상 테스트 추가·갱신
- 실측: 배포 후 파트너 데모 계정 360px 헤더 스크린샷, /g 서명 전 payload grep

## 세션
worktree `wt/audit-fixes` (C:\Projects\_worktrees\villa-pms-audit-fixes), 메인 폴더 비접촉.
