import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

export default getRequestConfig(async ({ requestLocale }) => {
  // 명시적 로케일 호출(getTranslations({locale}))이 최우선 — requestLocale로 전달된다.
  // 종전에는 이를 무시하고 항상 쿠키로 메시지를 로드해, 청소원 화면의 vi 강제가
  // 쿠키 ko에 눌려 "문구 ko + 날짜 vi" 혼재가 생겼다(전수검사 M-1).
  const requested = await requestLocale;
  const cookieLocale = (await cookies()).get("locale")?.value;
  const locale =
    requested === "ko" || requested === "vi"
      ? requested
      : cookieLocale === "ko" || cookieLocale === "vi"
        ? cookieLocale
        : "ko";

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
