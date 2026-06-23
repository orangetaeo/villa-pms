import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { parseUtcDateOnly } from "@/lib/date-vn";
import { serializeBigInt } from "@/lib/serialize";
import {
  createProposal,
  effectiveProposalStatus,
  ProposalRejectedError,
} from "@/lib/proposal";
import { canSetPrice } from "@/lib/permissions";

/** 제안 생성·목록 — 전부 ADMIN 전용 (재고 비공개 원칙: 후보·제안 관리는 운영자만) */

const dateOnly = z
  .string()
  .transform((s, ctx) => {
    const d = parseUtcDateOnly(s); // UTC 자정 정규화 (T1.3 QA 권고)
    if (!d) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `잘못된 날짜: ${s}` });
      return z.NEVER;
    }
    return d;
  });

const createSchema = z.object({
  clientName: z.string().trim().min(1, "고객명(여행사명)은 필수입니다"),
  channel: z.enum(["TRAVEL_AGENCY", "LAND_AGENCY", "DIRECT"]),
  saleCurrency: z.enum(["KRW", "VND"]).optional(), // 미지정 시 채널 기본값
  expiresInHours: z.number().int().min(1).max(336).optional(),
  note: z.string().trim().max(2000).optional(),
  items: z
    .array(
      z
        .object({ villaId: z.string().min(1), checkIn: dateOnly, checkOut: dateOnly })
        .refine((i) => i.checkIn.getTime() < i.checkOut.getTime(), {
          message: "체크인은 체크아웃보다 빨라야 합니다",
        })
    )
    .min(1)
    .max(3),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!canSetPrice(session.user.role)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_input", fields: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const proposal = await createProposal(prisma, {
      ...parsed.data,
      actorUserId: session.user.id,
      now: new Date(),
    });
    return Response.json({ proposal: serializeBigInt(proposal) }, { status: 201 });
  } catch (e) {
    if (e instanceof ProposalRejectedError) {
      // 항목별 사유 — ADMIN 화면용 (공개 페이지 아님)
      return Response.json({ error: "items_unavailable", failures: e.failures }, { status: 409 });
    }
    if (e instanceof RangeError) {
      return Response.json({ error: "invalid_input", message: e.message }, { status: 400 });
    }
    console.error("[proposals/POST] 생성 실패", e);
    return Response.json({ error: "제안 생성에 실패했습니다" }, { status: 500 });
  }
}

/** GET /api/proposals — b12 제안 목록용. effectiveStatus는 시각 기준 서버 판정값 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!canSetPrice(session.user.role)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const now = new Date();
  const proposals = await prisma.proposal.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      items: {
        select: {
          id: true,
          villaId: true,
          checkIn: true,
          checkOut: true,
          totalKrw: true,
          totalVnd: true,
          bookingId: true,
          villa: { select: { name: true } },
        },
      },
    },
  });

  return Response.json({
    proposals: serializeBigInt(
      proposals.map((p) => ({
        ...p,
        effectiveStatus: effectiveProposalStatus(p.status, p.expiresAt, now),
      }))
    ),
  });
}
