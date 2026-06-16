// POST /api/zalo/qr — Zalo 봇 QR 로그인 시작 (ADR-0006 S1, ADMIN 전용)
// 반환: { qrImageBase64 } — credential 절대 미포함 (D6.2).
// 성공(GotLoginInfo) 시 credential 암호화 저장 + AuditLog는 lib/zalo-runtime onLoginSuccess에서 처리.
import { auth } from "@/auth";
import { startBotQRLogin, disconnectBot } from "@/lib/zalo-runtime";

// zca-js는 네이티브/ws 의존 — Node 런타임 강제, 캐시 금지
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const qrImageBase64 = await startBotQRLogin(session.user.id);
    // base64 QR 이미지만 반환 — credential 미포함
    return Response.json({ qrImageBase64 });
  } catch (e) {
    console.error("[api/zalo/qr] QR 생성 실패", e instanceof Error ? e.message : e);
    return Response.json({ error: "QR 생성에 실패했습니다" }, { status: 500 });
  }
}

// DELETE /api/zalo/qr — 봇 연결 해제 (ADMIN 전용)
export async function DELETE() {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    await disconnectBot();
    return Response.json({ ok: true });
  } catch (e) {
    console.error("[api/zalo/qr] 연결 해제 실패", e instanceof Error ? e.message : e);
    return Response.json({ error: "연결 해제에 실패했습니다" }, { status: 500 });
  }
}
