// /api/admin/business-contracts/party-a — 계약 주체(갑, Bên A) 고정 정보 편집 (운영자 전용, T-business-contract-esign)
//   PUT: AppSetting BUSINESS_CONTRACT_PARTY_A(JSON)를 upsert. 생성 폼이 이 값을 자동 prefill.
//        4개 필드 zod(companyContactKr만 optional). 자유텍스트 "{{" 거부(TEMPLATE_INJECTION).
// ★ 원가·마진·판매가(KRW) 없음. 갑(테오 본인) 사업 신원 정보만 — 여권번호도 본인 정보라 감사로그 무방.
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { canViewFinance } from "@/lib/permissions";
import {
  CONTRACT_PARTY_A_KEY,
  containsTemplateInjection,
  readContractPartyADefaults,
} from "@/lib/business-contract";

// 치환 주입 방지: 모든 자유 텍스트에 "{{" 포함 금지(무한 치환·토큰 위조 차단).
const NO_BRACES = { message: "TEMPLATE_INJECTION" } as const;
const noBraces = (s: string): boolean => !containsTemplateInjection(s);

const partyASchema = z
  .object({
    companyName: z.string().trim().min(1).max(200).refine(noBraces, NO_BRACES),
    companyPassport: z.string().trim().min(1).max(60).refine(noBraces, NO_BRACES),
    companyContactVn: z.string().trim().min(1).max(60).refine(noBraces, NO_BRACES),
    companyContactKr: z
      .string()
      .trim()
      .max(60)
      .refine(noBraces, NO_BRACES)
      .optional()
      .or(z.literal("")),
  })
  .strict();

export async function PUT(req: Request) {
  const g = await requireCapability(canViewFinance, "canViewFinance", req);
  if (!g.ok) return g.response;
  const actorId = g.userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = partyASchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // 정규화: companyContactKr는 빈 문자열이면 저장에서 생략(부재 = 미설정).
  const payload: Record<string, string> = {
    companyName: parsed.data.companyName,
    companyPassport: parsed.data.companyPassport,
    companyContactVn: parsed.data.companyContactVn,
  };
  const kr = parsed.data.companyContactKr?.trim();
  if (kr) payload.companyContactKr = kr;

  // 이전값(감사로그 old→new) — 저장 전 스냅샷.
  const before = await readContractPartyADefaults(prisma);

  await prisma.appSetting.upsert({
    where: { key: CONTRACT_PARTY_A_KEY },
    create: { key: CONTRACT_PARTY_A_KEY, value: JSON.stringify(payload) },
    update: { value: JSON.stringify(payload) },
  });

  await writeAuditLog({
    db: prisma,
    userId: actorId,
    action: "UPDATE",
    entity: "AppSetting",
    entityId: CONTRACT_PARTY_A_KEY,
    changes: {
      partyA: {
        old: {
          companyName: before.companyName ?? null,
          companyPassport: before.companyPassport ?? null,
          companyContactVn: before.companyContactVn ?? null,
          companyContactKr: before.companyContactKr ?? null,
        },
        new: {
          companyName: payload.companyName,
          companyPassport: payload.companyPassport,
          companyContactVn: payload.companyContactVn,
          companyContactKr: payload.companyContactKr ?? null,
        },
      },
    },
  });

  return NextResponse.json({ ok: true, partyA: payload });
}
