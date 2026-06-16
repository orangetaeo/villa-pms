import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";

// 사용자 언어 선택 영속 (T-i18n-supplier-ko-toggle).
// 쿠키는 항상 설정(비로그인 로그인/회원가입 화면 포함), 계정 locale DB 반영은 로그인 사용자 한정.
const ONE_YEAR = 60 * 60 * 24 * 365;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const locale = (body as { locale?: unknown }).locale;
  if (locale !== "ko" && locale !== "vi") {
    return NextResponse.json({ error: "INVALID_LOCALE" }, { status: 400 });
  }

  const res = NextResponse.json({ ok: true, locale });
  res.cookies.set("pref-locale", locale, { path: "/", maxAge: ONE_YEAR, sameSite: "lax" });
  res.cookies.set("locale", locale, { path: "/", maxAge: ONE_YEAR, sameSite: "lax" });

  const session = await auth();
  const userId = session?.user?.id;
  // 변경 없는 요청은 DB·감사로그 생략 (자기 자신의 locale만 수정 — 스코프 안전)
  if (userId && session.user.locale !== locale) {
    await prisma.user.update({ where: { id: userId }, data: { locale } });
    await writeAuditLog({
      userId,
      action: "UPDATE",
      entity: "User",
      entityId: userId,
      changes: { locale: { old: session.user.locale, new: locale } },
    });
  }

  return res;
}
