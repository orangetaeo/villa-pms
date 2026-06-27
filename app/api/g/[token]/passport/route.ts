// POST /api/g/[token]/passport — 게스트 셀프 여권 사진 업로드 (ADR-0019 v2 #1)
//   동의서 서명 후 단계. 비로그인(토큰 자격). 인원수만큼 1장씩 업로드 → token.passportPhotoUrls에 누적.
//   ★ 비공개 증빙(/api/passports). OCR은 관리자 체크인 단계에서. 관리자 completeCheckIn이 채택.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { savePassportFile, isAllowedImageMime } from "@/lib/storage";
import { guestTokenState } from "@/lib/guest-checkin";
import { guestRateLimit, GUEST_RL_UPLOAD } from "@/lib/guest-rate-limit";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_PHOTOS = 20;

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // 비인증 게스트 파일 업로드 폭주 방어 (보안 P0-3) — 업로드라 낮은 한도
  const rl = await guestRateLimit("g-passport", token, req, GUEST_RL_UPLOAD);
  if (rl) return rl;
  const t = await prisma.guestCheckinToken.findUnique({
    where: { token },
    select: { bookingId: true, expiresAt: true, revokedAt: true, passportPhotoUrls: true },
  });
  if (!t) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (guestTokenState(t, new Date()) !== "OK") {
    return NextResponse.json({ error: "TOKEN_UNAVAILABLE" }, { status: 410 });
  }
  if (t.passportPhotoUrls.length >= MAX_PHOTOS) {
    return NextResponse.json({ error: "TOO_MANY" }, { status: 400 });
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
  const { fileName } = await savePassportFile(buffer, file.type, `guest-${t.bookingId}`);
  const url = `/api/passports/${fileName}`;

  await prisma.guestCheckinToken.update({
    where: { token },
    data: { passportPhotoUrls: { push: url } },
  });

  return NextResponse.json({ url, count: t.passportPhotoUrls.length + 1 }, { status: 201 });
}
