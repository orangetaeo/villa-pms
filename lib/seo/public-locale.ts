// lib/seo/public-locale.ts — 공개 홈 로케일 쿠키 읽기(서버 전용)
//
// ★ next/headers를 쓰므로 서버 컴포넌트에서만 import한다. 순수 상수·사전은 public-i18n.ts에 두고,
//   클라이언트(스위처)는 그쪽만 import한다(이 파일을 import하면 빌드가 깨진다).
import { cookies } from "next/headers";
import { normalizePublicLocale, type PublicLocale } from "@/lib/seo/public-i18n";

/** 공개 홈 유효 로케일 — 사용자 명시 선택(pub-locale 쿠키) > 기본(ko). */
export async function getPublicLocale(): Promise<PublicLocale> {
  return normalizePublicLocale((await cookies()).get("pub-locale")?.value);
}
