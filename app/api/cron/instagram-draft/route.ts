// 인스타그램 초안 생성 cron (instagram-marketing-p1, 기획 §3-4)
// 인증: Authorization: Bearer ${CRON_SECRET} — verifyCronAuth(타 cron 동일 패턴, 첫 줄 게이트).
// 흐름: 빌라 로테이션 3곳 → 공간 다양성 사진 → 캐러셀 렌더(R2) → Gemini 캡션(카피가이드 주입·금칙어 가드)
//   → InstagramPost 3건 PENDING_APPROVAL(슬롯 07:30/12:30/20:00 KST) → 운영자 인앱 알림 + AuditLog.
//
// ★ 누수 0: 빌라 select는 공개 정보만(lib/instagram/draft VILLA_SELECT). 캡션 입력도 공개 정보만.
// ★ 운영자 알림: notifyMarketing(marketing-s2 §D) — 인앱 벨 + Zalo 그룹 병행(MARKETING_ALERT).
import { IgPostStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";
import { writeAuditLog } from "@/lib/audit-log";
import { notifyMarketing } from "@/lib/marketing-notify";
import {
  selectVillasForRotation,
  planVillaDraft,
  computeSlotSchedule,
  generateCaption,
  getReelsPerWeek,
  isReelDayKst,
  IG_EVENING_SLOT_INDEX,
} from "@/lib/instagram/draft";
import { renderCarousel } from "@/lib/instagram/render";
import { renderAndBuildReel } from "@/lib/instagram/reels";
import { getIgPostsPerVilla } from "@/lib/instagram/settings";
import { getYoutubeShortsPerDay, getYoutubeShortsPerVilla } from "@/lib/youtube/settings";
import { runYoutubeDraftBatch } from "@/lib/youtube/draft";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 3곳 × 캐러셀 렌더 + Gemini — 여유 상한

const CREATED_BY = "cron:instagram-draft";
const POSTS_PER_RUN = 3;

async function handle(req: Request) {
  const auth = verifyCronAuth(req, "instagram-draft");
  if (!auth.ok) return Response.json(auth.body, { status: auth.status });

  const now = new Date();
  const slots = computeSlotSchedule(now); // 길이 3, 순서=아침·점심·저녁
  // 빌라당 상한(IG_POSTS_PER_VILLA, 기본 1) — 이미 상한만큼 콘텐츠가 있는 빌라는 후보에서 빠진다.
  //   빌라 재고가 적을 때 같은 빌라 도배 방지. 0으로 두면 인스타 자동 초안 전체 중단.
  const perVillaCap = await getIgPostsPerVilla();
  const villas = await selectVillasForRotation(POSTS_PER_RUN, prisma, perVillaCap);

  // 릴스 게이트: IG_REELS_PER_WEEK≥1 && 오늘이 릴스일이면 저녁 슬롯 포스트만 REELS로 생성(기본 0=끔 → 전부 캐러셀).
  const reelsPerWeek = await getReelsPerWeek();
  const doReelToday = isReelDayKst(now, reelsPerWeek);

  const created: { id: string; villaId: string; kind: string; flagged: string[] }[] = [];
  const failures: { villaId: string; reason: string }[] = [];

  // ★ 적격 빌라 0곳이어도 조기 반환하지 않는다 — 유튜브 배치는 인스타 상한과 무관하게 자기 상한으로 판단해야 한다.
  for (let i = 0; i < villas.length; i++) {
    const villa = villas[i];
    const slotIndex = i % slots.length;
    const scheduledAt = slots[slotIndex];
    try {
      const plan = planVillaDraft(villa);

      // 1) 캡션(Gemini + 카피가이드 주입, 금칙어 가드) — villaId·슬롯 무관 순수 공개정보. 캐러셀·릴스 공용.
      const caption = await generateCaption(plan.publicInfo, "VILLA_SHOWCASE");

      const baseName = `${villa.id}-${scheduledAt.toISOString().slice(0, 10)}-${i}`;

      // 2) 렌더 — 저녁 슬롯 & 릴스일이면 릴스(MP4), 아니면 캐러셀. 릴스 실패 시 캐러셀 폴백(포스트 유실 방지).
      let kind: "VILLA_SHOWCASE" | "REELS" = "VILLA_SHOWCASE";
      let mediaJson: Prisma.InputJsonValue;
      let slideCount: number;

      const wantReel = doReelToday && slotIndex === IG_EVENING_SLOT_INDEX;
      if (wantReel) {
        try {
          const reel = await renderAndBuildReel(plan.slides, baseName, {
            // 오디오=번들 실음원(CC0 밝은 우쿨렐레). 파일 없으면 무음 폴백.
            //   중간 프레임 캡션은 슬라이드(reelCaption, 사진-공간 매칭)에 실려 자동 렌더.
            audio: "bundled",
          });
          kind = "REELS";
          mediaJson = reel.mediaJson as unknown as Prisma.InputJsonValue;
          slideCount = reel.frameCount;
        } catch (reelErr) {
          console.error(
            `[cron/instagram-draft] 빌라 ${villa.id} 릴스 생성 실패 — 캐러셀 폴백:`,
            reelErr instanceof Error ? reelErr.message : String(reelErr)
          );
        }
      }
      if (kind !== "REELS") {
        const rendered = await renderCarousel(plan.slides, baseName);
        mediaJson = rendered as unknown as Prisma.InputJsonValue;
        slideCount = rendered.length;
      }

      // 3) InstagramPost(PENDING_APPROVAL) 생성. flaggedTerms 있으면 승인화면 경고용으로 기록.
      const post = await prisma.instagramPost.create({
        data: {
          villaId: villa.id,
          kind,
          status: IgPostStatus.PENDING_APPROVAL,
          scheduledAt,
          caption: caption.caption,
          mediaJson: mediaJson!,
          flaggedTerms: caption.flaggedTerms.length > 0 ? caption.flaggedTerms : undefined,
          createdBy: CREATED_BY,
        },
        select: { id: true },
      });

      await writeAuditLog({
        userId: null,
        action: "CREATE",
        entity: "InstagramPost",
        entityId: post.id,
        changes: {
          villaId: { new: villa.id },
          kind: { new: kind },
          scheduledAt: { new: scheduledAt.toISOString() },
          slideCount: { new: slideCount! },
          usedGemini: { new: caption.usedGemini },
          flaggedTerms: { new: caption.flaggedTerms },
        },
      });

      created.push({ id: post.id, villaId: villa.id, kind, flagged: caption.flaggedTerms });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      console.error(`[cron/instagram-draft] 빌라 ${villa.id} 초안 실패:`, reason);
      failures.push({ villaId: villa.id, reason });
    }
  }

  // 운영자 알림(생성분이 있을 때만) — 인앱 벨 + Zalo 그룹.
  if (created.length > 0) {
    const flaggedCount = created.filter((c) => c.flagged.length > 0).length;
    await notifyMarketing({
      kind: "IG_DRAFTS_READY",
      summary:
        `오늘 인스타 초안 ${created.length}건이 생성되었습니다.` +
        (flaggedCount > 0 ? ` (금칙어 경고 ${flaggedCount}건 — 확인 필요)` : "") +
        `\n승인 전에는 발행되지 않습니다.`,
      href: "/marketing/instagram",
    });
  }

  // ── 유튜브 쇼츠 자동 초안(youtube-shorts-s1) — YT_SHORTS_PER_DAY≥1일 때만. 0이면 조기 반환(기존 동작 완전 동일). ──
  //   인스타 흐름과 완전 격리(try/catch): 유튜브 실패가 인스타 초안 결과에 영향 주지 않게 함. 실패 시 인앱 경보 YT_DRAFT_FAILED.
  let ytSummary: { created: number; failed: number; flagged: number } | undefined;
  const shortsPerDay = await getYoutubeShortsPerDay();
  if (shortsPerDay >= 1) {
    try {
      // 빌라당 상한(YT_SHORTS_PER_VILLA, 기본 1) — 일 건수 상한과 별개로 빌라 도배를 막는 2차 게이트.
      const ytPerVillaCap = await getYoutubeShortsPerVilla();
      const yt = await runYoutubeDraftBatch(shortsPerDay, now, prisma, ytPerVillaCap);
      const ytFlagged = yt.created.filter((c) => c.flagged.length > 0).length;
      ytSummary = { created: yt.created.length, failed: yt.failures.length, flagged: ytFlagged };

      if (yt.created.length > 0) {
        await notifyMarketing({
          kind: "YT_DRAFTS_READY",
          summary:
            `오늘 유튜브 쇼츠 초안 ${yt.created.length}건이 생성되었습니다.` +
            (ytFlagged > 0 ? ` (금칙어 경고 ${ytFlagged}건 — 확인 필요)` : "") +
            `\n승인 전에는 업로드되지 않습니다.`,
          href: "/marketing/youtube",
        });
      }
      if (yt.failures.length > 0) {
        await notifyMarketing({
          kind: "YT_DRAFT_FAILED",
          summary: `유튜브 쇼츠 초안 ${yt.failures.length}건 생성이 실패했습니다. 로그를 확인하세요.`,
          href: "/marketing/youtube",
        });
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      console.error("[cron/instagram-draft] 유튜브 초안 배치 실패(격리):", reason);
      await notifyMarketing({
        kind: "YT_DRAFT_FAILED",
        summary: "유튜브 쇼츠 초안 배치가 실패했습니다. 로그를 확인하세요.",
        href: "/marketing/youtube",
      });
      ytSummary = { created: 0, failed: 1, flagged: 0 };
    }
  }

  return Response.json({
    status: "ok",
    created: created.length,
    reels: created.filter((c) => c.kind === "REELS").length,
    failed: failures.length,
    flagged: created.filter((c) => c.flagged.length > 0).length,
    failures,
    ...(villas.length === 0
      ? { note: `적격 빌라 없음(ACTIVE·isSellable·사진4장↑·빌라당 상한 ${perVillaCap}건)` }
      : {}),
    ...(ytSummary ? { youtube: ytSummary } : {}),
  });
}

export { handle as GET, handle as POST };
