// components/webchat-link-card.tsx — 웹챗 링크 카드 렌더(제목·부제·"열기") (T-webchat-cards-inbox-zalo-links)
//
// 링크 발송 메시지(kind 있음)를 구조화 카드로 표시. 방문자 위젯(라이트)·운영자 스레드(다크) 공용.
// ⚠ 순수 프레젠테이션 — 서버 의존성 없음(위젯 번들 안전), 훅 없음. 문구·className은 호출부가 주입한다.
// XSS 안전: 제목·부제·버튼 문구는 React 텍스트(자동 이스케이프), url은 href로만·스킴 검증(javascript: 차단).
import type { ReactNode } from "react";
import { isSafeCardUrl } from "@/lib/webchat-card";

export function WebChatLinkCard({
  title,
  subtitle,
  openLabel,
  url,
  rel = "noopener noreferrer",
  className,
  titleClassName,
  subtitleClassName,
  buttonClassName,
}: {
  /** 카드 제목(kind별·발신자 언어로 이미 해석된 문구). */
  title: string;
  /** 카드 부제(선택 — 짧은 안내). */
  subtitle?: string;
  /** "열기" 버튼 라벨. */
  openLabel: string;
  /** 링크(http(s) 절대 또는 동일 오리진 상대경로). 스킴 불량 시 버튼 미렌더. */
  url: string;
  /** <a rel>. 기본 "noopener noreferrer"(위젯은 nofollow 추가). */
  rel?: string;
  className?: string;
  titleClassName?: string;
  subtitleClassName?: string;
  buttonClassName?: string;
}): ReactNode {
  const safe = isSafeCardUrl(url);
  return (
    <div className={className}>
      <div className={titleClassName}>{title}</div>
      {subtitle ? <div className={subtitleClassName}>{subtitle}</div> : null}
      {safe ? (
        <a href={url} target="_blank" rel={rel} className={buttonClassName}>
          {openLabel}
        </a>
      ) : null}
    </div>
  );
}
