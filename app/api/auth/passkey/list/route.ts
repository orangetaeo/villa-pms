// GET /api/auth/passkey/list — 본인이 등록한 패스키 목록 (계정설정 UI용, ADR-0030).
//   본인 스코프 강제(userId). 공개키·counter 등 민감값은 반환하지 않는다.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const items = await prisma.authenticator.findMany({
    where: { userId: session.user.id },
    select: { id: true, deviceName: true, createdAt: true, lastUsedAt: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ items });
}
