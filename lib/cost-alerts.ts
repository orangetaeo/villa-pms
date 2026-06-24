// 견적 중 원가 변경 경보 로더 (b15, F) — 운영자(ADMIN) 전용
//
// RATE_CHANGED_DURING_PROPOSAL Notification(payload: villaId·villaName·season·old/newCostVnd·proposalId)을
// 읽어 제안별로 묶고, 영향받는 ProposalItem과 현재 VillaRate를 조인해 마진 영향을 산출한다.
//
// 마진 단일 소스(QA 교정): "현재 판매가"는 VillaRate.salePriceVnd(VND 고정 기준)를 사용하고,
//   판매가를 유지할 때의 마진을 old/new 원가로 각각 계산한다 → 마진율 18.5%/18% 불일치 제거.
//   margin% = (salePriceVnd − costVnd) / salePriceVnd  (정수 퍼센트, 소수 1자리).
//
// 마진·판매가·KRW 노출은 운영자 화면에서만 정당(공급자·공개 화면에는 절대 이 로더 사용 금지).
import type { PrismaClient } from "@prisma/client";
import { NotificationType, ProposalStatus } from "@prisma/client";

export interface CostAlertRow {
  /** 알림 id (확인 처리용) */
  notificationId: string;
  villaId: string;
  villaName: string;
  season: "LOW" | "HIGH" | "PEAK";
  oldCostVnd: string; // 동 단위 문자열
  newCostVnd: string | null; // 삭제면 null
  deltaVnd: string; // new − old (음수 가능, "−"/"+" 부호는 표시단에서)
  /** 영향 ProposalItem 존재 시 현재 판매가(VND 기준) — 없으면 null */
  salePriceVnd: string | null;
  /** 판매가 유지 가정 마진율 (소수 1자리 문자열) — 판매가 없으면 null */
  oldMarginPct: string | null;
  newMarginPct: string | null;
  /** 권장 조치: 마진 하락 또는 삭제 → adjust, 그 외 keep */
  recommend: "adjust" | "keep";
}

export interface CostAlertGroup {
  proposalId: string;
  proposalToken: string;
  clientName: string;
  saleCurrency: "KRW" | "VND";
  detectedAt: string; // ISO — 가장 최근 알림 시각
  notificationIds: string[]; // 그룹 전체 확인 처리용
  rows: CostAlertRow[];
}

interface RatePayload {
  villaId: string;
  villaName: string;
  season: "LOW" | "HIGH" | "PEAK";
  oldCostVnd: string;
  newCostVnd: string | null;
  proposalId: string;
}

