"use client";

// 통합 회원가입 유형 선택 (ADR-0028 PP2) — /signup 진입.
//   3가지 가입 경로로 분기: 빌라 공급자 / 부가서비스 공급자(VENDOR) / 파트너(여행사·랜드사).
//   라이트 톤(기존 signup 톤). 라벨은 page에서 prop으로 주입(서버 getTranslations).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { VillaGoMark, VillaGoWordmark } from "@/components/brand/villa-go-logo";

interface ChooserLabels {
  headerTitle: string;
  title: string;
  subtitle: string;
  supplierTitle: string;
  supplierDesc: string;
  cleanerTitle: string;
  cleanerDesc: string;
  vendorTitle: string;
  vendorDesc: string;
  partnerTitle: string;
  partnerDesc: string;
  hasAccount: string;
  loginLink: string;
  back: string;
}

interface ChooserCard {
  href: string;
  icon: string;
  title: string;
  desc: string;
}

export default function SignupTypeChooser({ labels }: { labels: ChooserLabels }) {
  const router = useRouter();

  const cards: ChooserCard[] = [
    {
      href: "/signup?type=supplier",
      icon: "villa",
      title: labels.supplierTitle,
      desc: labels.supplierDesc,
    },
    {
      href: "/signup?type=cleaner",
      icon: "cleaning_services",
      title: labels.cleanerTitle,
      desc: labels.cleanerDesc,
    },
    {
      href: "/vendor-signup",
      icon: "storefront",
      title: labels.vendorTitle,
      desc: labels.vendorDesc,
    },
    {
      href: "/signup?type=partner",
      icon: "groups",
      title: labels.partnerTitle,
      desc: labels.partnerDesc,
    },
  ];

  return (
    <div className="bg-white text-neutral-900 min-h-screen flex flex-col w-full">
      {/* 상단 내비게이션 */}
      <header className="w-full top-0 sticky bg-white border-b border-neutral-100 z-50">
        <div className="flex items-center px-4 h-16 w-full">
          <button
            className="text-neutral-500 active:scale-95 transition-transform p-2"
            type="button"
            onClick={() => router.push("/login")}
            aria-label={labels.back}
          >
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <h1 className="font-headline font-semibold text-lg text-neutral-900 ml-2">
            {labels.headerTitle}
          </h1>
        </div>
      </header>

      <main className="flex-1 px-6 pt-8 pb-12 max-w-md mx-auto w-full">
        {/* 브랜드 헤더 */}
        <div className="mb-8">
          <span className="flex items-center gap-1.5 mb-2">
            <VillaGoMark className="h-5 w-auto" />
            <VillaGoWordmark
              className="font-headline text-base"
              villa="text-slate-900"
              go="text-teal-600"
            />
          </span>
          <h2 className="text-3xl font-bold text-neutral-900 tracking-tight">
            {labels.title}
          </h2>
          <p className="text-neutral-500 mt-2 leading-relaxed">{labels.subtitle}</p>
        </div>

        {/* 유형 카드 */}
        <div className="space-y-4">
          {cards.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className="group flex items-center gap-4 w-full p-5 bg-neutral-50 border border-neutral-200 rounded-2xl transition-all hover:border-teal-400 hover:bg-white active:scale-[0.99]"
            >
              <div className="shrink-0 w-12 h-12 rounded-xl bg-teal-50 flex items-center justify-center group-hover:bg-teal-100 transition-colors">
                <span className="material-symbols-outlined text-teal-600 text-[26px]">
                  {c.icon}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-neutral-900 text-base">{c.title}</p>
                <p className="text-sm text-neutral-500 mt-0.5 leading-snug">{c.desc}</p>
              </div>
              <span className="material-symbols-outlined text-neutral-400 group-hover:text-teal-600 transition-colors">
                chevron_right
              </span>
            </Link>
          ))}
        </div>

        {/* 로그인 링크 */}
        <Link
          className="block text-center text-neutral-600 font-medium py-2 mt-8"
          href="/login"
        >
          {labels.hasAccount}{" "}
          <span className="text-teal-600 font-bold">{labels.loginLink}</span>
        </Link>
      </main>

      {/* 배경 장식 */}
      <div className="fixed -top-24 -right-24 w-64 h-64 bg-teal-50 rounded-full blur-3xl -z-10 opacity-60" />
      <div className="fixed -bottom-24 -left-24 w-64 h-64 bg-amber-50 rounded-full blur-3xl -z-10 opacity-40" />
    </div>
  );
}
