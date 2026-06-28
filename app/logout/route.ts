// /logout — 세션 쿠키를 확실히 삭제하고 /login으로 보내는 단일 출구(GET/POST).
//
// 왜 필요한가 (보안 P0-5② 세션 무효화의 부작용 차단):
//   비밀번호가 토큰 발급 이후 바뀌면 jwt 콜백이 null을 반환해 세션을 무효화한다(타 기기 강제 로그아웃).
//   그런데 이 무효화가 **서버 컴포넌트(layout/page)의 auth()** 안에서 일어나면, RSC는 응답 쿠키를
//   쓸 수 없어 **세션 쿠키가 지워지지 않는다**. 그 결과:
//     - 보호 레이아웃(node): auth()=null → 리다이렉트 (쿠키는 그대로 남음)
//     - 미들웨어(edge): DB 검사를 못 해 남은 쿠키를 "유효"로 보고 /login → 보호경로 로 되돌림
//   → /login ↔ /profile(또는 /vendor/profile 등) **무한 리다이렉트 루프**(빈 화면, 사용자 영구 차단).
//
// 라우트 핸들러는 Node 런타임 + 응답 쿠키 쓰기가 가능하므로, 여기서 쿠키를 삭제하면 다음 /login
// 요청엔 쿠키가 없어 루프가 끊긴다. 보호 레이아웃·루트는 무효 세션을 이 경로로 보낸다.
import { NextResponse } from "next/server";
import { signOut } from "@/auth";

export const runtime = "nodejs";

// Auth.js v5 세션 쿠키 이름(기본 prefix authjs). prod=secure 접두, 큰 토큰은 .0/.1 청크로 분할될 수 있어
// 알려진 변형을 모두 만료시킨다(쿠키가 하나라도 남으면 미들웨어가 stale 세션을 "유효"로 보고 루프 재발).
const SESSION_COOKIE_NAMES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
  "authjs.session-token.0",
  "authjs.session-token.1",
  "__Secure-authjs.session-token.0",
  "__Secure-authjs.session-token.1",
];

async function clearAndRedirect(req: Request) {
  // 1차: Auth.js 표준 경로(쿠키 store 삭제). 일부 컨텍스트에서 응답 병합이 누락될 수 있어 2차로 보강.
  try {
    await signOut({ redirect: false });
  } catch {
    // signOut이 내부 리다이렉트를 시도하다 throw해도 무시 — 아래에서 직접 만료시킨다.
  }
  const res = NextResponse.redirect(new URL("/login", req.url));
  // 2차(확실): 응답에 만료 쿠키를 직접 세팅. path=/ 로 발급되었으므로 동일 경로로 삭제.
  for (const name of SESSION_COOKIE_NAMES) {
    res.cookies.set(name, "", { path: "/", maxAge: 0, expires: new Date(0) });
  }
  return res;
}

export async function GET(req: Request) {
  return clearAndRedirect(req);
}

// 폼 기반 로그아웃에서도 동작하도록 POST도 동일 처리.
export async function POST(req: Request) {
  return clearAndRedirect(req);
}
