// app/webchat/widget — iframe 본체(공개, 비로그인) (T-webchat-mvp)
//
// 로더가 iframe으로 로드하는 채팅 위젯. 서버에서 p-locale 쿠키·src 쿼리만 읽어 초기값을
// 넘기고, 실제 UI/폴링/발신은 client(webchat-widget.tsx)가 담당한다.
// ⚠ next-intl·admin 모듈 import 금지(공개 번들 경량·누수 방지) — 문구는 자체 사전 사용.
import { cookies } from "next/headers";
import WebChatWidget from "./webchat-widget";
import { WEBCHAT_LOCALES, type WebChatLocale } from "@/lib/webchat-constants";

// 쿠키를 읽으므로 정적 프리렌더 불가.
export const dynamic = "force-dynamic";

export default async function WebChatWidgetPage({
  searchParams,
}: {
  searchParams: Promise<{ src?: string }>;
}) {
  const sp = await searchParams;
  const store = await cookies();

  // 언어: p-locale 쿠키가 지원 언어면 채택, 아니면 null(→ 클라가 navigator.language 판정).
  const raw = store.get("p-locale")?.value?.trim().toLowerCase();
  const initialLocale: WebChatLocale | null =
    raw && (WEBCHAT_LOCALES as readonly string[]).includes(raw)
      ? (raw as WebChatLocale)
      : null;

  const src = typeof sp.src === "string" ? sp.src.slice(0, 300) : "";
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? null;

  return (
    <WebChatWidget
      initialLocale={initialLocale}
      sourcePage={src}
      turnstileSiteKey={turnstileSiteKey}
    />
  );
}
