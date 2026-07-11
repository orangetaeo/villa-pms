import { prisma } from "@/lib/prisma";
import { markOverdueReceivables } from "@/lib/partner-booking";
import { notifyPartner } from "@/lib/partner-notify";
import { receivableOutstanding } from "@/lib/partner";
import { verifyCronAuth } from "@/lib/cron-auth";

/**
 * 파트너 미수 연체 전이 cron (ADR-0022 PARTNER-3 — 1일 1회 권장, Railway cron 등록은 OPS)
 * 기한(dueDate) 경과한 미입금(PENDING/PARTIAL) 채권 → OVERDUE.
 * 연체 상태는 신용 게이트(hasOverdue)·대시보드 표시·자동 제재의 기준.
 * 인증: Authorization: Bearer ${CRON_SECRET} — expire-holds·ical-sync 동일 패턴
 */

export const dynamic = "force-dynamic";

async function handle(req: Request) {
  const auth = verifyCronAuth(req, "partner-overdue");
  if (!auth.ok) return Response.json(auth.body, { status: auth.status });

  try {
    const now = new Date();
    // 전이 "직전" 대상 스냅샷 — 새로 연체되는 채권만 파트너에게 통지(멱등: 이미 OVERDUE는 제외됨).
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );
    const becomingOverdue = await prisma.partnerReceivable.findMany({
      where: { status: { in: ["PENDING", "PARTIAL"] }, dueDate: { lt: today } },
      select: {
        partnerId: true,
        totalVnd: true,
        depositPaidVnd: true,
        balancePaidVnd: true,
        status: true,
        dueDate: true,
      },
    });

    const overdueCount = await markOverdueReceivables(prisma, now);
    if (overdueCount > 0) {
      console.log(`[cron/partner-overdue] ${overdueCount}건 연체 전이`);

      // 파트너별 1건으로 묶어 통지 (T-partner-workflow-gaps ①) — 실패해도 cron 결과에 무영향.
      const byPartner = new Map<string, { count: number; outstanding: bigint }>();
      for (const r of becomingOverdue) {
        const cur = byPartner.get(r.partnerId) ?? { count: 0, outstanding: 0n };
        cur.count += 1;
        cur.outstanding += receivableOutstanding(r);
        byPartner.set(r.partnerId, cur);
      }
      for (const [partnerId, agg] of byPartner) {
        await notifyPartner(partnerId, {
          kind: "RECEIVABLE_OVERDUE",
          count: agg.count,
          outstandingVnd: agg.outstanding.toString(),
        });
      }
    }
    return Response.json({ overdueCount });
  } catch (e) {
    console.error("[cron/partner-overdue] 연체 전이 실패", e);
    return Response.json({ error: "연체 전이에 실패했습니다" }, { status: 500 });
  }
}

export { handle as GET, handle as POST };
