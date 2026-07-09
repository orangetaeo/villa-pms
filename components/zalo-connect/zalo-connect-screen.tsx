// zalo-connect 공용 화면 (RSC) — 역할별 QR 온보딩 커버리지.
//   SUPPLIER·CLEANER(공급자 포털)·VENDOR·PARTNER 포털이 얇은 래퍼 페이지로 재사용.
//   연결 상태(zaloUserId)는 세션에 없으므로 DB에서 조회 — 이미 연결 시 "연결됨" 상태 렌더.
//   OA 딥링크·QR은 관리자 설정(AppSetting ZALO_CONNECT_OA_URL / ZALO_CONNECT_QR_URL) 우선,
//   미설정 시 env(NEXT_PUBLIC_ZALO_OA_URL / NEXT_PUBLIC_ZALO_QR_URL) 폴백. 둘 다 없으면 비활성/플레이스홀더.
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import type { AppLocale } from "@/lib/locale";
import { ZaloConnectActions } from "@/components/zalo-connect/zalo-connect-actions";

export async function ZaloConnectScreen({
  userId,
  doneHref,
  locale,
}: {
  userId: string;
  /** 완료/스킵 후 이동 경로 — 역할별 홈. */
  doneHref: string;
  /** 명시 locale(포털별 규칙 결과). 미지정 시 요청 locale 사용(SUPPLIER 기존 동작 보존). */
  locale?: AppLocale;
}) {
  // 청소직원은 vi 고정 등 포털별 규칙이 결정한 locale을 명시 전달. SUPPLIER는 요청 locale.
  const t = locale
    ? await getTranslations({ locale, namespace: "zaloConnect" })
    : await getTranslations("zaloConnect");

  // 연결 여부 — 세션에 zaloUserId가 없으므로 DB 조회 (중복 연결 방지)
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { zaloUserId: true },
  });
  const connected = Boolean(user?.zaloUserId);

  // OA 딥링크·QR — 관리자 설정(AppSetting) 우선, 미설정 시 env 폴백 (T-zalo-connect-qr-admin-setting).
  const zaloSettings = await prisma.appSetting.findMany({
    where: { key: { in: ["ZALO_CONNECT_OA_URL", "ZALO_CONNECT_QR_URL"] } },
    select: { key: true, value: true },
  });
  const settingOf = (key: string) => {
    const v = zaloSettings.find((s) => s.key === key)?.value?.trim();
    return v ? v : null;
  };
  const oaUrl = settingOf("ZALO_CONNECT_OA_URL") ?? process.env.NEXT_PUBLIC_ZALO_OA_URL ?? null;
  const qrUrl = settingOf("ZALO_CONNECT_QR_URL") ?? process.env.NEXT_PUBLIC_ZALO_QR_URL ?? null;

  return (
    <div className="min-h-screen flex flex-col bg-white text-neutral-900">
      {/* 화면 제목 — 공용 포털 헤더 아래 본문 헤딩(기존 sticky 앱바 강등, 이중 헤더 방지) */}
      <main className="flex-1 flex flex-col px-6 py-6 max-w-md mx-auto w-full">
        <h1 className="mb-6 text-center font-semibold text-lg text-teal-600">{t("topTitle")}</h1>
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
            <ZaloConnectActions oaUrl={oaUrl} connected skipLabel={t("done")} doneHref={doneHref} />
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
              doneHref={doneHref}
            />
          </>
        )}
      </main>
    </div>
  );
}
