// GET /api/business-contracts/mine — 상대방(SUPPLIER/VENDOR/PARTNER) 자기 계약 조회 (T-business-contract-esign)
//   status SENT|SIGNED만. 응답 = 상태·locale·렌더된 본문(SENT=서명란 공백, SIGNED=서명 정보 포함)·
//   signedAt·signatureUrl(SIGNED 본인 것만). DRAFT·VOID·타인 것 미노출.
// ★ 누수: termsJson 원시값·타 계약·마진 미노출. 렌더된 본문(정본 md)만 반환.
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { isCounterpartRole, renderContractForCounterpart, isContractType } from "@/lib/business-contract";
import { DEFAULT_CANCEL_TIERS, readCancelTiers } from "@/lib/cancel-tiers";

export async function GET(req: Request) {
  const g = await requireAuth(req);
  if (!g.ok) return g.response;
  const { userId, role } = g;

  // 계약 상대방(SUPPLIER/VENDOR/PARTNER)만 — 운영자·기타 role은 빈 목록(자기 계약 개념 없음).
  if (!isCounterpartRole(role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const rows = await prisma.businessContract.findMany({
    where: { counterpartId: userId, status: { in: ["SENT", "SIGNED"] } },
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      type: true,
      status: true,
      standardVersion: true,
      locale: true,
      termsJson: true,
      counterpartSignName: true,
      counterpartIdNumber: true,
      counterpartAddress: true,
      signatureUrl: true,
      signedAt: true,
      sentAt: true,
    },
  });

  // 협의 이력(S2) — 자기 계약 것만. 서명 게이트(OPEN 존재)와 회신 사유 표시에 쓴다.
  //   ★ proposedJson(역제안 원본)은 미반환 — 화면에 필요 없고, 응답 표면을 넓히지 않는다.
  const negotiations = rows.length
    ? await prisma.contractNegotiation.findMany({
        where: { contractId: { in: rows.map((r) => r.id) } },
        orderBy: [{ createdAt: "desc" }],
        select: {
          id: true,
          contractId: true,
          clauseKey: true,
          reason: true,
          status: true,
          note: true,
          resolvedNote: true,
          createdAt: true,
          resolvedAt: true,
        },
      })
    : [];

  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, phone: true, zaloContact: true },
  });
  const user = { name: me?.name ?? "", phone: me?.phone ?? null, zaloContact: me?.zaloContact ?? null };

  const contracts = await Promise.all(
    rows.map(async (r) => {
      const isSigned = r.status === "SIGNED";
      let body: string | null = null;
      let bodyError: string | null = null;
      if (isContractType(r.type)) {
        try {
          body = await renderContractForCounterpart(
            {
              type: r.type,
              locale: r.locale,
              termsJson: r.termsJson,
              counterpartIdNumber: r.counterpartIdNumber,
              counterpartAddress: r.counterpartAddress,
              signedAt: r.signedAt,
            },
            user,
            { includeSignature: isSigned },
          );
        } catch {
          // 정본 md 부재(LOC 병렬 작성 중) 등 — 본문 대신 상태만 노출(페이지가 "준비 중" 처리).
          bodyError = "TEMPLATE_UNAVAILABLE";
        }
      }
      const mine = negotiations.filter((n) => n.contractId === r.id);
      return {
        id: r.id,
        type: r.type,
        status: r.status,
        standardVersion: r.standardVersion,
        locale: r.locale,
        body,
        bodyError,
        // 협의(S2) — hasOpen이면 서명 폼 대신 "협의 진행 중" 안내를 띄운다(서버 sign 라우트도 409로 막음).
        negotiations: mine.map((n) => ({
          id: n.id,
          clauseKey: n.clauseKey,
          reason: n.reason,
          status: n.status,
          note: n.note,
          resolvedNote: n.resolvedNote,
          createdAt: n.createdAt,
          resolvedAt: n.resolvedAt,
        })),
        hasOpenNegotiation: mine.some((n) => n.status === "OPEN"),
        // 취소 단계표 역제안 편집기의 시작값(빌라 공급만). 이미 렌더 본문 별표2에 그대로 보이는
        // 정보라 새로운 노출이 아니다 — 비율만, 금액·원가·마진 없음. 레거시 계약은 기본 프리셋.
        cancelTiers:
          r.type === "VILLA_SUPPLY"
            ? readCancelTiers((r.termsJson as { cancelTiers?: unknown } | null)?.cancelTiers) ??
              DEFAULT_CANCEL_TIERS
            : null,
        // 서명 정보는 SIGNED일 때만 노출.
        signName: isSigned ? r.counterpartSignName : null,
        signedAt: isSigned ? r.signedAt : null,
        signatureUrl: isSigned ? r.signatureUrl : null,
        sentAt: r.sentAt,
      };
    }),
  );

  return NextResponse.json({ contracts });
}
