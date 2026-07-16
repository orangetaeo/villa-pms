// GET /api/youtube/oauth/callback — Google OAuth 콜백(코드 → refresh token 교환·저장)
// 권한(첫 줄): isSystemAdmin(OWNER/ADMIN)만.
// 흐름: state 일치 검증(불일치·재사용·만료 403, 일회성 소진) → code 교환 → refresh_token 암호화 저장
//   → /marketing/youtube?connected=1 리다이렉트. ★토큰 값은 응답·리다이렉트 어디에도 미노출.
//   에러 시 /marketing/youtube?error=<코드> 로 리다이렉트(코드만 — 토큰·시크릿 미포함).
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isSystemAdmin } from "@/lib/permissions";
import { setYoutubeRefreshToken } from "@/lib/youtube/settings";
import { consumeYoutubeOauthState, exchangeYoutubeCode, getAppBaseUrl } from "@/lib/youtube/auth";
import { writeAuditLog } from "@/lib/audit-log";

function redirectToSettings(search: string): NextResponse {
  return NextResponse.redirect(`${getAppBaseUrl()}/marketing/youtube${search}`);
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!isSystemAdmin(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);

  // state 는 성공·거부·오류 어느 경로든 무조건 소진(일회성 — 재생 공격 차단).
  const stateOk = await consumeYoutubeOauthState(searchParams.get("state"));

  // 사용자가 동의를 거부했거나 Google 이 error 를 되돌린 경우(친절한 에러 표시로 리다이렉트).
  const oauthError = searchParams.get("error");
  if (oauthError) {
    return redirectToSettings(`?error=${encodeURIComponent(oauthError)}`);
  }

  // state 불일치·재사용·만료 시 403.
  if (!stateOk) {
    return NextResponse.json({ error: "STATE_MISMATCH" }, { status: 403 });
  }

  const code = searchParams.get("code");
  if (!code) {
    return redirectToSettings("?error=missing_code");
  }

  const exchange = await exchangeYoutubeCode(code);
  if (!exchange.ok) {
    return redirectToSettings(`?error=${encodeURIComponent(exchange.reason)}`);
  }

  // refresh token 암호화 저장 — ★값은 감사로그·응답에 미기록(연결 사실만).
  await setYoutubeRefreshToken(exchange.refreshToken);
  await writeAuditLog({
    userId: session.user.id,
    action: "UPDATE",
    entity: "AppSetting",
    entityId: "YT_REFRESH_TOKEN",
    changes: { youtubeConnected: { new: true } },
  });

  return redirectToSettings("?connected=1");
}
