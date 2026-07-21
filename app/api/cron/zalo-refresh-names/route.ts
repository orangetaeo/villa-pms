import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";
import { fetchUserProfile } from "@/lib/zalo-runtime";

/**
 * [일회성 유지보수 cron] Zalo 대화명 보정 — 봇 소유자 이름으로 잘못 저장된 1:1 대화 교정.
 *
 * 배경: 과거 OUTBOUND 셀프에코의 data.dName(=발신자=봇 소유자 이름)이 상대 대화명으로 잘못
 * 심겼다("내가 먼저 연 대화"가 전부 소유자 이름으로 생성). 코드 수정(zalo-runtime)은 앞으로를
 * 막지만, 이미 잘못 박힌 기존 대화는 아바타 TTL(7일)·재연결 백필을 기다려야 자동 교정된다.
 * 이 엔드포인트는 그 대기 없이 **지금 즉시** 라이브 봇 세션(getApiForAdmin, 프로덕션 프로세스 내)으로
 * getUserInfo를 호출해 실제 상대 표시명으로 교정한다. 새 Zalo 세션을 만들지 않아 프로덕션 소켓에 무해.
 *
 * 대상(USER 1:1만): displayName이 비었거나 **정확히 그 대화 소유자의 봇 이름**일 때.
 *   (운영자 수동 nickname은 표시에 우선하고 별도 컬럼이라 보존 — displayName만 원본 교정)
 * 안전장치: 순차 + 호출 간 지연(레이트리밋 회피), limit 기본 100, 건별 try/catch.
 */
export const dynamic = "force-dynamic";

const DELAY_MS = 300;

async function handle(req: Request) {
  const auth = verifyCronAuth(req, "zalo-refresh-names");
  if (!auth.ok) return Response.json(auth.body, { status: auth.status });

  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 500);
  const dryRun = url.searchParams.get("dryRun") === "1";

  try {
    // 소유자별 봇 이름 맵 — 한 소유자에 개인·시스템 계정이 있으면 이름 여러 개.
    const accounts = await prisma.zaloAccount.findMany({
      select: { userId: true, displayName: true },
    });
    const namesByOwner = new Map<string, Set<string>>();
    for (const a of accounts) {
      const dn = (a.displayName ?? "").trim();
      if (!dn) continue;
      if (!namesByOwner.has(a.userId)) namesByOwner.set(a.userId, new Set());
      namesByOwner.get(a.userId)!.add(dn);
    }

    // USER 대화 전수 조회 후, "비었거나 소유자 봇 이름과 일치"만 대상으로 필터.
    const convos = await prisma.zaloConversation.findMany({
      where: { threadType: "USER" },
      select: { id: true, ownerAdminId: true, zaloUserId: true, displayName: true },
      orderBy: { lastMessageAt: "desc" },
    });
    const targets = convos.filter((c) => {
      const dn = (c.displayName ?? "").trim();
      if (!dn) return true; // 비어있음 — 이름 채움
      const own = namesByOwner.get(c.ownerAdminId);
      return !!own && own.has(dn); // 정확히 그 소유자의 봇 이름 — 오심 교정
    });

    const summary = {
      scannedUser: convos.length,
      targeted: targets.length,
      fixed: 0,
      unresolved: 0,
      skippedSameAsOwner: 0,
      errors: 0,
      dryRun,
      limit,
    };

    for (const c of targets.slice(0, limit)) {
      try {
        const ownerNames = namesByOwner.get(c.ownerAdminId);
        const profile = await fetchUserProfile(c.ownerAdminId, c.zaloUserId);
        const name = profile?.name?.trim() || null;
        // 실제 상대명을 얻었고, 그게 소유자 봇 이름이 아닐 때만 교정.
        if (name && !(ownerNames && ownerNames.has(name))) {
          if (!dryRun) {
            await prisma.zaloConversation.update({
              where: { id: c.id },
              data: {
                displayName: name,
                ...(profile?.avatar ? { avatarUrl: profile.avatar } : {}),
                avatarFetchedAt: new Date(),
              },
            });
          }
          summary.fixed++;
        } else if (name) {
          summary.skippedSameAsOwner++;
        } else {
          summary.unresolved++; // 프라이버시 제한·조회 실패 — 다음 기회에 재시도
        }
      } catch {
        summary.errors++;
      }
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }

    console.log("[cron/zalo-refresh-names]", JSON.stringify(summary));
    return Response.json(summary);
  } catch (e) {
    console.error("[cron/zalo-refresh-names] 실패", e);
    return Response.json({ error: "대화명 보정에 실패했습니다" }, { status: 500 });
  }
}

export { handle as GET, handle as POST };
