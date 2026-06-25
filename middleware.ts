import { auth } from "@/auth";
import { NextResponse } from "next/server";
import {
  isOperator,
  canViewFinance,
  isSystemAdmin,
  type Role,
} from "@/lib/permissions";

// ── 경로 게이트 3등급 (S-RBAC-3, ADR-0013) ──────────────────────────────────
// 운영 영역을 capability별 3등급으로 분리한다. 역할 부족 시 /login 리다이렉트.
// (필드 마스킹은 각 화면·피드 select가 책임 — 미들웨어는 coarse 차단만)
//
//  SYSTEM_ADMIN_PATHS (isSystemAdmin, OWNER) : /users·/settings
//  FINANCE_PATHS      (canViewFinance, OWNER/MANAGER) : /settlements·/cost-alerts·/proposals·/earnings
//  OPERATOR_PATHS     (isOperator, OWNER/MANAGER/STAFF) : /dashboard·/villas·/bookings·/inspections·/messages·/calendar·/cleaning·/my-villas
//  (ADMIN은 transition 동안 모든 술어에 포함 — 회귀 0)

const SYSTEM_ADMIN_PATHS = ["/users", "/settings"];

const FINANCE_PATHS = ["/settlements", "/cost-alerts", "/proposals", "/earnings"];

// 운영자 전체 접근(isOperator)이며 SUPPLIER/CLEANER와 공유하지 않는 경로.
// (/calendar·/cleaning·/my-villas는 SUPPLIER/CLEANER도 접근하므로 아래 공유 게이트에서 별도 처리)
const OPERATOR_ONLY_PATHS = [
  "/dashboard",
  "/statistics",
  "/villas",
  "/bookings",
  "/inspections",
  "/messages",
];

// SUPPLIER/CLEANER와 공유되는 운영 경로 — 운영자는 isOperator로, 공급자/청소자는 역할표로 허용
const SHARED_OPERATOR_PATHS = ["/calendar", "/cleaning", "/my-villas"];

// 운영자 보호 경로 전체 (미인증 차단 + locale=운영자 적용 대상)
const OPERATOR_PROTECTED_PATHS = [
  ...SYSTEM_ADMIN_PATHS,
  ...FINANCE_PATHS,
  ...OPERATOR_ONLY_PATHS,
];

// SUPPLIER/CLEANER 화면 — locale=vi 적용 + 역할별 접근 제어 (기존 규칙 보존)
// [QA D-3] /earnings·/cleaning은 SUPPLIER 탭바 노출 및 청소 권한으로 함께 허용
type SupplierRole = "SUPPLIER" | "CLEANER";
const SUPPLIER_CLEANER_ALLOWED: Record<SupplierRole, string[]> = {
  SUPPLIER: ["/my-villas", "/calendar", "/cleaning", "/earnings"],
  CLEANER: ["/cleaning"],
};
const SUPPLIER_CLEANER_PATHS = ["/my-villas", "/calendar", "/cleaning", "/earnings"];

