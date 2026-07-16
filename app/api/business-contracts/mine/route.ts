// GET /api/business-contracts/mine — 상대방(SUPPLIER/VENDOR/PARTNER) 자기 계약 조회 (T-business-contract-esign)
//   status SENT|SIGNED만. 응답 = 상태·locale·렌더된 본문(SENT=서명란 공백, SIGNED=서명 정보 포함)·
//   signedAt·signatureUrl(SIGNED 본인 것만). DRAFT·VOID·타인 것 미노출.
// ★ 누수: termsJson 원시값·타 계약·마진 미노출. 렌더된 본문(정본 md)만 반환.
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { isCounterpartRole, renderContractForCounterpart, isContractType } from "@/lib/business-contract";

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
      return {
        id: r.id,
        type: r.type,
        status: r.status,
        standardVersion: r.standardVersion,
        locale: r.locale,
        body,
        bodyError,
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
