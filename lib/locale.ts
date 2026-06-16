import { cookies } from "next/headers";

export type AppLocale = "ko" | "vi";

/** 지원 locale 정규화 — 알 수 없는 값은 fallback(기본 vi). */
export function normalizeLocale(
  value: string | null | undefined,
  fallback: AppLocale = "vi"
): AppLocale {
  return value === "ko" || value === "vi" ? value : fallback;
}

/**
 * 공급자·인증 화면의 유효 locale.
 * 우선순위: 사용자 명시 선택(pref-locale 쿠키) > 계정 기본(session.user.locale) > vi.
 *
 * i18n/request.ts는 admin 기본 ko라 공급자 화면 locale은 이 헬퍼로 산출한다.
 * 언어 전환 토글(components/locale-switcher.tsx)이 pref-locale 쿠키를 기록하고,
 * middleware가 같은 우선순위로 `locale` 쿠키(next-intl이 읽는 값)를 맞춘다.
 */
export async function getSupplierLocale(
  sessionLocale?: string | null
): Promise<AppLocale> {
  const pref = (await cookies()).get("pref-locale")?.value;
  if (pref === "ko" || pref === "vi") return pref;
  return normalizeLocale(sessionLocale, "vi");
}
