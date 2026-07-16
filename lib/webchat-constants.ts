// lib/webchat-constants.ts — 웹챗 클라이언트/서버 공용 상수 (T-webchat-mvp)
//
// lib/webchat.ts는 node:crypto·prisma·gemini를 import하는 **서버 전용** 모듈이라
// 방문자 위젯(client)·로더에서 직접 import 불가. 폴링 수치·본문 상한·지원 언어처럼
// 양쪽이 공유해야 하는 순수 상수만 이 파일에 두고, webchat.ts가 재-export한다(단일 원천).
// ⚠ 여기에는 서명키·prisma·번역 로직 등 서버 의존을 절대 넣지 않는다.

/** 위젯 지원 5언어. visitorLocale은 자유 확장이나 UI 칩·번역 대상은 이 집합. */
export const WEBCHAT_LOCALES = ["vi", "ko", "en", "zh", "ru"] as const;
export type WebChatLocale = (typeof WEBCHAT_LOCALES)[number];

/** 메시지 본문 최대 길이(서버 400과 동일 — 클라 입력 제한). */
export const MSG_MAX_LEN = 2000;

/** 폴링 권장 파라미터(FE 참조 — 서버는 강제 안 함, 기획 §3·§9). */
export const POLL_MIN_MS = 3_000;
export const POLL_MAX_MS = 5_000;
export const POLL_IDLE_BACKOFF_MS = 15_000;
export const POLL_IDLE_AFTER_MS = 60_000;

/** navigator.language 앞 2자 → 지원 locale 매핑(미지원은 en 폴백). */
export function mapNavigatorLocale(lang: string | null | undefined): WebChatLocale {
  const two = (lang ?? "").trim().slice(0, 2).toLowerCase();
  return (WEBCHAT_LOCALES as readonly string[]).includes(two)
    ? (two as WebChatLocale)
    : "en";
}

/** 임의 문자열이 지원 locale이면 그대로, 아니면 en. */
export function coerceWebChatLocale(v: string | null | undefined): WebChatLocale {
  const s = (v ?? "").trim().toLowerCase();
  return (WEBCHAT_LOCALES as readonly string[]).includes(s) ? (s as WebChatLocale) : "en";
}
