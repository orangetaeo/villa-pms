// POST /api/g/[token]/signature — 게스트 동의서 서명 이미지 업로드 (ADR-0019 S3)
//   비로그인 — 토큰이 자격증명. 사용 가능한 토큰만. 서명은 비공개 증빙 경로(/api/passports/sig-*)로 저장.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { savePassportFile, isAllowedImageMime } from "@/lib/storage";
import { guestTokenState } from "@/lib/guest-checkin";
import { guestRateLimit, GUEST_RL_UPLOAD } from "@/lib/guest-rate-limit";

const MAX_FILE_SIZE = 3 * 1024 * 1024; // 서명 PNG — 3MB 충분

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // 비인증 게스트 파일 업로드 폭주 방어 (보안 P0-3) — 업로드라 낮은 한도
  const rl = await guestRateLimit("g-signature", token, req, GUEST_RL_UPLOAD);
  if (rl) return rl;
  const t = await prisma.guestCheckinToken.findUnique({
    where: { token },
    select: { bookingId: true, expiresAt: true, revokedAt: true },
  });
  if (!t) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (guestTokenState(t, new Date()) !== "OK") {
    return NextResponse.json({ error: "TOKEN_UNAVAILABLE" }, { status: 410 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const file = formData.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "FILE_REQUIRED" }, { status: 400 });
  if (!isAllowedImageMime(file.type)) return NextResponse.json({ error: "INVALID_TYPE" }, { status: 400 });
  if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "FILE_TOO_LARGE" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const { fileName } = await savePassportFile(buffer, file.type, `guest-${t.bookingId}`, "sig-");
  return NextResponse.json({ url: `/api/passports/${fileName}` }, { status: 201 });
}
