// POST /api/business-contracts/[id]/sign — 상대방 전자서명 (T-business-contract-esign)
//   FormData: signature(PNG Blob)·idNumber·signName. 자기 계약+SENT만(아니면 404/409), 멱등(SIGNED=409).
//   처리: savePassportFile("sig-") → 서명 정보 포함 렌더 → contentHash → status SIGNED 원자 update
//        (where status:SENT — 동시 서명 레이스 가드). AuditLog.
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { savePassportFile, isAllowedImageMime } from "@/lib/storage";
import {
  isCounterpartRole,
  isContractType,
  loadBusinessContractTemplate,
  renderBusinessContract,
  contentHash,
  type ContractLocale,
} from "@/lib/business-contract";

const MAX_FILE_SIZE = 3 * 1024 * 1024; // 서명 PNG — 3MB 충분

// 치환 주입 방지: 서명 입력에도 "{{" 금지.
const noBraces = (s: string): boolean => !s.includes("{{");
const INJECTION = { message: "TEMPLATE_INJECTION" } as const;

// 파트너(여행사)는 정본에 {{counterpartIdNumber}}·{{counterpartAddress}} 토큰이 없어 미수집(선택),
// 빌라·부가서비스 정본은 두 토큰을 쓰므로 필수.
function signFieldSchema(isPartner: boolean) {
  const signName = z.string().trim().min(1).max(120).refine(noBraces, INJECTION);
  if (isPartner) {
    return z.object({
      signName,
      idNumber: z.string().trim().max(60).refine(noBraces, INJECTION).optional(),
      address: z.string().trim().max(200).refine(noBraces, INJECTION).optional(),
    });
  }
  return z.object({
    signName,
    idNumber: z.string().trim().min(1).max(60).refine(noBraces, INJECTION),
    address: z.string().trim().min(1).max(200).refine(noBraces, INJECTION),
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAuth(req);
  if (!g.ok) return g.response;
  const { userId, role } = g;
  const { id } = await params;

  if (!isCounterpartRole(role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  // 자기 계약만 — 타인/미존재는 404(존재 비노출).
  const contract = await prisma.businessContract.findFirst({
    where: { id, counterpartId: userId },
    select: {
      id: true,
      type: true,
      locale: true,
      status: true,
      termsJson: true,
    },
  });
  if (!contract) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (contract.status === "SIGNED") {
    return NextResponse.json({ error: "ALREADY_SIGNED" }, { status: 409 });
  }
  if (contract.status !== "SENT") {
    return NextResponse.json({ error: "NOT_SIGNABLE", status: contract.status }, { status: 409 });
  }
  if (!isContractType(contract.type)) {
    return NextResponse.json({ error: "INVALID_TYPE" }, { status: 400 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsedFields = signFieldSchema(contract.type === "PARTNER_AGENCY").safeParse({
    idNumber: formData.get("idNumber") ?? undefined,
    address: formData.get("address") ?? undefined,
    signName: formData.get("signName"),
  });
  if (!parsedFields.success) {
    return NextResponse.json({ error: "VALIDATION_FAILED", issues: parsedFields.error.flatten() }, { status: 400 });
  }
  const { idNumber, address, signName } = parsedFields.data;

  const file = formData.get("signature");
  if (!(file instanceof File)) return NextResponse.json({ error: "SIGNATURE_REQUIRED" }, { status: 400 });
  if (!isAllowedImageMime(file.type)) return NextResponse.json({ error: "INVALID_TYPE" }, { status: 400 });
  if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "FILE_TOO_LARGE" }, { status: 400 });

  // 정본 md 로드 + 서명 정보 포함 렌더 → contentHash(봉인). 정본 부재 시 503.
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, phone: true, zaloContact: true },
  });
  const signedAt = new Date();
  let rendered: string;
  try {
    const template = await loadBusinessContractTemplate(contract.type, contract.locale);
    rendered = renderBusinessContract(template, {
      type: contract.type,
      locale: contract.locale as ContractLocale,
      counterpartName: me?.name ?? "",
      counterpartZalo: me?.phone ?? me?.zaloContact ?? "",
      terms: (contract.termsJson ?? {}) as Record<string, unknown>,
      idNumber: idNumber ?? null,
      address: address ?? null,
      signedAt,
    });
  } catch {
    return NextResponse.json({ error: "TEMPLATE_UNAVAILABLE" }, { status: 503 });
  }
  const hash = contentHash(rendered);

  // 서명 이미지 비공개 저장(sig- 접두 — 파일명에 업로더 id 박힘 → 본인·운영자만 서빙 접근).
  const buffer = Buffer.from(await file.arrayBuffer());
  let fileName: string;
  try {
    ({ fileName } = await savePassportFile(buffer, file.type, userId, "sig-"));
  } catch {
    return NextResponse.json({ error: "INVALID_IMAGE" }, { status: 400 });
  }
  const signatureUrl = `/api/passports/${fileName}`;

  // 원자 전이 — where status:SENT(동시 서명 레이스 가드). count 0이면 이미 처리됨.
  const res = await prisma.businessContract.updateMany({
    where: { id, status: "SENT" },
    data: {
      status: "SIGNED",
      signedAt,
      signatureUrl,
      counterpartIdNumber: idNumber ?? null,
      counterpartAddress: address ?? null,
      counterpartSignName: signName,
      contentHash: hash,
    },
  });
  if (res.count === 0) {
    return NextResponse.json({ error: "ALREADY_SIGNED" }, { status: 409 });
  }

  await writeAuditLog({
    db: prisma,
    userId,
    action: "UPDATE",
    entity: "BusinessContract",
    entityId: id,
    changes: { status: { old: "SENT", new: "SIGNED" }, contentHash: { new: hash } },
  });

  return NextResponse.json({ ok: true, signedAt, contentHash: hash }, { status: 200 });
}
