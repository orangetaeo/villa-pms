# T-tutorial-onboarding-2 — 역할별 튜토리얼 2단계: PARTNER + VENDOR

- 상태: 착수 (2026-07-09, worktree `worktree-tutorial-onboarding` 계속)
- 선행: 1단계 PR #207 머지 — 공통 인프라(components/tour/)·유지보수 규칙·테스트 체계 완비. **이 계약은 스텝 정의+앵커+문구 추가만**(인프라 무변경).
- 1단계 확정 규칙 승계: 화면당 ≤3스텝·첫 진입 자동 1회·"?" 재생(헤더 right)·문구는 RSC 번역→props(레이아웃 화이트리스트 무변경)·localStorage 저장·앵커 부재 자동 스킵.

## 범위

### 1. PARTNER 투어 3종 (ko 기본, vi 토글)
- `partnerHome` (/partner): 첫 예약 카드(`partner-booking`) → 알림벨(`partner-bell`) → 탭바(`partner-tab-bar`)
- `partnerReceivables` (/partner/receivables): 미수 요약 카드(`partner-outstanding`) → 청구서·입금통보 목록(`partner-invoices`) — 2스텝
- `partnerProposals` (/partner/proposals): 첫 제안 카드(`partner-proposal`) → 열람·예약 링크(`partner-proposal-open`) — 2스텝
- 레이아웃: PartnerShell PortalHeader right에 TourHelpButton 추가(알림벨 옆). 승인 게이트(미승인) 화면엔 미노출(showNav일 때만).

### 2. VENDOR 투어 1종 (vi 기본)
- `vendorBoard` (/vendor): 발주함 탭(`vendor-tab-inbox`) → 일정 탭(`vendor-tab-schedule`) → 정산 탭(`vendor-tab-settlement`)
- **앵커는 탭 버튼 3개** — VendorBoard가 클라 fetch로 데이터를 늦게 그리므로, 즉시 렌더되는 탭 버튼만 앵커로 사용(비동기 카드 앵커 금지 — 자동시작 400ms 타이밍 레이스 회피).
- 레이아웃: vendor PortalHeader right에 TourHelpButton 추가(VendorNotificationBell 옆). 승인 게이트 화면엔 CoachMark 미마운트.

### 3. i18n·정의 갱신
- `tour` NS에 partnerHome·partnerReceivables·partnerProposals·vendorBoard 키 추가 (ko/vi 동시).
- `tour-definitions.ts` TOURS·route 매핑 추가. `tests/tour-onboarding.test.ts` ANCHOR_SOURCES에 신규 파일 등록.
- light-portal-i18n 가드는 이미 vendor·partner 디렉터리를 스캔 — 투어 클라 컴포넌트는 useTranslations 미사용이라 화이트리스트 무변경.

## 완료 기준
1. 파트너 데모(아시아써니 0791234568)로 /partner 첫 진입 시 자동 표시·건너뛰기 영속·"?" 재생. receivables·proposals 동일.
2. 벤더 데모(에이스마사지 0791234569)로 /vendor 동일 동작, 탭 3개 하이라이트 정상.
3. 미승인 파트너·벤더 게이트 화면에 투어·"?" 미노출.
4. 데이터 0건 화면에서 앵커 부재 스텝 자동 스킵(빈 오버레이 없음).
5. 기존 테스트 전체 + tour-onboarding 테스트(신규 투어 포함 앵커 실존·ko/vi 패리티) 통과. tsc·build 통과.
6. 마진·원가·판매가 무참조(정적 문구만).

## 수정 금지 구역
- prisma/schema.prisma, worker/, lib/zalo-*, package.json, components/tour/coach-mark.tsx(인프라 동결 — 스텝 추가에 수정 불요).

## 검증
- QA 독립 평가 (로컬 prod + Playwright 390px, 파트너·벤더 데모 계정 실측).
