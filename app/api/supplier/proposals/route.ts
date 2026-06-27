// /api/supplier/proposals — 공급자 직접 판매 링크 (F10 Phase B, ADR-0021 §7 / T10.7)
//
// POST: 공급자가 자기 빌라·기간으로 직접 판매 링크(Proposal seller=SUPPLIER) 생성.
// GET : 공급자 본인이 만든 링크 목록.
// 권한·누수: SUPPLIER 전용 + supplierId 스코프. 운영자 마진·판매가 노출 0건(공급자 판매가 VND만).
import { z } from "zod";
import { auth } from "@/auth";
import { requireCapability } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { canCreateSupplierLink } from "@/lib/permissions";
import {
  createSupplierProposal,
  listSupplierProposals,
  SupplierProposalRejectedError,
} from "@/lib/proposal";
import { MissingSupplierPriceError } from "@/lib/pricing";

/** @db.Date 규약 — "YYYY-MM-DD" → UTC 자정 Date */
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식이어야 합니다")
  .transform((s) => new Date(`${s}T00:00:00.000Z`))
  .refine((d) => !isNaN(d.getTime()), "올바른 날짜가 아닙니다");

const createSchema = z.object({
  villaId: z.string().min(1),
  clientName: z.string().trim().min(1).max(200),
  checkIn: dateOnly,
  checkOut: dateOnly,
  expiresInHours: z.number().int().min(1).max(336).optional(),
});

export async function POST(req: Request) {
  // 첫 줄 권한 검사 — SUPPLIER 전용 (비로그인 401 / 타롤 403)
  const g = await requireCapability(canCreateSupplierLink, "canCreateSupplierLink", req);
  if (!g.ok) return g.response;
  const session = g.session;
  const supplierId = session.user.id;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_input", fields: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const proposal = await createSupplierProposal(prisma, {
      villaId: parsed.data.villaId,
      supplierId, // 스코프 강제 — 본인 빌라만
      clientName: parsed.data.clientName,
      checkIn: parsed.data.checkIn,
      checkOut: parsed.data.checkOut,
      expiresInHours: parsed.data.expiresInHours,
      now: new Date(),
    });
    return Response.json({ token: proposal.token, proposalId: proposal.id }, { status: 201 });
  } catch (e) {
    if (e instanceof SupplierProposalRejectedError) {
      if (e.reason === "NOT_FOUND") {
        // 타 공급자 빌라·없는 빌라 모두 404(존재 비노출)
        return Response.json({ error: "not_found" }, { status: 404 });
      }
      return Response.json({ error: "sold_out" }, { status: 409 }); // SOLD_OUT
    }
    if (e instanceof MissingSupplierPriceError) {
      // 공급자 판매가 미설정 — 가격 먼저 입력하라는 안내(라우트 400)
      return Response.json({ error: "PRICE_NOT_SET" }, { status: 400 });
    }
    if (e instanceof RangeError) {
      return Response.json({ error: "invalid_input", message: e.message }, { status: 400 });
    }
    console.error("[supplier/proposals POST] 실패:", e instanceof Error ? e.message : "unknown");
    return Response.json({ error: "링크 생성에 실패했습니다" }, { status: 500 });
  }
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!canCreateSupplierLink(session.user.role)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const rows = await listSupplierProposals(prisma, session.user.id, new Date());
  // BigInt(totalVnd)·Date 직렬화 — 운영자 금액 컬럼은 애초에 없음(listSupplierProposals 보장)
  return Response.json({
    proposals: rows.map((r) => ({
      token: r.token,
      proposalId: r.proposalId,
      villaId: r.villaId,
      villaName: r.villaName,
      checkIn: r.checkIn.toISOString().slice(0, 10),
      checkOut: r.checkOut.toISOString().slice(0, 10),
      status: r.status,
      totalVnd: r.totalVnd != null ? r.totalVnd.toString() : null,
      booking: r.booking,
    })),
  });
}
