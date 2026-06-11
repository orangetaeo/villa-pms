import { auth } from "@/auth";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

export default async function MyVillasPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>;
}) {
  const session = await auth();
  const locale = session?.user?.locale === "ko" ? "ko" : "vi";
  const t = await getTranslations({ locale, namespace: "myVillas" });
  const { created } = await searchParams;

  return (
    <div className="px-4 pt-6 pb-28">
      {created === "1" && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-teal-100 bg-teal-50 p-4">
          <span className="material-symbols-outlined text-teal-600">check_circle</span>
          <p className="text-sm font-medium text-teal-900">{t("created")}</p>
        </div>
      )}
      <h1 className="mb-2 text-xl font-bold text-neutral-900">{t("title")}</h1>
      <p className="text-sm text-neutral-500">{t("greeting", { name: session?.user?.name ?? "" })}</p>

      {/* 마법사 진입 FAB — a6 디자인 톤 (teal 플로팅) */}
      <Link
        href="/my-villas/new"
        className="fixed bottom-6 right-4 z-40 flex items-center gap-2 rounded-full bg-teal-600 px-6 py-4 text-white shadow-xl transition-all hover:bg-teal-700 active:scale-95"
      >
        <span className="material-symbols-outlined">add</span>
        <span className="font-bold">{t("add")}</span>
      </Link>
    </div>
  );
}
