import { auth } from "@/auth";
import { NextResponse } from "next/server";

type UserRole = "ADMIN" | "SUPPLIER" | "CLEANER";

// 역할별 허용 경로 (하위 경로 포함)
const ROLE_ALLOWED_PATHS: Record<UserRole, string[]> = {
  ADMIN: [
    "/dashboard",
    "/villas",
    "/bookings",
    "/proposals",
    "/inspections",
    "/settlements",
    "/settings",
    "/users",
    "/messages",
    // ADMIN은 공급자 화면도 접근 가능 (테스트·지원용)
    "/my-villas",
    "/calendar",
    "/cleaning",
    "/earnings", // 페이지 자체가 ADMIN을 "/"로 redirect — 미들웨어는 통과만
  ],
  // [QA D-3] /earnings 추가. /cleaning은 SUPPLIER 탭바에 노출되고
  // 역할표(CLAUDE.md)상 SUPPLIER도 청소 사진 업로드 권한이 있어 함께 추가
  SUPPLIER: ["/my-villas", "/calendar", "/cleaning", "/earnings"],
  CLEANER: ["/cleaning"],
};

// 보호 경로 목록 (로그인 필요)
const PROTECTED_PATHS = [
  "/dashboard",
  "/villas",
  "/bookings",
  "/proposals",
  "/inspections",
  "/settlements",
  "/settings",
  "/users",
  "/messages",
  "/my-villas",
  "/calendar",
  "/cleaning",
  "/earnings", // [QA D-3] 페이지 가드와 이중화 (미인증 차단)
];

// ADMIN 전용 경로 (다른 역할은 /login으로)
const ADMIN_ONLY_PATHS = [
  "/dashboard",
  "/villas",
  "/bookings",
  "/proposals",
  "/inspections",
  "/settlements",
  "/settings",
  "/users",
  "/messages",
];

function matchesPath(pathname: string, paths: string[]): boolean {
  return paths.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const session = req.auth;
  const role = session?.user?.role as UserRole | undefined;

  const isProtectedPath = matchesPath(pathname, PROTECTED_PATHS);
  const isAdminOnlyPath = matchesPath(pathname, ADMIN_ONLY_PATHS);
  // [QA D-3] /earnings 포함 — 누락 시 locale=vi 쿠키가 설정되지 않아 한국어로 렌더됨
  const isSupplierCleanerPath = matchesPath(pathname, [
    "/my-villas",
    "/calendar",
    "/cleaning",
    "/earnings",
  ]);

  // 보호 경로: 미인증 → /login
  if (isProtectedPath && !session) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // ADMIN 전용 경로: ADMIN이 아닌 경우 → /login
  if (isAdminOnlyPath && role !== "ADMIN") {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // SUPPLIER/CLEANER 경로: 역할별 접근 제어
  if (isSupplierCleanerPath && session) {
    if (!role || !matchesPath(pathname, ROLE_ALLOWED_PATHS[role] ?? [])) {
      return NextResponse.redirect(new URL("/login", req.url));
    }
  }

  // 인증된 사용자가 /login 또는 /signup 접근 시 → 역할별 홈으로
  if ((pathname === "/login" || pathname === "/signup") && session) {
    const dest = role === "ADMIN" ? "/dashboard" : "/my-villas";
    return NextResponse.redirect(new URL(dest, req.url));
  }

  // locale 쿠키 설정 (redirect 이후에는 도달하지 않으므로 여기서만 처리)
  const res = NextResponse.next();
  if (isAdminOnlyPath) {
    res.cookies.set("locale", "ko", { path: "/" });
  } else if (
    isSupplierCleanerPath ||
    pathname.startsWith("/signup") ||
    pathname.startsWith("/login")
  ) {
    // 공급자·인증 화면: 사용자 명시 선택(pref-locale) > 계정 기본(session) > vi 기본.
    // (기존엔 vi 강제 → 한국어 전환 토글 도입으로 사용자 선택을 존중. Stitch a0-login 기본은 vi)
    const prefRaw = req.cookies.get("pref-locale")?.value;
    const pref = prefRaw === "ko" || prefRaw === "vi" ? prefRaw : undefined;
    const userLocale = session?.user?.locale === "ko" ? "ko" : "vi";
    res.cookies.set("locale", pref ?? userLocale, { path: "/" });
  }

  return res;
});

export const config = {
  // api/auth 는 NextAuth 내부 처리이므로 미들웨어에서 제외
  // 나머지 API 경로는 미들웨어를 통과시켜 각 route handler의 auth() 호출을 지원
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico|public).*)"],
};
