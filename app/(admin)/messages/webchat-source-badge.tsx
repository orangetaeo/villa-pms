"use client";

// sourcePage 뱃지 — 인박스 목록·스레드 헤더 공통.
//   parseSourcePage로 부착면 종류를 해석 → i18n 라벨("게스트 포털"/"제안 링크"/"로그인·가입" 등)
//   + 토큰 프리픽스 코드(g:/p:는 앞 8자)를 monospace 칩으로 병기. 미분류는 원문 그대로.
import { useTranslations } from "next-intl";
import { parseSourcePage } from "./webchat-types";

export function SourcePageLabel({ sourcePage }: { sourcePage: string | null }) {
  const t = useTranslations("adminWebchat");
  const info = parseSourcePage(sourcePage);

  if (info.raw !== null) {
    return <span className="text-sm font-bold text-white truncate">{info.raw}</span>;
  }

  const label = info.labelKey === "unknown" ? t("unknownContact") : t(`source.${info.labelKey}`);
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <span className="text-sm font-bold text-white truncate">{label}</span>
      {info.code && (
        <span className="shrink-0 text-[9px] font-mono font-semibold text-slate-400 bg-slate-700/60 rounded px-1 py-0.5 tabular-nums">
          {info.code}
        </span>
      )}
    </span>
  );
}
