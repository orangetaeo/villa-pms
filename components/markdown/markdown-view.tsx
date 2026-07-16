// 다크 대시보드용 마크다운 뷰어 (운영자 문서 뷰어 전용).
//
// 렌더러: react-markdown + remark-gfm(GFM 표·취소선 등).
// ★ sanitize: react-markdown은 기본적으로 raw HTML을 렌더하지 않는다(rehype-raw 미사용).
//   마크다운 내 <script>·<img onerror> 등은 그대로 텍스트로 escape되어 XSS 경로가 없다.
//   콘텐츠는 repo 내부 파일(사용자 입력 아님)이지만 기본 안전 동작을 유지한다.
//
// 스타일: @tailwindcss/typography(prose) 플러그인이 프로젝트에 없으므로 요소별 components
//   매핑으로 다크 테마 토큰(admin-*)에 맞춰 직접 스타일링한다.

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
  h1: ({ children }) => (
    <h1 className="mt-8 mb-4 text-2xl font-bold text-white first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-8 mb-3 border-b border-admin-border pb-2 text-xl font-bold text-white">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-6 mb-2 text-lg font-semibold text-white">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-4 mb-2 text-base font-semibold text-slate-200">{children}</h4>
  ),
  p: ({ children }) => (
    <p className="my-3 text-sm leading-relaxed text-slate-300">{children}</p>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-admin-primary underline underline-offset-2 hover:text-blue-400"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="font-bold text-white">{children}</strong>,
  em: ({ children }) => <em className="italic text-slate-200">{children}</em>,
  ul: ({ children }) => (
    <ul className="my-3 list-disc space-y-1 pl-6 text-sm text-slate-300">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-3 list-decimal space-y-1 pl-6 text-sm text-slate-300">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-4 border-admin-border pl-4 text-sm italic text-admin-muted">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-6 border-admin-border" />,
  // 인라인 코드 — pre 안의 code는 아래 pre가 bg를 리셋(중복 배경 방지)
  code: ({ children }) => (
    <code className="rounded bg-admin-card px-1.5 py-0.5 font-mono text-xs text-teal-300">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="my-4 overflow-x-auto rounded-lg border border-admin-border bg-admin-card p-4 text-xs text-slate-300 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-slate-300">
      {children}
    </pre>
  ),
  // 표는 가로 스크롤 래퍼로 감싸 좁은 화면에서도 본문이 넘치지 않게 한다
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto rounded-lg border border-admin-border">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-admin-card">{children}</thead>,
  th: ({ children }) => (
    <th className="border border-admin-border px-3 py-2 text-left font-bold text-white">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-admin-border px-3 py-2 align-top text-slate-300">
      {children}
    </td>
  ),
};

export default function MarkdownView({ content }: { content: string }) {
  return (
    <div className="max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
