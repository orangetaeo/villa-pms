// /zalo-connect — 공급자 Zalo 연결 온보딩 (T3.7 UI, Stitch a0-zalo-connect 변환)
// RSC, vi 라이트, 모바일. 탭바 숨김(풀스크린 플로우).
// 연결 상태(zaloUserId)는 세션에 없으므로 DB에서 조회 — 이미 연결 시 "연결됨" 상태 렌더.
// OA 딥링크·QR은 env(NEXT_PUBLIC_ZALO_OA_URL / NEXT_PUBLIC_ZALO_QR_URL) 있으면 활성, 없으면 비활성/플레이스홀더.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ZaloConnectActions } from "./zalo-connect-actions";

export const metadata: Metadata = {
  title: "Kết nối Zalo — Villa Go",
};

export default async function ZaloConnectPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "SUPPLIER") redirect("/login");

  const t = await getTranslations("zaloConnect");

  // 연결 여부 — 세션에 zaloUserId가 없으므로 DB 조회 (중복 연결 방지)
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { zaloUserId: true },
  });
  const connected = Boolean(user?.zaloUserId);

  const oaUrl = process.env.NEXT_PUBLIC_ZALO_OA_URL ?? null;
  const qrUrl = process.env.NEXT_PUBLIC_ZALO_QR_URL ?? null;

  return (
    <div className="min-h-screen flex flex-col bg-white text-neutral-900">
      {/* TopAppBar */}
      <header className="w-full sticky top-0 bg-white border-b border-neutral-100 z-40">
        <div className="flex items-center justify-between px-4 h-14 w-full">
          <div className="w-10" />
          <h1 className="font-semibold text-lg text-teal-600">{t("topTitle")}</h1>
          <div className="w-10" />
        </div>
      </header>

      <main className="flex-1 flex flex-col px-6 py-4 max-w-md mx-auto w-full">
        {/* Step Indicator — Bước 2/2 */}
        <div className="mb-8">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-bold text-teal-600 uppercase tracking-widest">
              {t("step")}
            </span>
            <span className="text-xs font-medium text-neutral-400">{t("stepLabel")}</span>
          </div>
          <div className="h-1 w-full bg-neutral-200 rounded-full overflow-hidden">
            <div className="h-full w-full bg-teal-600 rounded-full" />
          </div>
        </div>

        {connected ? (
          // 이미 연결됨 — 중복 연결 방지
          <div className="flex flex-col items-center text-center py-8">
            <div className="w-20 h-20 rounded-full bg-green-50 flex items-center justify-center mb-6">
              <span className="material-symbols-outlined text-green-600 text-4xl">
                check_circle
              </span>
            </div>
            <h2 className="text-2xl font-bold text-neutral-900 leading-tight mb-3">
              {t("connectedTitle")}
            </h2>
            <p className="text-neutral-500 leading-relaxed mb-10">{t("connectedDesc")}</p>
            <ZaloConnectActions oaUrl={oaUrl} connected skipLabel={t("done")} />
          </div>
        ) : (
          <>
            {/* Hero */}
            <div className="flex justify-center mb-8 relative">
              <div className="absolute -z-10 w-48 h-48 bg-teal-50 rounded-full blur-3xl opacity-60 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
              <div className="w-40 h-40 rounded-full bg-teal-50 flex items-center justify-center">
                <span className="material-symbols-outlined text-teal-600 text-7xl">
                  forum
                </span>
              </div>
            </div>

            {/* Instructions */}
            <div className="text-center mb-10">
              <h2 className="text-2xl font-bold text-neutral-900 leading-tight mb-4">
                {t("heroTitle")}
              </h2>
              <p className="text-neutral-500 leading-relaxed">{t("heroDesc")}</p>
            </div>

            {/* Primary Action + QR (client: 딥링크/스킵) */}
            <ZaloConnectActions
              oaUrl={oaUrl}
              connected={false}
              addFriendLabel={t("addFriend")}
              oaUnavailableLabel={t("oaUnavailable")}
              qrTitle={t("qrTitle")}
              qrUrl={qrUrl}
              qrPlaceholder={t("qrPlaceholder")}
              skipLabel={t("skip")}
            />
          </>
        )}
      </main>
    </div>
  );
}
