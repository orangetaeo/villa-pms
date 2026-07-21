import { prisma } from "@/lib/prisma";
import { fetchUserProfile } from "@/lib/zalo-runtime";

/**
 * [일회성 유지보수] 봇 소유자 이름으로 잘못 저장된 1:1 대화명 교정.
 *
 * 과거 OUTBOUND 셀프에코의 data.dName(=발신자=봇 소유자 이름)이 상대 대화명으로 잘못 심겼다
 * ("내가 먼저 연 대화"가 전부 소유자 이름으로 생성). 코드 수정(zalo-runtime)은 앞으로를 막지만,
 * 이미 박힌 대화는 이 함수로 라이브 봇 세션(getUserInfo)에서 실제 상대 표시명으로 즉시 교정한다.
 *
 * ★ 반드시 **세션 보유 프로세스**에서 실행해야 한다(getApiForAdmin 필요).
 *   프로덕션은 ZALO_SESSION_LOCAL=false라 세션은 zalo-worker가 보유 → 워커에서 호출.
 *   세션 없는 프로세스에서 돌리면 fetchUserProfile가 전부 null → unresolved만 쌓인다.
 *
 * 대상(USER 1:1만): displayName이 비었거나 정확히 그 대화 소유자의 봇 이름과 일치.
 *   운영자 수동 nickname은 표시에 우선하고 별도 컬럼이라 보존(displayName 원본만 교정).
 * 안전: 순차 + 호출 간 지연(레이트리밋 회피), 건별 try/catch.
 */
export interface RefreshNamesSummary {
  scannedUser: number;
  targeted: number;
  fixed: number;
  unresolved: number;
  skippedSameAsOwner: number;
  errors: number;
  dryRun: boolean;
  limit: number;
}

const DELAY_MS = 300;

export async function refreshOwnerNamedConvos(opts: {
  limit?: number;
  dryRun?: boolean;
}): Promise<RefreshNamesSummary> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const dryRun = opts.dryRun === true;

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
    if (!dn) return true;
    const own = namesByOwner.get(c.ownerAdminId);
    return !!own && own.has(dn);
  });

  const summary: RefreshNamesSummary = {
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
        summary.unresolved++;
      }
    } catch {
      summary.errors++;
    }
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  return summary;
}
