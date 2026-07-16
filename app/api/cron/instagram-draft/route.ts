// 인스타그램 초안 생성 cron (instagram-marketing-p1, 기획 §3-4)
// 인증: Authorization: Bearer ${CRON_SECRET} — verifyCronAuth(타 cron 동일 패턴, 첫 줄 게이트).
// 흐름: 빌라 로테이션 3곳 → 공간 다양성 사진 → 캐러셀 렌더(R2) → Gemini 캡션(카피가이드 주입·금칙어 가드)
//   → InstagramPost 3건 PENDING_APPROVAL(슬롯 07:30/12:30/20:00 KST) → 운영자 인앱 알림 + AuditLog.
//
// ★ 누수 0: 빌라 select는 공개 정보만(lib/instagram/draft VILLA_SELECT). 캡션 입력도 공개 정보만.
// ★ 운영자 알림: enqueueInAppForOperators(db-backup 패턴) — NotificationType enum 추가 없이 인앱 벨로 통지.
import { IgPostStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";
import { writeAuditLog } from "@/lib/audit-log";
import { enqueueInAppForOperators } from "@/lib/inapp-notification";
import {
  selectVillasForRotation,
  planVillaDraft,
  computeSlotSchedule,
  generateCaption,
} from "@/lib/instagram/draft";
import { renderCarousel } from "@/lib/instagram/render";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 3곳 × 캐러셀 렌더 + Gemini — 여유 상한

const CREATED_BY = "cron:instagram-draft";
const POSTS_PER_RUN = 3;

async function handle(req: Request) {
  const auth = verifyCronAuth(req, "instagram-draft");
  if (!auth.ok) return Response.json(auth.body, { status: auth.status });

  const now = new Date();
  const slots = computeSlotSchedule(now); // 길이 3, 순서=아침·점심·저녁
  const villas = await selectVillasForRotation(POSTS_PER_RUN);

  if (villas.length === 0) {
    return Response.json({ status: "ok", created: 0, note: "적격 빌라 없음(ACTIVE·isSellable·사진4장↑)" });
  }

  const created: { id: string; villaId: string; flagged: string[] }[] = [];
  const failures: { villaId: string; reason: string }[] = [];

  for (let i = 0; i < villas.length; i++) {
    const villa = villas[i];
    const scheduledAt = slots[i % slots.length];
    try {
      const plan = planVillaDraft(villa);

      // 1) 캡션(Gemini + 카피가이드 주입, 금칙어 가드) — villaId·슬롯 무관 순수 공개정보.
      const caption = await generateCaption(plan.publicInfo, "VILLA_SHOWCASE");

      // 2) 캐러셀 렌더 → R2 업로드.
      const baseName = `${villa.id}-${scheduledAt.toISOString().slice(0, 10)}-${i}`;
      const rendered = await renderCarousel(plan.slides, baseName);

      // 3) InstagramPost(PENDING_APPROVAL) 생성. flaggedTerms 있으면 승인화면 경고용으로 기록.
      const post = await prisma.instagramPost.create({
        data: {
          villaId: villa.id,
          kind: "VILLA_SHOWCASE",
          status: IgPostStatus.PENDING_APPROVAL,
          scheduledAt,
          caption: caption.caption,
          mediaJson: rendered as unknown as Prisma.InputJsonValue,
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
          kind: { new: "VILLA_SHOWCASE" },
          scheduledAt: { new: scheduledAt.toISOString() },
          slideCount: { new: rendered.length },
          usedGemini: { new: caption.usedGemini },
          flaggedTerms: { new: caption.flaggedTerms },
        },
      });

      created.push({ id: post.id, villaId: villa.id, flagged: caption.flaggedTerms });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      console.error(`[cron/instagram-draft] 빌라 ${villa.id} 초안 실패:`, reason);
      failures.push({ villaId: villa.id, reason });
    }
  }

  // 운영자 인앱 알림(생성분이 있을 때만). 적재 실패는 격리(본 흐름 무영향).
  if (created.length > 0) {
    const flaggedCount = created.filter((c) => c.flagged.length > 0).length;
    try {
      await enqueueInAppForOperators({
        type: "IG_DRAFTS_READY",
        title: "인스타 초안 승인 대기",
        body:
          `오늘 인스타 초안 ${created.length}건이 생성되었습니다.` +
          (flaggedCount > 0 ? ` (금칙어 경고 ${flaggedCount}건 — 확인 필요)` : "") +
          `\n승인 전에는 발행되지 않습니다.`,
        href: "/marketing/instagram",
      });
    } catch (e) {
      console.error("[cron/instagram-draft] 운영자 알림 적재 실패:", e instanceof Error ? e.message : String(e));
    }
  }

  return Response.json({
    status: "ok",
    created: created.length,
    failed: failures.length,
    flagged: created.filter((c) => c.flagged.length > 0).length,
    failures,
  });
}

export { handle as GET, handle as POST };