function matchesPath(pathname: string, paths: string[]): boolean {
  return paths.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const session = req.auth;
  const role = session?.user?.role as Role | undefined;

  // 비밀번호 강제 변경 게이트 — 임시 비번(초기화·계정생성) 사용자는 본인이 변경 전까지
  // 변경 화면(운영자 /account · 공급자 /profile)·변경 API·언어 API만 허용, 그 외는 차단.
  // (기존 세션엔 플래그 부재(undefined→통과) → 락아웃 없음. 변경 후 재로그인으로 해제)
  if (session?.user?.mustChangePassword) {
    const changePath = isOperator(role) ? "/account" : "/profile";
    const allowed =
      pathname === changePath ||
      pathname.startsWith("/api/account/password") ||
      pathname.startsWith("/api/locale");
    if (!allowed) {
      return NextResponse.redirect(new URL(changePath, req.url));
    }
  }

  const isOperatorProtected = matchesPath(pathname, OPERATOR_PROTECTED_PATHS);
  const isSharedOperatorPath = matchesPath(pathname, SHARED_OPERATOR_PATHS);
  const isSupplierCleanerPath = matchesPath(pathname, SUPPLIER_CLEANER_PATHS);

  // 보호 경로(운영 전용 영역): 미인증 → /login
  if (isOperatorProtected && !session) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // 운영 영역 capability 게이트 (3등급) — 역할 부족 시 /login
  // 더 좁은 등급(SYSTEM_ADMIN·FINANCE)을 먼저 검사하고, 운영전용은 isOperator.
  // 단 SUPPLIER/CLEANER는 자기 영역(/earnings 등)을 별도 규칙으로 가지므로 운영자 게이트에서 제외.
  const isSupplierOrCleaner = role === "SUPPLIER" || role === "CLEANER";
  if (session && isSupplierOrCleaner) {
    // SUPPLIER/CLEANER가 운영 전용 보호 경로에 진입 시 차단.
    // 단 자기 영역(/my-villas·/calendar·/cleaning·/earnings)은 예외 — 아래 공유·공급자 규칙이 허용.
    // (/earnings는 finance 등급이면서 SUPPLIER 자기 정산 페이지를 겸하므로 공급자 허용목록으로 통과)
    const supplierAllowed = SUPPLIER_CLEANER_ALLOWED[role as SupplierRole];
    if (isOperatorProtected && !matchesPath(pathname, supplierAllowed)) {
      return NextResponse.redirect(new URL("/login", req.url));
    }
  } else if (session) {
    // 운영자(OWNER/MANAGER/STAFF/ADMIN) 3등급 게이트.
    if (matchesPath(pathname, SYSTEM_ADMIN_PATHS) && !isSystemAdmin(role)) {
      return NextResponse.redirect(new URL("/login", req.url));
    }
    if (matchesPath(pathname, FINANCE_PATHS) && !canViewFinance(role)) {
      return NextResponse.redirect(new URL("/login", req.url));
    }
    if (matchesPath(pathname, OPERATOR_ONLY_PATHS) && !isOperator(role)) {
      return NextResponse.redirect(new URL("/login", req.url));
    }
  }

  // 공유 경로(/calendar·/cleaning·/my-villas): 운영자는 통과,
  // SUPPLIER/CLEANER는 역할표로, 그 외(미인증 포함)는 차단.
  if (isSharedOperatorPath) {
    if (!session) {
      return NextResponse.redirect(new URL("/login", req.url));
    }
    if (!isOperator(role)) {
      const allowed =
        role === "SUPPLIER" || role === "CLEANER"
          ? SUPPLIER_CLEANER_ALLOWED[role]
          : [];
      if (!matchesPath(pathname, allowed)) {
        return NextResponse.redirect(new URL("/login", req.url));
      }
    }
  }

  // SUPPLIER 전용 경로(/earnings 등 운영 영역 밖): 역할별 접근 제어.
  // (운영자는 /earnings를 FINANCE_PATHS로 이미 허용받음 — 여기선 비운영자만 검사)
  if (
    isSupplierCleanerPath &&
    !isSharedOperatorPath &&
    session &&
    !isOperator(role) &&
    !canViewFinance(role)
  ) {
    const allowed =
      role === "SUPPLIER" || role === "CLEANER"
        ? SUPPLIER_CLEANER_ALLOWED[role]
        : [];
    if (!matchesPath(pathname, allowed)) {
      return NextResponse.redirect(new URL("/login", req.url));
    }
  }

  // 인증된 사용자가 /login 또는 /signup 접근 시 → 역할별 홈으로
  if ((pathname === "/login" || pathname === "/signup") && session) {
    const dest = isOperator(role) ? "/dashboard" : "/my-villas";
    return NextResponse.redirect(new URL(dest, req.url));
  }

  // locale 쿠키 설정 (redirect 이후에는 도달하지 않으므로 여기서만 처리)
  const res = NextResponse.next();
  const prefRaw = req.cookies.get("pref-locale")?.value;
  const pref = prefRaw === "ko" || prefRaw === "vi" ? prefRaw : undefined;
  // 운영자(isOperator) 영역의 화면에는 운영자 locale 규칙(ko 기본). SUPPLIER/CLEANER는 아래 vi 기본.
  const isOperatorViewing = isOperator(role);
  if (
    (isOperatorProtected && isOperatorViewing) ||
    (isSharedOperatorPath && isOperatorViewing)
  ) {
    // 운영자 화면: 기본 ko(테오). 단 베트남 직원이 직접 관리하는 경우를 위해
    // 계정 기본 locale이 vi면 vi, 그리고 토글(pref-locale)이 최우선.
    const adminDefault = session?.user?.locale === "vi" ? "vi" : "ko";
    res.cookies.set("locale", pref ?? adminDefault, { path: "/" });
  } else if (
    isSupplierCleanerPath ||
    pathname.startsWith("/signup") ||
    pathname.startsWith("/login")
  ) {
    // 공급자·인증 화면: 사용자 명시 선택(pref-locale) > 계정 기본(session) > vi 기본.
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
