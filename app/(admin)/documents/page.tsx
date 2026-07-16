// /documents — 운영자 전용 사업 계약서 문서 뷰어 (ADMIN, 재무 등급).
//
// RSC: auth + isOperator 가드(없으면 /login). ★ 문서에 마진 전략·원가 구조가 포함되므로
//   canViewFinance(OWNER/MANAGER)만 열람 — STAFF는 /dashboard로 바운스(메뉴에서도 숨김).
// ★ 파일 접근: slug→파일은 registry의 하드코딩 화이트리스트로만 해석(path traversal 봉쇄).
//   화이트리스트 밖 slug는 notFound(). 콘텐츠는 repo 내부 파일을 런타임 fs.readFile로 읽는다.
import fs from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { canViewFinance, isOperator } from "@/lib/permissions";
import MarkdownView from "@/components/markdown/markdown-view";
import { CONTRACTS_DIR, DOC_REGISTRY, resolveDoc } from "./registry";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminDocuments");
  return { title: `${t("title")} — Villa Go` };
}

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ doc?: string }>;
}) {
  // 운영자 가드 — layout과 이중화(방어적)
  const session = await auth();
  if (!session?.user?.id || !isOperator(session.user.role)) redirect("/login");
  // 재무 게이트 — 마진·원가 포함 문서라 STAFF 차단(canViewFinance=OWNER/MANAGER)
  if (!canViewFinance(session.user.role)) redirect("/dashboard");

  const t = await getTranslations("adminDocuments");
  const { doc: docParam } = await searchParams;

  // ── 뷰어 모드 (?doc=<slug>) ──
  if (docParam !== undefined) {
    const entry = resolveDoc(docParam);
    if (!entry) notFound();

    const filePath = path.join(process.cwd(), ...CONTRACTS_DIR, entry.file);
    let content: string;
    try {
      content = await fs.readFile(filePath, "utf8");
    } catch {
      notFound();
    }

    return (
      <div className="mx-auto max-w-4xl">
        <Link
          href="/documents"
          className="mb-4 inline-flex items-center gap-1 text-sm text-admin-muted transition-colors hover:text-white"
        >
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          {t("backToList")}
        </Link>

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <span className="material-symbols-outlined text-admin-primary">{entry.icon}</span>
          <h1 className="text-2xl font-bold text-white">{t(`docs.${entry.slug}.name`)}</h1>
          <span className="rounded-full bg-admin-pending/15 px-2.5 py-1 text-xs font-bold text-admin-pending">
            {t("statusDraft")}
          </span>
        </div>

        <article className="rounded-xl border border-admin-border bg-admin-card/40 p-5 md:p-8">
          <MarkdownView content={content} />
        </article>
      </div>
    );
  }

  // ── 목록 모드 ──
  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-white">{t("title")}</h1>
        <p className="mt-1 text-sm text-admin-muted">{t("subtitle")}</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {DOC_REGISTRY.map((doc) => (
          <Link
            key={doc.slug}
            href={`/documents?doc=${doc.slug}`}
            className="group flex flex-col gap-3 rounded-xl border border-admin-border bg-admin-card p-5 transition-colors hover:border-admin-primary"
          >
            <div className="flex items-center justify-between">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-admin-primary/15 text-admin-primary">
                <span className="material-symbols-outlined">{doc.icon}</span>
              </span>
              <span className="rounded-full bg-admin-pending/15 px-2.5 py-1 text-[11px] font-bold text-admin-pending">
                {t("statusDraft")}
              </span>
            </div>
            <div>
              <h2 className="text-base font-bold text-white group-hover:text-admin-primary">
                {t(`docs.${doc.slug}.name`)}
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-admin-muted">
                {t(`docs.${doc.slug}.desc`)}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
