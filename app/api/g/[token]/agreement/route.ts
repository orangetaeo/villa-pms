// POST /api/g/[token]/agreement — 게스트 셀프 동의서 서명 확정 (ADR-0019 S3)
//   서명을 토큰에 보관(관리자 completeCheckIn 충돌 방지 — 관리자 체크인 폼이 이 서명을 채택).
//   CheckInRecord는 생성하지 않는다(관리자 체크인이 기존 레코드 없음을 요구).
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { guestTokenState } from "@/lib/guest-checkin";
import { guestRateLimit } from "@/lib/guest-rate-limit";
import { assertSameOrigin } from "@/lib/csrf";
import { AGREEMENT_VERSION } from "@/lib/agreement";

const schema = z.object({
  // 비공개 증빙 경로만 — /api/g/[token]/signature가 반환한 sig- 경로
  signatureUrl: z.string().regex(/^\/api\/passports\/sig-[a-zA-Z0-9._-]+$/),
});

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // 비인증 게스트 mutation 폭주 방어 (보안 P0-3)
  const rl = await guestRateLimit("g-agreement", token, req);
  if (rl) return rl;
  const csrf = await assertSameOrigin(req, "g-agreement");
  if (csrf) return csrf;
  const t = await prisma.guestCheckinToken.findUnique({
    where: { token },
    select: { id: true, bookingId: true, expiresAt: true, revokedAt: true, firstUsedAt: true },
  });
  if (!t) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (guestTokenState(t, new Date()) !== "OK") {
    return NextResponse.json({ error: "TOKEN_UNAVAILABLE" }, { status: 410 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_FAILED" }, { status: 400 });
  }

  const now = new Date();
  await prisma.guestCheckinToken.update({
    where: { token },
    data: {
      agreementSignedAt: now,
      signatureUrl: parsed.data.signatureUrl,
      agreementVersion: AGREEMENT_VERSION,
      firstUsedAt: t.firstUsedAt ?? now,
    },
  });
  // 게스트 행위 — userId 없음(null). 서명 여부·버전만 기록(개인정보 최소화)
  await writeAuditLog({
    db: prisma,
    userId: null,
    action: "UPDATE",
    entity: "Booking",
    entityId: t.bookingId,
    changes: { guestAgreementSigned: { new: true }, agreementVersion: { new: AGREEMENT_VERSION } },
  });

  // 서명 완료 시점부터 와이파이 비번 열람 자격 발생 — 로더는 서명 전 null이라(액세스 게이트)
  // 방금 서명한 게스트가 리로드 없이 바로 볼 수 있게 응답에 실어준다. 다음 로드부턴 로더가 포함.
  // (GuestCheckinToken은 booking 관계 필드가 없어 별도 조회 — 서명 확정 후라 노출 안전.)
  const bk = await prisma.booking.findUnique({
    where: { id: t.bookingId },
    select: { villa: { select: { wifiPassword: true } } },
  });

  return NextResponse.json({
    ok: true,
    agreementVersion: AGREEMENT_VERSION,
    wifiPassword: bk?.villa.wifiPassword ?? null,
  });
}
