// components/linkify.tsx — XSS 안전 평문 URL 자동링크 (T-webchat-guest-link-share)
//
// 문자열을 정규식으로 분할해 http(s) URL만 <a> React 노드로 렌더한다.
// ⚠ dangerouslySetInnerHTML 금지 — React가 나머지 텍스트를 이스케이프하므로 XSS 안전.
// 서버 의존성 없음(순수 React) → 운영자 스레드(webchat-thread)·방문자 위젯(webchat-widget) 공용.
// linkClassName은 버블 배경 대비를 위해 호출부가 지정(운영자=Tailwind, 위젯=wc-link).
import type { ReactNode } from "react";

const URL_RE = /https?:\/\/[^\s<]+/g;
// URL 끝에 붙은 문장부호는 링크에서 제외(마침표·닫는 괄호 등).
const TRAIL_RE = /[.,;:!?)\]]+$/;

/**
 * 평문 텍스트 + http(s) 자동링크. text에 "http"가 없으면 원문 그대로 반환(fast path).
 * @param linkClassName 링크 <a>에 부여할 클래스(배경 대비색). 미지정 시 브라우저 기본.
 * @param rel 기본 "noopener noreferrer". 위젯은 "noopener noreferrer nofollow" 지정.
 */
export function Linkify({
  text,
  linkClassName,
  rel = "noopener noreferrer",
}: {
  text: string;
  linkClassName?: string;
  rel?: string;
}): ReactNode {
  if (!text.includes("http")) return text;
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    let url = m[0];
    const trail = url.match(TRAIL_RE)?.[0] ?? "";
    if (trail) url = url.slice(0, url.length - trail.length);
    out.push(
      <a
        key={key++}
        href={url}
        target="_blank"
        rel={rel}
        className={linkClassName}
      >
        {url}
      </a>
    );
    if (trail) out.push(trail);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
