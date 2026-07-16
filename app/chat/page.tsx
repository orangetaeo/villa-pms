// app/chat — 소비자 직행 전체 화면 채팅 (T-webchat-chat-landing)
//
// 인스타그램·카카오 등에서 유입된 소비자가 로그인창 없이 villa-go.net/chat 으로 바로
// 채팅을 쓰는 공개 라우트. iframe 없이 위젯 client(webchat-widget.tsx)를 전체 화면(100dvh)으로
// 직접 재사용한다(standalone=닫기 버튼 숨김 — 전체 화면은 뒤로가기가 닫기).
// ⚠ next-intl·admin 모듈 import 금지(공개 번들 경량·누수 방지) — 문구는 위젯 자체 사전 사용.
import type { Metadata } from "next";
import { cookies } from "next/headers";
import WebChatWidget from "@/app/webchat/widget/webchat-widget";
import { WEBCHAT_LOCALES, type WebChatLocale } from "@/lib/webchat-constants";

// 쿠키를 읽으므로 정적 프리렌더 불가.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Villa GO 채팅 상담",
  description: "푸꾸옥 빌라 문의를 채팅으로 바로 상담하세요.",
  openGraph: {
    title: "Villa GO 채팅 상담",
    description: "푸꾸옥 빌라 문의를 채팅으로 바로 상담하세요.",
  },
};

// ?src= 화이트리스트 — 그 외/미지정은 "chat"(임의 문자열 DB 저장 금지).
const SRC_WHITELIST = new Set(["ig", "kakao", "qr", "direct"]);

export default async function ChatLandingPage({
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

  const srcRaw = typeof sp.src === "string" ? sp.src.trim().toLowerCase() : "";
  const sourcePage = SRC_WHITELIST.has(srcRaw) ? srcRaw : "chat";

  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? null;

  return (
    <WebChatWidget
      initialLocale={initialLocale}
      sourcePage={sourcePage}
      turnstileSiteKey={turnstileSiteKey}
      standalone
    />
  );
}
