import type { AbstractIntlMessages } from "next-intl";

/**
 * [QA D-2/D-2b] next-intl 메시지 화이트리스트 헬퍼.
 *
 * 전체 messages JSON을 NextIntlClientProvider에 넘기면 모든 라벨이
 * RSC payload(HTML)에 직렬화된다 — 공급자 화면에 admin 라벨(마진·판매가 등),
 * 외부 제안 페이지에 내부 운영 구조가 노출되는 권한 누수 경로.
 *
 * 각 레이아웃은 자기 구역의 클라이언트 컴포넌트가 useTranslations로
 * "실제 사용하는" 최상위 네임스페이스만 추려서 전달할 것.
 * (서버 컴포넌트의 getTranslations는 직렬화와 무관 — 목록에 넣지 않는다)
 */
export function pickMessages(
  all: AbstractIntlMessages,
  namespaces: readonly string[]
): AbstractIntlMessages {
  const picked: AbstractIntlMessages = {};
  for (const ns of namespaces) {
    if (all[ns] !== undefined) picked[ns] = all[ns];
  }
  return picked;
}