/** (sale − cost)/sale 를 소수 1자리 퍼센트 문자열로 — BigInt 정수 연산(×1000 후 반올림) */
function marginPct(saleVnd: bigint, costVnd: bigint): string | null {
  if (saleVnd <= 0n) return null;
  // permille = (sale - cost) * 1000 / sale  (음수 마진 허용)
  const diff = saleVnd - costVnd;
  // 반올림: 부호 고려
  const scaled = diff * 1000n;
  const q = scaled / saleVnd;
  const r = scaled % saleVnd;
  let permille = q;
  const twiceRem = (r < 0n ? -r : r) * 2n;
  if (twiceRem >= saleVnd) permille += diff >= 0n ? 1n : -1n;
  // permille → 퍼센트 소수 1자리 (예: 185 → "18.5")
  const neg = permille < 0n;
  const abs = neg ? -permille : permille;
  const whole = abs / 10n;
  const frac = abs % 10n;
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

/**
 * 현재 ADMIN 사용자의 미처리(PENDING) 원가 변경 경보를 제안별로 묶어 반환.
 * - status: PENDING 만(이미 확인 처리=SENT 한 것은 제외) → 확인 후 사라지는 UX.
 * - 제안이 더 이상 ACTIVE가 아니면 표시 제외(만료·사용·회수된 제안은 노이즈).
 */
export async function loadCostAlerts(
  prisma: PrismaClient,
  adminUserId: string
): Promise<CostAlertGroup[]> {
  const notifs = await prisma.notification.findMany({
    where: {
      userId: adminUserId,
      type: NotificationType.RATE_CHANGED_DURING_PROPOSAL,
      status: "PENDING",
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, payload: true, createdAt: true },
  });
  if (notifs.length === 0) return [];

  // payload 파싱 + proposalId 수집
  const parsed = notifs
    .map((n) => {
      const p = n.payload as unknown as RatePayload | null;
      // 방어: season·oldCostVnd 없는 payload(예: 기간별 원가 일괄변경의 비호환 형태)는 건너뜀
      //  — 없으면 아래 BigInt(p.oldCostVnd)가 throw해 경보 페이지·대시보드 배너가 통째로 깨진다.
      if (
        !p ||
        typeof p.proposalId !== "string" ||
        typeof p.villaId !== "string" ||
        typeof p.season !== "string" ||
        typeof p.oldCostVnd !== "string"
      )
        return null;
      return { id: n.id, createdAt: n.createdAt, p };
    })
    .filter((x): x is { id: string; createdAt: Date; p: RatePayload } => x !== null);
  if (parsed.length === 0) return [];

  const proposalIds = Array.from(new Set(parsed.map((x) => x.p.proposalId)));

  // ACTIVE 제안 + 영향 항목 + 현재 VillaRate(salePriceVnd) 조인
  const proposals = await prisma.proposal.findMany({
    where: { id: { in: proposalIds }, status: ProposalStatus.ACTIVE },
    select: {
      id: true,
      token: true,
      clientName: true,
      saleCurrency: true,
      items: { select: { villaId: true } },
    },
  });
  const proposalMap = new Map(proposals.map((p) => [p.id, p]));

  // 영향 villa의 현재 시즌 판매가 조회 (villaId+season 쌍)
  const villaSeasonKeys = Array.from(
    new Set(parsed.map((x) => `${x.p.villaId}::${x.p.season}`))
  );
  const rates = await prisma.villaRate.findMany({
    where: {
      OR: villaSeasonKeys.map((k) => {
        const [villaId, season] = k.split("::");
        return { villaId, season: season as "LOW" | "HIGH" | "PEAK" };
      }),
    },
    select: { villaId: true, season: true, salePriceVnd: true },
  });
  const rateMap = new Map(rates.map((r) => [`${r.villaId}::${r.season}`, r.salePriceVnd]));

  // 제안별 그룹 구성
  const groups = new Map<string, CostAlertGroup>();
  for (const { id, createdAt, p } of parsed) {
    const proposal = proposalMap.get(p.proposalId);
    if (!proposal) continue; // ACTIVE 아님 → 제외

    const oldCost = BigInt(p.oldCostVnd);
    const newCost = p.newCostVnd == null ? null : BigInt(p.newCostVnd);
    const delta = (newCost ?? 0n) - oldCost;

    const salePrice = rateMap.get(`${p.villaId}::${p.season}`) ?? null;
    const oldMargin = salePrice != null ? marginPct(salePrice, oldCost) : null;
    const newMargin =
      salePrice != null && newCost != null ? marginPct(salePrice, newCost) : null;

    // 권장 조치: 삭제(newCost null) 또는 원가 상승(마진 하락) → 조정, 원가 하락/동일 → 유지
    const recommend: "adjust" | "keep" =
      newCost == null || newCost > oldCost ? "adjust" : "keep";

    const row: CostAlertRow = {
      notificationId: id,
      villaId: p.villaId,
      villaName: p.villaName,
      season: p.season,
      oldCostVnd: oldCost.toString(),
      newCostVnd: newCost == null ? null : newCost.toString(),
      deltaVnd: delta.toString(),
      salePriceVnd: salePrice == null ? null : salePrice.toString(),
      oldMarginPct: oldMargin,
      newMarginPct: newMargin,
      recommend,
    };

    let group = groups.get(p.proposalId);
    if (!group) {
      group = {
        proposalId: proposal.id,
        proposalToken: proposal.token,
        clientName: proposal.clientName,
        saleCurrency: proposal.saleCurrency as "KRW" | "VND",
        detectedAt: createdAt.toISOString(),
        notificationIds: [],
        rows: [],
      };
      groups.set(p.proposalId, group);
    }
    group.notificationIds.push(id);
    group.rows.push(row);
    // 최신 감지 시각 유지 (notifs는 desc 정렬이므로 첫 값이 최신)
    if (createdAt.toISOString() > group.detectedAt) group.detectedAt = createdAt.toISOString();
  }

  return Array.from(groups.values());
}

/** 경보 배지 개수 — 대시보드 배너용 (PENDING 제안 그룹 수) */
export async function countCostAlertGroups(
  prisma: PrismaClient,
  adminUserId: string
): Promise<number> {
  const groups = await loadCostAlerts(prisma, adminUserId);
  return groups.length;
}
