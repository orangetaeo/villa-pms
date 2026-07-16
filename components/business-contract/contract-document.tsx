"use client";

// 계약 본문 렌더 (T-business-contract-esign) — 서명용 정본 md(치환 완료본)를 흰 종이(A4)에 표시.
//   운영자(다크 대시보드)·상대방(라이트 포털) 양쪽에서 재사용 → 항상 흰 배경·검정 글자로 렌더해
//   화면·인쇄 모두 문서처럼 보이게 한다(@media print는 globals.css .print-sheet 규칙 재사용).
//   ★ `<!-- signature-area -->` 앵커 위치에 서명 블록(서명 이미지+성명+서명일)을 주입한다.
//      앵커가 없으면 본문 끝에 붙인다. (정본 md는 LOC가 관리 — 앵커 유무 모두 견고하게 처리)
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTranslations } from "next-intl";

const SIGNATURE_ANCHOR = "<!-- signature-area -->";

// 흰 종이용 라이트 마크다운 컴포넌트(다크 MarkdownView와 별도 — 인쇄 정합).
const mdComponents: Components = {
  h1: ({ children }) => (
    <h1 className="mt-6 mb-4 text-2xl font-black text-slate-900 first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-7 mb-3 border-b border-slate-200 pb-2 text-xl font-bold text-slate-900">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-5 mb-2 text-base font-bold text-slate-900">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-4 mb-2 text-sm font-semibold text-slate-800">{children}</h4>
  ),
  p: ({ children }) => (
    <p className="my-2.5 text-sm leading-relaxed text-slate-700">{children}</p>
  ),
  strong: ({ children }) => <strong className="font-bold text-slate-900">{children}</strong>,
  em: ({ children }) => <em className="italic text-slate-800">{children}</em>,
  ul: ({ children }) => (
    <ul className="my-2.5 list-disc space-y-1 pl-5 text-sm text-slate-700">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2.5 list-decimal space-y-1 pl-5 text-sm text-slate-700">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  hr: () => <hr className="my-5 border-slate-200" />,
  a: ({ href, children }) => (
    <a href={href} className="text-teal-700 underline underline-offset-2">
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-4 border-slate-200 pl-4 text-sm italic text-slate-500">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-slate-300">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-slate-100">{children}</thead>,
  th: ({ children }) => (
    <th className="border border-slate-300 px-3 py-2 text-left font-bold text-slate-900">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-slate-300 px-3 py-2 align-top text-slate-700">{children}</td>
  ),
};

function Markdown({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
      {content}
    </ReactMarkdown>
  );
}

export default function ContractDocument({
  body,
  signed,
  signatureUrl,
  signName,
  signedAt,
}: {
  /** 치환 완료된 정본 md 본문(mine API의 body 또는 운영자 서버 렌더). */
  body: string;
  signed: boolean;
  signatureUrl?: string | null;
  signName?: string | null;
  /** ISO 문자열 또는 표시용 날짜. */
  signedAt?: string | null;
}) {
  const t = useTranslations("businessContract");

  const anchorIdx = body.indexOf(SIGNATURE_ANCHOR);
  const before = anchorIdx >= 0 ? body.slice(0, anchorIdx) : body;
  const after = anchorIdx >= 0 ? body.slice(anchorIdx + SIGNATURE_ANCHOR.length) : null;

  const signatureBlock = (
    <div className="my-5 break-inside-avoid">
      {signed && signatureUrl ? (
        <div className="inline-flex flex-col items-start gap-1">
          {/* 서명 이미지 — 비공개 서빙(/api/passports/…), 본인·운영자만 접근 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={signatureUrl}
            alt={t("signed.signatureImage")}
            className="h-20 w-auto max-w-[240px] object-contain"
          />
          <div className="border-t border-slate-400 pt-1 text-xs text-slate-700">
            {signName && <span className="font-bold text-slate-900">{signName}</span>}
            {signedAt && <span className="ml-2 tabular-nums text-slate-500">{signedAt}</span>}
          </div>
        </div>
      ) : (
        <div className="inline-block min-w-[240px]">
          <div className="h-16 border-b border-slate-400" />
          <p className="mt-1 text-xs text-slate-400">{t("sign.signature")}</p>
        </div>
      )}
    </div>
  );

  return (
    <article className="print-page mx-auto max-w-3xl rounded-xl border border-slate-300 bg-white px-6 py-8 text-slate-900 shadow-sm sm:px-10">
      <Markdown content={before} />
      {signatureBlock}
      {after !== null && after.trim() !== "" && <Markdown content={after} />}
    </article>
  );
}
