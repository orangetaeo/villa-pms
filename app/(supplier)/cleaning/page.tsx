// 청소(Dọn dẹp) placeholder — 실화면은 T3.x (계약 T1.4: 후속 태스크 안내만, 임의 디자인 금지)
import { auth } from "@/auth";
import { getTranslations } from "next-intl/server";

export default async function CleaningPage() {
  const session = await auth();
  const locale = session?.user?.locale === "ko" ? "ko" : "vi";
  const t = await getTranslations({ locale, namespace: "cleaning" });

  return (
    <div className="px-4 pt-6">
      <h1 className="mb-6 text-xl font-bold text-neutral-900">{t("title")}</h1>
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-gray-100 bg-white p-10 text-center shadow-sm">
        <span className="material-symbols-outlined text-5xl text-teal-600">
          cleaning_services
        </span>
        <p className="text-sm font-medium text-neutral-600">{t("comingSoon")}</p>
      </div>
    </div>
  );
}
