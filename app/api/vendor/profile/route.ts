// /api/vendor/profile — 원천 공급자 본인 지급 정보 자기관리 (ADR-0023 S2)
//   GET: 본인 ServiceVendor의 연락처·지급 계좌(bankInfo) 반환. name/nameKo는 읽기전용 표시용.
//   PATCH: phone·bankInfo만 수정 허용(name/active/approval 등은 운영자 전용 — 절대 변경 금지).
//   Role=VENDOR + getVendorIdForUser로 본인 vendor 스코프 강제.
//   ★ 누수: bankInfo는 본인 지급 계좌이므로 본인에게 노출 OK. vendorId 스코프 밖 절대 금지.
//      우리 판매가·마진은 이 라우트와 무관(애초에 ServiceVendor에 없음).
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireAuth } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isVendor, type Role } from "@/lib/permissions";
import { getVendorIdForUser } from "@/lib/vendor-auth";

// 지급 계좌(은행·계좌·예금주) — bankInfo Json 형태. 빈 문자열은 미입력으로 정규화.
const bankInfoSchema = z.object({
  bankName: z.string().trim().max(80).optional().nullable(),
  accountNumber: z.string().trim().max(60).optional().nullable(),
  accountHolder: z.string().trim().max(80).optional().nullable(),
});

const patchSchema = z.object({
  phone: z.string().trim().max(30).optional().nullable(),
  bankInfo: bankInfoSchema.optional().nullable(),
});

/** {bankName, accountNumber, accountHolder} 형태로 정규화. 모두 비면 null(미입력). */
type BankInfo = { bankName: string | null; accountNumber: string | null; accountHolder: string | null };
function normalizeBankInfo(raw: unknown): BankInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const pick = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const out: BankInfo = {
    bankName: pick(b.bankName),
    accountNumber: pick(b.accountNumber),
    accountHolder: pick(b.accountHolder),
  };
  if (!out.bankName && !out.accountNumber && !out.accountHolder) return null;
  return out;
}

export async function GET(req: Request) {
  const g = await requireAuth(req);
  if (!g.ok) return g.response;
  const role = g.session.user.role as Role | undefined;
  if (!isVendor(role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const vendorId = await getVendorIdForUser(g.session.user.id);
  if (!vendorId) return NextResponse.json({ error: "NOT_A_VENDOR" }, { status: 403 });

  const vendor = await prisma.serviceVendor.findUnique({
    where: { id: vendorId },
    select: { name: true, nameKo: true, phone: true, bankInfo: true },
  });
  if (!vendor) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  return NextResponse.json({
    name: vendor.name, // 읽기전용 표시용(운영자 관리 필드)
    nameKo: vendor.nameKo,
    phone: vendor.phone,
    bankInfo: normalizeBankInfo(vendor.bankInfo),
  });
}

export async function PATCH(req: Request) {
  const g = await requireAuth(req);
  if (!g.ok) return g.response;
  const role = g.session.user.role as Role | undefined;
  if (!isVendor(role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const actorId = g.session.user.id;

  const vendorId = await getVendorIdForUser(actorId);
  if (!vendorId) return NextResponse.json({ error: "NOT_A_VENDOR" }, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // ★ phone·bankInfo만 갱신 대상 — name/active/approvalStatus 등 운영자 필드는 손대지 않음.
  const current = await prisma.serviceVendor.findUnique({
    where: { id: vendorId },
    select: { phone: true, bankInfo: true },
  });
  if (!current) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const nextPhone =
    parsed.data.phone !== undefined
      ? (parsed.data.phone?.trim() || null)
      : current.phone;
  const nextBank =
    parsed.data.bankInfo !== undefined
      ? normalizeBankInfo(parsed.data.bankInfo)
      : (current.bankInfo as BankInfo | null);

  await prisma.serviceVendor.update({
    where: { id: vendorId },
    data: {
      phone: nextPhone,
      // null이면 미입력으로 비우고, 값이 있으면 Json으로 저장.
      bankInfo: nextBank === null ? Prisma.JsonNull : (nextBank as unknown as Prisma.InputJsonValue),
    },
  });

  await writeAuditLog({
    db: prisma,
    userId: actorId,
    action: "UPDATE",
    entity: "ServiceVendor",
    entityId: vendorId,
    // 계좌번호 등 민감 값은 변경 여부만 기록(원문 미기록 — AuditLog는 영구보존).
    changes: {
      ...(parsed.data.phone !== undefined && nextPhone !== current.phone
        ? { phone: { old: current.phone, new: nextPhone } }
        : {}),
      ...(parsed.data.bankInfo !== undefined
        ? { bankInfo: { new: nextBank ? "updated" : "cleared" } }
        : {}),
    },
  });

  return NextResponse.json({
    phone: nextPhone,
    bankInfo: nextBank,
  });
}
