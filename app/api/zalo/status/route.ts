// GET /api/zalo/status — Zalo 봇 연결 상태 (ADR-0006 S1, ADMIN 전용)
// 반환: { connected, status, displayName, lastConnected, lastError } — credential 절대 미포함 (D6.2).
import { auth } from "@/auth";
import { getBotStatus } from "@/lib/zalo-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  // getBotStatus는 credential을 포함하지 않는 상태 객체만 반환
  return Response.json(getBotStatus());
}
