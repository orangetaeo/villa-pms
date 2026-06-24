# 계약: T-roster-reminder-cron — D-3 투숙객 명단 미입력 리마인더

## 배경
[[guest-roster-status]] 안 A(ADMIN)·안 B(여행사 셀프) 라이브. 마지막 조각: 체크인이 임박했는데 명단이 비어 있으면 **운영자(테오)에게 Zalo로 리마인드**해 명단을 챙기거나 여행사에 안내하도록 한다. (Phase 2, 테오 지시로 착수 2026-06-25)

## 결정
- **수신자 = 운영자(OWNER/MANAGER/STAFF/ADMIN) 중 zaloUserId 연결된 사용자.** 여행사는 비로그인·Zalo 미연결이라 직접 발송 불가 → 운영자가 챙긴다. 메시지는 **한국어**(수신자=테오).
- **트리거 = 체크인 D-3** (VN 타임존 기준 `checkIn == today+3`), **status CONFIRMED**, **guestRoster 비어있음(null)**. 날짜 정확 매칭이라 예약당 1회 발송(멱등) — cron 누락 시 best-effort 미발송 허용.
- **새 알림 타입** `NotificationType.ROSTER_REMINDER` — additive enum. **DB는 `prisma db push` 금지(Villa.source 드리프트), raw SQL `ALTER TYPE ... ADD VALUE IF NOT EXISTS`로 추가** [[db-schema-drift-villa-source]].

## 범위 (이 PR — worktree `wt/roster-reminder`)
1. **스키마**: `NotificationType`에 `ROSTER_REMINDER` 추가(additive).
2. **lib/roster-reminder.ts**: `findRosterReminderTargets(db, now)`(D-3·CONFIRMED·roster null 조회) + `runRosterReminders(db, now)`(대상별 운영자 수신자에 enqueueNotification, payload에 판매가·마진 미포함). 요약 반환.
3. **cron 라우트** `/api/cron/roster-reminder`: CRON_SECRET Bearer(기존 cron 패턴, force-dynamic), `runRosterReminders` 호출.
4. **zalo 템플릿** `buildNotificationText`에 ROSTER_REMINDER case(한국어): 빌라·체크인일·게스트·"명단 미입력, 확인/안내 필요".
5. **테스트**: 날짜 윈도우(D-3만)·status/roster 필터·운영자 수신자 fan-out·마진 미포함 payload + 템플릿.

## 수정 금지 구역
- `lib/hold.ts`·`proposal.ts`·`app/(admin)/bookings/checkin-sheet/*`·`board-client.tsx` — 읽기만.
- `messages/*.json` 변경 없음.

## 완료 기준
- [ ] typecheck 0 · `next build` · `npm test` 신규 포함 green
- [ ] D-3·CONFIRMED·roster null 만 대상(D-2/D-4·HOLD·roster 있음 제외) 테스트 실증
- [ ] 대상 1건 → 운영자(zaloUserId 보유) 수마다 1 notification, payload에 supplierCostVnd·totalSale* 없음
- [ ] DB enum 값 추가(raw SQL) 확인 · 배포 SUCCESS · cron 라우트 401(무인증)/200(인증)

## 배포 의존 (이 PR 밖)
- **Railway cron 서비스 등록**(일 1회, `cron-roster-reminder`) — OPS/테오. 기존 `cron-ical-sync`·`cron-expire-holds` 패턴(ops/deployment-pattern.md). 등록 전까지 라우트는 존재하나 자동 실행 안 됨.

## 후속
- 여행사 직접 수신(Zalo 연결) — agency Zalo 온보딩 필요 시 별도 에픽.
- 리마인더에 roster 셀프입력 링크 포함해 테오가 바로 포워딩 — payload에 token·bookingId 보관(향후 링크화).
