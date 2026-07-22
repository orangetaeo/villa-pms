// lib/marketing/reap-stale-publishing.ts — 발행 고아(PUBLISHING) 자동 회수 (T-publish-orphan-reaper)
//
// 배경(2026-07-22 실사고): `cron-instagram-publish` 실행이 배포 교체 중 `curl (22) 502`로 끊겼다.
//   두 발행 라우트는 `QUEUED → PUBLISHING` 원자 선점을 **먼저** 하므로, 발행 도중 프로세스가 죽으면
//   그 행은 PUBLISHING에 영구히 갇힌다(어떤 코드도 PUBLISHING을 되돌리지 않는다).
//   결과: 릴스 1건이 발행되지 않은 채 큐에서 사라졌고, 사람이 계정을 눈으로 확인한 뒤 손으로 FAILED 처리했다.
//   편집 축(editJobStatus: PROCESSING)에는 이미 고아 회수가 있는데(youtube-edit-jobs cron ①단계, 25분)
//   발행 축(status: PUBLISHING)에는 없었다 — 이 모듈이 그 구멍을 메운다.
//
// 판정: `status = PUBLISHING AND updatedAt < now - 45분`.
//   ★ 근거는 `maxDuration`이 **아니다**(QA 지적 F2): route의 `export const maxDuration = 300`은 Vercel용 힌트라
//   self-hosted(Railway `next start`)에서는 아무도 강제하지 않는다. 실제 상한은 발행 경로의 fetch 타임아웃 합이다.
//   인스타 캐러셀 10장 최악(lib/instagram/publish.ts 실측 합):
//     자식 생성 10×30s(HTTP_TIMEOUT_MS) + 자식 폴링 10×(60s CONTAINER_POLL_TIMEOUT_MS + 마지막 요청 30s)
//     + 부모 생성 30s + 부모 폴링 90s + media_publish 30s + permalink 30s ≈ 23분
//   (릴스는 컨테이너 폴링 300s 포함 ≈ 7분, 유튜브 업로드는 120s×3 ≈ 6분으로 캐러셀보다 짧다.)
//   → 45분 = 최악 경로의 약 2배. 살아있는 발행을 실행 중에 죽이지 않는다.
//   고아는 배포 교체·크래시 때만 생기는 드문 사건이라 **감지가 20분 늦는 것은 무해**하다.
//   반대로 살아있는 발행을 잘못 FAILED로 만들면 중복 게시·수동 확인 비용이 든다 — 여유 쪽으로 기울인다.
// ★ 동반 조정 대상: `HTTP_TIMEOUT_MS`·`CONTAINER_POLL_TIMEOUT_MS`·`REEL_POLL_TIMEOUT_MS`(lib/instagram/publish.ts),
//   유튜브 업로드 `HTTP_TIMEOUT_MS`(lib/youtube/upload.ts), 캐러셀 최대 장수(현재 10장) 중 **어느 하나라도 올리면
//   이 컷오프도 함께 올려야 한다**. 안 올리면 정상 발행이 실행 중에 회수된다.
//
// ★ 절대 QUEUED로 되돌리지 않는다(중복 게시 방지):
//   프로세스가 끊긴 시점에 플랫폼에는 **이미 올라갔을 수 있다**(7/22 건은 안 올라갔지만 보장할 수 없다.
//   컨테이너 publish 호출 직후 응답을 못 받고 죽는 창이 실제로 존재한다).
//   QUEUED로 돌리면 다음 주기가 자동 재발행 → 같은 게시물이 두 번 올라간다.
//   따라서 정본은 **FAILED + 안내 문구 + 운영자 경보**이고, 재발행 여부는 사람이 계정을 확인한 뒤 결정한다.
import { IgPostStatus, YtShortStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/lib/availability";
import { writeAuditLog } from "@/lib/audit-log";
import { notifyMarketing } from "@/lib/marketing-notify";

/** PUBLISHING 45분 초과 = 고아. 발행 경로 fetch 타임아웃 합(캐러셀 10장 최악 ≈23분)의 약 2배 — 위 주석 참조. */
export const PUBLISH_ORPHAN_TIMEOUT_MS = 45 * 60 * 1000;

/** 회수 행의 failReason — 운영자 행동 지시가 곧 문구다(자동 재발행 없음). */
export const PUBLISH_ORPHAN_FAIL_REASON =
  "발행 중 중단(고아 자동 회수) — 계정에서 실제 발행 여부를 확인한 뒤 재발행하세요.";

export interface ReapStalePublishingResult {
  /** FAILED로 회수한 InstagramPost 건수 */
  instagram: number;
  /** FAILED로 회수한 YoutubeShort 건수 */
  youtube: number;
}

/**
 * stale PUBLISHING 회수 — InstagramPost·YoutubeShort 두 모델을 FAILED로 되돌리고 운영자에게 경보한다.
 *
 * - 회수는 `updateMany({ where: { id, status: PUBLISHING, updatedAt < cutoff } })` 원자 조건부 갱신이다.
 *   count 0 = 방금 다른 실행이 성공(PUBLISHED)시켰거나 상태가 바뀐 행 → **덮어쓰지 않고 감사로그도 남기지 않는다.**
 * - 알림은 회수분이 있을 때만, 모델별로 기존 kind(IG_PUBLISH_FAILED / YT_PUBLISH_FAILED)를 재사용한다
 *   (새 MarketingAlertKind·NotificationType enum 추가 금지 — enum 드리프트 함정).
 * - ★ 모델별로 `회수 → 경보`가 각각 격리된다(QA 지적 F3). 예전엔 IG를 3건 회수한 뒤 유튜브 축이나 감사로그가
 *   throw하면 함수 전체가 터져 **행은 이미 FAILED인데 경보가 한 번도 안 나가는** 조용한 유실이 났다
 *   (다음 주기엔 PUBLISHING이 아니라 재감지도 안 된다). 이제 한쪽 축의 실패는 다른 축을 막지 않고,
 *   축이 중간에 실패해도 그때까지 회수한 건수만큼은 반드시 경보가 나간다.
 * - 알림 실패도 try/catch로 격리한다. DB 오류는 콘솔에 남기고 카운트에서 제외한다(호출부 cron은 200 유지).
 */
export async function reapStalePublishing(db: DbClient = prisma): Promise<ReapStalePublishingResult> {
  const cutoff = new Date(Date.now() - PUBLISH_ORPHAN_TIMEOUT_MS);

  // 축 순서는 무관 — 서로 완전히 독립이다(앞 축이 터져도 뒤 축은 돈다).
  const instagram = await runAxis({
    label: "instagram",
    kind: "IG_PUBLISH_FAILED",
    what: "인스타 발행",
    href: "/marketing/instagram",
    db,
    reap: (counter) => reapInstagram(db, cutoff, counter),
  });
  const youtube = await runAxis({
    label: "youtube",
    kind: "YT_PUBLISH_FAILED",
    what: "유튜브 쇼츠 업로드",
    href: "/marketing/youtube",
    db,
    reap: (counter) => reapYoutube(db, cutoff, counter),
  });

  return { instagram, youtube };
}

/** 회수 건수 누적기 — 축이 도중에 throw해도 그때까지의 회수분을 잃지 않으려고 참조로 전달한다. */
interface ReapCounter {
  reaped: number;
}

/**
 * 한 모델 축의 `회수 → 경보`를 격리 실행하고 회수 건수를 돌려준다.
 * 회수 중 오류가 나도 **이미 회수된 건수만큼은 경보를 보낸다**(행은 FAILED로 바뀐 뒤라 재감지가 안 되므로).
 */
async function runAxis(params: {
  label: string;
  kind: "IG_PUBLISH_FAILED" | "YT_PUBLISH_FAILED";
  what: string;
  href: string;
  db: DbClient;
  reap: (counter: ReapCounter) => Promise<void>;
}): Promise<number> {
  const counter: ReapCounter = { reaped: 0 };
  try {
    await params.reap(counter);
  } catch (e) {
    console.error(
      `[reap-stale-publishing] ${params.label} 회수 중 오류(회수분 ${counter.reaped}건은 경보 발송):`,
      e instanceof Error ? e.message : String(e)
    );
  }
  // 경보는 회수분이 있을 때만. 모델별로 나눠 보내 운영자가 어느 큐를 열지 바로 알게 한다.
  if (counter.reaped > 0) {
    await notifySafely({
      kind: params.kind,
      count: counter.reaped,
      what: params.what,
      href: params.href,
      db: params.db,
    });
  }
  return counter.reaped;
}

/** InstagramPost: PUBLISHING 고아 → FAILED. 회수 건수는 counter에 누적(중간 실패 시에도 보존). */
async function reapInstagram(db: DbClient, cutoff: Date, counter: ReapCounter): Promise<void> {
  const orphans = await db.instagramPost.findMany({
    where: { status: IgPostStatus.PUBLISHING, updatedAt: { lt: cutoff } },
    select: { id: true },
  });

  for (const { id } of orphans) {
    const res = await db.instagramPost.updateMany({
      // 조회~갱신 사이에 발행이 성공했을 수 있다. status 조건이 그 행을 지켜준다.
      where: { id, status: IgPostStatus.PUBLISHING, updatedAt: { lt: cutoff } },
      data: { status: IgPostStatus.FAILED, failReason: PUBLISH_ORPHAN_FAIL_REASON },
    });
    if (res.count === 0) continue; // 방금 바뀐 행 — 건드리지 않았으므로 감사로그도 없다.
    counter.reaped++;
    await writeAuditLog({
      userId: null,
      action: "UPDATE",
      entity: "InstagramPost",
      entityId: id,
      changes: {
        status: { old: "PUBLISHING", new: "FAILED" },
        failReason: { new: PUBLISH_ORPHAN_FAIL_REASON },
      },
      db,
    });
  }
}

/**
 * YoutubeShort: 발행 축(status) PUBLISHING 고아 → FAILED. 편집 축(editJobStatus)은 건드리지 않는다.
 * 회수 건수는 counter에 누적(중간 실패 시에도 보존).
 */
async function reapYoutube(db: DbClient, cutoff: Date, counter: ReapCounter): Promise<void> {
  const orphans = await db.youtubeShort.findMany({
    where: { status: YtShortStatus.PUBLISHING, updatedAt: { lt: cutoff } },
    select: { id: true },
  });

  for (const { id } of orphans) {
    const res = await db.youtubeShort.updateMany({
      where: { id, status: YtShortStatus.PUBLISHING, updatedAt: { lt: cutoff } },
      data: { status: YtShortStatus.FAILED, failReason: PUBLISH_ORPHAN_FAIL_REASON },
    });
    if (res.count === 0) continue;
    counter.reaped++;
    await writeAuditLog({
      userId: null,
      action: "UPDATE",
      entity: "YoutubeShort",
      entityId: id,
      changes: {
        status: { old: "PUBLISHING", new: "FAILED" },
        failReason: { new: PUBLISH_ORPHAN_FAIL_REASON },
      },
      db,
    });
  }
}

/** 고아 회수 경보(인앱 + Zalo 그룹). 알림 실패는 본 처리와 무관하게 삼킨다(편집 축 notifyEditFailed 패턴). */
async function notifySafely(params: {
  kind: "IG_PUBLISH_FAILED" | "YT_PUBLISH_FAILED";
  count: number;
  what: string;
  href: string;
  db: DbClient;
}): Promise<void> {
  try {
    await notifyMarketing({
      kind: params.kind,
      summary:
        `${params.what} ${params.count}건이 중단된 채 남아 있어 자동 회수(FAILED)했습니다. ` +
        `계정에서 실제 발행 여부를 확인한 뒤 재발행하세요(자동 재발행은 중복 게시 위험이라 하지 않습니다).`,
      href: params.href,
      db: params.db,
    });
  } catch {
    /* 알림 실패는 본 처리 무관 */
  }
}
