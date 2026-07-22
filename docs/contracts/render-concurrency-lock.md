# 계약서 — 렌더 동시성 전역 락 (M-7)

- 태스크 ID: `render-concurrency-lock`
- 브랜치: `wt/render-lock` (worktree `C:\Projects\_worktrees\villa-pms-render-lock`)
- 기준 커밋: origin/main `457c57b`
- 담당: BE → QA
- 작성일: 2026-07-22
- 출처: villa-clip-narration-p2 독립 QA 잔여 지적 **M-7**

## 배경 (문제 정의)

`/api/cron/youtube-edit-jobs`는 **주기 5분**으로 등록돼 있고, 나레이션 투어 영상 1건의
렌더는 **실측 2.5~8분**이다. 즉 **주기 < 최대 렌더 시간**이다.

현재 락은 **잡별(per-job) 원자 락**뿐이다:

```ts
const claim = await prisma.youtubeShort.updateMany({
  where: { id, editJobStatus: PENDING },
  data:  { editJobStatus: PROCESSING },
});
if (claim.count === 0) continue; // 다른 러너 선점
```

이건 "같은 잡을 두 번 렌더"만 막는다. **다른 잡**은 못 막는다.
PENDING이 2건 이상 밀린 상태에서:

- T+0 : 주기 A가 잡1을 claim → ffmpeg 렌더 시작(8분)
- T+5m: 주기 B가 실행 → 잡1은 PROCESSING이라 후보에서 빠지고, **잡2를 새로 claim** → ffmpeg 2개 동시 실행
- T+10m: 주기 C → 잡3 → ffmpeg 3개

Railway 컨테이너 1대에서 ffmpeg가 2~3개 동시에 돌면 CPU·메모리를 나눠 먹어
⑴ 각 렌더가 더 느려져 25분 고아 회수선에 접근하고 ⑵ 같은 컨테이너의 **웹 요청(운영자·공급자 화면)이 굶고**
⑶ OOM 시 렌더 전부 유실 + PROCESSING 고아가 된다.

## 범위 (포함)

1. **전역 렌더 락** — 동시 렌더 최대 1건. 잡별 락 위에 얹는다.
   - "살아있는 PROCESSING 행"(= `updatedAt >= now - ORPHAN_TIMEOUT_MS`)을 **리스**로 간주.
     별도 테이블·AppSetting 신설 없음 — 이미 존재하는 상태를 리스로 쓴다(**스키마 변경 0**).
   - claim **전** 검사: 살아있는 PROCESSING이 1건이라도 있으면 이번 주기는 렌더를 건너뛴다.
   - claim **후** 재검사(near-simultaneous 경합 대비): 내 것 외에 살아있는 PROCESSING이 있고
     그중 **id가 나보다 작은 것**이 있으면 내 claim을 PENDING으로 **반납**하고 양보한다
     (승자 = id 최소값 1개 — 결정적 tie-break, 양쪽 다 죽는 livelock 없음).
2. **고아 회수는 락과 무관하게 항상 수행** — 락에 걸려 조기 반환하더라도 ①단계(고아 회수)는 먼저 돈다.
   그렇지 않으면 죽은 PROCESSING이 락을 영구 점유해 **렌더가 영영 안 도는 데드락**이 된다.
3. **순수 함수 분리 + 유닛 테스트** — `lib/youtube/render-lock.ts`
   - `winsRenderRace(myId, otherLiveIds)` / `isRenderBusy(liveCount)`
4. **응답 계약** — 락에 걸리면 `{ status:"ok", skipped:"RENDER_BUSY", activeRenders:n }` (200 유지).
   cron 실패로 보이면 안 된다(정상 동작임).

## 제외

- 인스타 릴스 렌더(`cron/instagram-draft`)와의 **교차 락** — 릴스는 일 1회·저녁 슬롯 한정이고
  실패 시 캐러셀 폴백이 있어 위험도가 다르다. 교차 락을 걸면 릴스가 조용히 캐러셀로 강등된다.
  → 별도 판단 사항으로 남기고 이번 범위에서 제외(보고서에 명시).
- 동시 렌더 수를 AppSetting으로 조정 가능하게 하는 것 — 컨테이너 1대에서 정답은 1이다. 상수 고정.
- 렌더 중 heartbeat(updatedAt 갱신) — 최대 렌더 8분 < 리스 25분이라 불필요.

## 완료 기준 (테스트 가능)

- [ ] C1. 살아있는 PROCESSING이 1건 있으면 cron 실행이 **새 잡을 claim하지 않는다**
      (응답 `skipped:"RENDER_BUSY"`, PENDING 행의 상태 불변)
- [ ] C2. 25분 초과 PROCESSING(고아)만 있으면 → 고아 회수 후 **정상적으로 렌더가 시작된다**
      (죽은 락이 영구 점유하지 않음)
- [ ] C3. PROCESSING이 0건이면 종전과 동일하게 1건 렌더한다(회귀 없음)
- [ ] C4. `winsRenderRace`: 내 id가 최소면 true, 아니면 false. 경쟁자 없으면 true
- [ ] C5. 경합 패자는 claim을 **PENDING으로 반납**한다(잡이 FAILED로 타지 않는다)
- [ ] C6. 고아 회수·완료·실패 알림(notifyMarketing) 동작 무변경
- [ ] C7. `npm run lint && npx tsc --noEmit && npx next build` 통과
- [ ] C8. `npx vitest run` — 신규 테스트 통과, 기존 baseline 실패(webchat·regional-vendor 5건) 외 신규 실패 0

## 검증 방법

1. `npx vitest run lib/youtube/render-lock` (신규 순수함수 테스트)
2. 배포 게이트: lint + tsc + next build
3. QA 서브에이전트 독립 검증 — **작성자 자기평가 무효**
4. 배포 후 프로덕션에서 cron 수동 호출 2연타로 `skipped:"RENDER_BUSY"` 실측

## 수정 금지 구역 (다른 worktree 점유 중)

- `wt/marketing-s2` — `lib/youtube/edit.ts`, `app/(admin)/marketing/youtube/**`
- `wt/agreement-editor` — `lib/agreement*.ts`, `app/(admin)/settings/**`
- `wt/mobile-opt` — 전역 CSS
- `wt/supplier-settlement-ui`, `wt/settlement-status` — `app/(supplier)/earnings/**`, `lib/checkout-settlement.ts`

이 태스크가 만지는 파일: `app/api/cron/youtube-edit-jobs/route.ts`(신규 로직),
`lib/youtube/render-lock.ts`·`lib/youtube/render-lock.test.ts`(신규). **`lib/youtube/edit.ts`는 건드리지 않는다.**
스키마 변경 0 · 신규 의존성 0 · i18n 키 0(운영자에게 노출되는 문자열 없음).

## 리스크

| 리스크 | 대응 |
|---|---|
| 죽은 PROCESSING이 락을 영구 점유 | 고아 회수를 락 검사 **앞**에 두고, 리스 판정도 같은 25분 컷오프를 공유 |
| 두 주기가 동시에 기동해 둘 다 claim | claim 후 재검사 + id 최소값 tie-break, 패자는 PENDING 반납 |
| 잡이 계속 밀려 적체 | 렌더 8분 < 주기 5분×2이므로 다음 주기가 이어받는다. 적체는 알림으로 이미 관측됨 |
