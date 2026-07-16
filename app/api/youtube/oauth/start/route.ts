// GET /api/youtube/oauth/start — 유튜브 OAuth 동의 화면으로 리다이렉트 (admin, 시스템 통제)
// 권한(첫 줄): isSystemAdmin(OWNER/ADMIN)만 — 토큰 발급 흐름 시작은 시스템 통제.
// 흐름: client id 미설정 400 → CSRF state 생성·저장(10분·일회성) → Google 동의 URL 302 리다이렉트.
//   access_type=offline + prompt=consent 로 refresh token 을 확실히 받는다(auth.ts).
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isSystemAdmin } from "@/lib/permissions";
import { getYoutubeClientId } from "@/lib/youtube/settings";
import { buildYoutubeConsentUrl, createYoutubeOauthState } from "@/lib/youtube/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!isSystemAdmin(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const clientId = await getYoutubeClientId();
  if (!clientId) {
    return NextResponse.json(
      { error: "CLIENT_ID_MISSING", message: "OAuth 클라이언트 ID를 먼저 저장하세요." },
      { status: 400 }
    );
  }

  const state = await createYoutubeOauthState();
  const consentUrl = buildYoutubeConsentUrl({ clientId, state });
  return NextResponse.redirect(consentUrl);
}
