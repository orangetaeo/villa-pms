// GET /api/zalo/status — 내 Zalo 연결 상태 (ADR-0007 S2, ADMIN 전용, 본인 계정만)
// 반환: { connected, status, displayName, lastConnected, lastError } — credential 절대 미포함 (D6.2).
// 통합 모드: 테오(시스템봇 소유자)는 "__system__" 인스턴스 상태를 본다(getStatusForAdmin 내부 해석).
import { auth } from "@/auth";
import { getStatusForAdmin } from "@/lib/zalo-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  // 본인 계정 상태만 — credential 미포함 상태 객체
  const status = await getStatusForAdmin(session.user.id);
  return Response.json(status);
}
