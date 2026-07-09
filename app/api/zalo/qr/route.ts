// POST /api/zalo/qr — 내 Zalo QR 로그인 시작 (ADR-0007 S2, ADMIN 전용, 본인 계정만)
// 반환: { qrImageBase64 } — credential 절대 미포함 (D6.2).
// kind 결정: 시스템봇 소유자(테오)이거나 시스템봇 미연결이면 SYSTEM_BOT(통합 모드 D1), 그 외 ADMIN_PERSONAL.
// 성공(GotLoginInfo) 시 credential 암호화 저장 + AuditLog는 lib/zalo-runtime onLoginSuccess에서 처리.
import { ZaloAccountKind } from "@prisma/client";
import { startQRLoginForAdmin, disconnectForAdmin } from "@/lib/zalo-runtime";
// ADR-0032 BE-5 — 세션 비보유 웹(SESSION_LOCAL=false)이면 QR 로그인·해제를 워커로 위임(세션은 보유자에서 태어난다).
import { shouldDelegate, delegateQrLogin, delegateDisconnect } from "@/lib/zalo-worker-client";
import { getSystemBotOwnerId } from "@/lib/zalo-credentials";
import { isSystemAdmin } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";

// zca-js는 네이티브/ws 의존 — Node 런타임 강제, 캐시 금지
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 본인이 연결할 계정 kind 결정.
 *  - 시스템봇 소유자가 이미 있으면: 그 사람만 SYSTEM_BOT, 나머지는 ADMIN_PERSONAL.
 *  - 시스템봇 소유자가 없으면(최초 연결): 첫 연결자가 SYSTEM_BOT(통합 모드 — 시스템 발송 겸용).
 */
async function resolveKind(adminUserId: string): Promise<ZaloAccountKind> {
  const systemOwner = await getSystemBotOwnerId();
  if (systemOwner === null) return ZaloAccountKind.SYSTEM_BOT; // 최초 연결 = 시스템봇
  if (systemOwner === adminUserId) return ZaloAccountKind.SYSTEM_BOT; // 테오 통합 모드
  return ZaloAccountKind.ADMIN_PERSONAL; // 다른 관리자 개인 채팅
}

export async function POST(req: Request) {
  const g = await requireCapability(isSystemAdmin, "isSystemAdmin", req);
  if (!g.ok) return g.response;
  const session = g.session;

  try {
    const kind = await resolveKind(session.user.id);
    const qrImageBase64 = shouldDelegate()
      ? await delegateQrLogin(session.user.id, kind)
      : await startQRLoginForAdmin(session.user.id, kind);
    if (!qrImageBase64) {
      return Response.json({ error: "QR 생성에 실패했습니다" }, { status: 500 });
    }
    // base64 QR 이미지만 반환 — credential 미포함
    return Response.json({ qrImageBase64 });
  } catch (e) {
    console.error("[api/zalo/qr] QR 생성 실패", e instanceof Error ? e.message : e);
    return Response.json({ error: "QR 생성에 실패했습니다" }, { status: 500 });
  }
}

// DELETE /api/zalo/qr — 내 Zalo 연결 해제 (ADMIN 전용, 본인 계정만)
export async function DELETE(req: Request) {
  const g = await requireCapability(isSystemAdmin, "isSystemAdmin", req);
  if (!g.ok) return g.response;
  const session = g.session;

  try {
    const kind = await resolveKind(session.user.id);
    if (shouldDelegate()) {
      await delegateDisconnect(session.user.id, kind);
    } else {
      await disconnectForAdmin(session.user.id, kind);
    }
    return Response.json({ ok: true });
  } catch (e) {
    console.error("[api/zalo/qr] 연결 해제 실패", e instanceof Error ? e.message : e);
    return Response.json({ error: "연결 해제에 실패했습니다" }, { status: 500 });
  }
}
