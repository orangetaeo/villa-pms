// /settings — 운영 설정 (T1.7, Stitch b8-settings 변환)
// RSC: prisma 직접 조회(시즌 목록·AppSetting). 폼·액션은 클라이언트 컴포넌트 + API fetch
// b8 구성: 시즌 달력 카드 + 예약 설정(홀드 시간) 카드. 환율 카드는 계약(T1.7) 요구로 동일 스타일 추가
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/format";
import { toDateOnlyString } from "@/lib/date-vn";
import { HOLD_HOURS_DEFAULT_KEY, DEFAULT_HOLD_HOURS } from "@/lib/hold";
import { FX_VND_PER_KRW_KEY, FX_VND_PER_USD_KEY } from "@/lib/pricing";
import { FX_MODE_KEY } from "@/lib/fx-effective";
import {
  CANCELLATION_POLICY_KEY,
  parseCancellationPolicy,
} from "@/lib/cancellation-policy";
import SeasonManager, { type SeasonRow } from "./season-manager";
import HoldHoursForm from "./hold-hours-form";
import FxRateForm from "./fx-rate-form";
import BankContactForm, { type BankContactInitial } from "./bank-contact-form";
import ZaloConnectSettingForm, {
  type ZaloConnectInitial,
} from "./zalo-connect-setting-form";
import ZaloNotifyGroupForm, {
  type ZaloNotifyGroupInitial,
} from "./zalo-notify-group-form";
import { getSystemBotOwnerId } from "@/lib/zalo-credentials";
import { ZALO_ADMIN_NOTIFY_GROUP_ID_KEY } from "@/lib/operator-notify";
import CancellationPolicyForm from "./cancellation-policy-form";
import { getAgreementContent } from "@/lib/agreement-store";
import AgreementForm from "./agreement-form";
import { CoachMark } from "@/components/tour/coach-mark";
import { buildTourLabels, buildTourSteps } from "@/components/tour/tour-definitions";

// 입금 계좌·연락처 키 (공개 제안 페이지가 소비) — /api/settings 화이트리스트와 일치
// 한국(KRW) 계좌 + 베트남(VND) 계좌 + 공용 연락처
const BANK_CONTACT_KEYS = [
  "BANK_NAME",
  "BANK_ACCOUNT_NUMBER",
  "BANK_ACCOUNT_HOLDER",
  "BANK_VN_NAME",
  "BANK_VN_ACCOUNT_NUMBER",
  "BANK_VN_ACCOUNT_HOLDER",
  "CONTACT_KAKAO_URL",
  "CONTACT_PHONE",
] as const;

// Zalo 연결 온보딩(/zalo-connect) QR·딥링크 키 — 미설정 시 env 폴백 (T-zalo-connect-qr-admin-setting)
const ZALO_CONNECT_QR_URL_KEY = "ZALO_CONNECT_QR_URL";
const ZALO_CONNECT_OA_URL_KEY = "ZALO_CONNECT_OA_URL";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pageTitles");
  return { title: `${t("settings")} — Villa Go` };
}

export default async function SettingsPage() {
  const [t, periods, settings, agreement] = await Promise.all([
    getTranslations("adminSettings"),
    prisma.seasonPeriod.findMany({ orderBy: { startDate: "asc" } }),
    prisma.appSetting.findMany({
      where: {
        key: {
          in: [
            HOLD_HOURS_DEFAULT_KEY,
            FX_VND_PER_KRW_KEY,
            FX_VND_PER_USD_KEY,
            FX_MODE_KEY,
            CANCELLATION_POLICY_KEY,
            ...BANK_CONTACT_KEYS,
            ZALO_CONNECT_QR_URL_KEY,
            ZALO_CONNECT_OA_URL_KEY,
            ZALO_ADMIN_NOTIFY_GROUP_ID_KEY,
          ],
        },
      },
    }),
    getAgreementContent(),
  ]);
  const tTour = await getTranslations("tour");

  // @db.Date → "YYYY-MM-DD" 직렬화 (클라이언트 경계, 시간대 오해 방지)
  const seasonRows: SeasonRow[] = periods.map((p) => ({
    id: p.id,
    season: p.season,
    startDate: toDateOnlyString(p.startDate),
    endDate: toDateOnlyString(p.endDate),
    label: p.label,
  }));

  const holdSetting = settings.find((s) => s.key === HOLD_HOURS_DEFAULT_KEY);
  const fxSetting = settings.find((s) => s.key === FX_VND_PER_KRW_KEY);
  const fxUsdSetting = settings.find((s) => s.key === FX_VND_PER_USD_KEY);
  // 유효 환율 모드 — 미설정·기타값은 MANUAL(안전 기본)
  const fxMode = settings.find((s) => s.key === FX_MODE_KEY)?.value === "AUTO" ? "AUTO" : "MANUAL";
  // 취소·환불 정책 — 미설정·손상 시 기본값 폴백
  const cancellationPolicy = parseCancellationPolicy(
    settings.find((s) => s.key === CANCELLATION_POLICY_KEY)?.value
  );

  // 입금 계좌·연락처 초기값 — 미설정은 빈 문자열 (폼 controlled 입력)
  const settingValue = (key: string) => settings.find((s) => s.key === key)?.value ?? "";
  const bankInitial: BankContactInitial = {
    bankName: settingValue("BANK_NAME"),
    accountNumber: settingValue("BANK_ACCOUNT_NUMBER"),
    accountHolder: settingValue("BANK_ACCOUNT_HOLDER"),
    vnBankName: settingValue("BANK_VN_NAME"),
    vnAccountNumber: settingValue("BANK_VN_ACCOUNT_NUMBER"),
    vnAccountHolder: settingValue("BANK_VN_ACCOUNT_HOLDER"),
    kakaoUrl: settingValue("CONTACT_KAKAO_URL"),
    phone: settingValue("CONTACT_PHONE"),
  };

  // Zalo 연결 온보딩 QR·딥링크 — 저장값 우선, 비어 있으면 env 폴백 여부만 안내(값은 노출 안 함)
  const zaloConnectInitial: ZaloConnectInitial = {
    qrUrl: settingValue(ZALO_CONNECT_QR_URL_KEY),
    oaUrl: settingValue(ZALO_CONNECT_OA_URL_KEY),
    qrFromEnv:
      settingValue(ZALO_CONNECT_QR_URL_KEY) === "" &&
      Boolean(process.env.NEXT_PUBLIC_ZALO_QR_URL),
    oaFromEnv:
      settingValue(ZALO_CONNECT_OA_URL_KEY) === "" &&
      Boolean(process.env.NEXT_PUBLIC_ZALO_OA_URL),
  };

  // 운영자 Zalo 알림 그룹방(ADR-0039) — 시스템봇 소유자의 GROUP 대화 목록 + 현재 설정값.
  // 시스템봇 미연결(소유자 미상)이면 목록은 비고 폼이 안내 표시.
  const notifyGroupOwnerId = await getSystemBotOwnerId();
  const notifyGroupConversations = notifyGroupOwnerId
    ? await prisma.zaloConversation.findMany({
        where: { ownerAdminId: notifyGroupOwnerId, threadType: "GROUP" },
        orderBy: { lastMessageAt: "desc" },
        select: { zaloUserId: true, displayName: true, nickname: true },
      })
    : [];
  const zaloNotifyGroupInitial: ZaloNotifyGroupInitial = {
    selectedGroupId: settingValue(ZALO_ADMIN_NOTIFY_GROUP_ID_KEY) || null,
    groups: notifyGroupConversations.map((c) => ({
      id: c.zaloUserId,
      name: c.nickname ?? c.displayName,
    })),
    botConnected: notifyGroupOwnerId !== null,
  };

  // 홀드 시간 — 미설정/파싱 불가 시 기본 48 표시 (lib/hold DEFAULT_HOLD_HOURS)
  const parsedHold = holdSetting ? Number.parseInt(holdSetting.value, 10) : Number.NaN;
  const initialHoldHours =
    Number.isInteger(parsedHold) && parsedHold >= 1 && parsedHold <= 168
      ? parsedHold
      : DEFAULT_HOLD_HOURS;

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* 페이지 타이틀 + 브레드크럼 (b8) */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">{t("title")}</h1>
          <p className="text-sm text-slate-500 mt-1">{t("subtitle")}</p>
        </div>
        <nav className="flex text-xs text-slate-500 gap-2 whitespace-nowrap">
          <span>{t("breadcrumbAdmin")}</span>
          <span>/</span>
          <span className="text-slate-300">{t("breadcrumbCurrent")}</span>
        </nav>
      </div>

      {/* Card 1: 시즌 달력 (b8) — 목록은 RSC 조회, 폼·액션은 클라이언트 */}
      {/* 코치마크 앵커 — SeasonManager 무수정 순수 래퍼 */}
      <div data-tour="settings-season">
        <SeasonManager periods={seasonRows} />
      </div>

      {/* Card 2: 예약 설정 — 가예약 기본 유지 시간 (b8 스테퍼) */}
      {/* 코치마크 앵커 — HoldHoursForm 무수정 순수 래퍼 */}
      <div data-tour="settings-hold">
        <HoldHoursForm initialHours={initialHoldHours} />
      </div>

      {/* Card 3: 환율 — KRW(기존)+USD(신규) 수동환율 + 모드(수동/자동) 토글 (후속확장3) */}
      <FxRateForm
        initialKrw={fxSetting?.value ?? null}
        initialUsd={fxUsdSetting?.value ?? null}
        mode={fxMode}
        krwUpdatedAtText={fxSetting ? formatDateTime(fxSetting.updatedAt) : null}
        usdUpdatedAtText={fxUsdSetting ? formatDateTime(fxUsdSetting.updatedAt) : null}
      />

      {/* Card 4: 입금 계좌·연락처 (b8 Card 3 변환, T1.7-bank-contact) */}
      <BankContactForm initial={bankInitial} />

      {/* Card 4b: Zalo 연결 온보딩 QR·친구추가 링크 (T-zalo-connect-qr-admin-setting).
          공급자·청소 온보딩(/zalo-connect)에 노출. 비우면 env 폴백 */}
      <ZaloConnectSettingForm initial={zaloConnectInitial} />

      {/* Card 4c: 운영자 Zalo 알림 그룹방 (ADR-0039) — 운영자 업무 알림을 그룹방 1건으로 수신.
          미설정 시 운영자 개별 DM 발송(폴백) */}
      <ZaloNotifyGroupForm initial={zaloNotifyGroupInitial} />

      {/* Card 5: 취소·환불 정책 — 공개 제안 페이지 표시 (#6b) */}
      <CancellationPolicyForm initial={cancellationPolicy} />

      {/* Card 6: 이용 동의서 — 전 빌라 공용 단일 동의서 편집 (T-admin-agreement-editor).
          저장 전엔 코드 기본값 폴백 → 편집·발행 시 체크인·인쇄 동의서에 반영 */}
      <AgreementForm initial={agreement} />

      {/* 미니바 회사표준은 재고(/inventory) "미니바 품목" 탭으로 이동(2026-06-26). 여기 카드 제거. */}

      {/* 서비스 카탈로그 카드는 사이드바 '부가서비스' 그룹(/settings/services)과 중복이라 제거(2026-07-09).
          부가서비스 공급자 카드도 사이드바 '부가서비스' 그룹(/settings/vendors)으로 이동(2026-07-12). */}

      {/* Card 7: Zalo 봇 연결 (ADR-0006) — 별도 페이지 링크 */}
      <Link
        href="/settings/zalo"
        className="flex items-center justify-between bg-admin-card border border-slate-800 rounded-xl p-6 hover:border-slate-700 transition-colors group"
      >
        <div className="flex items-center gap-4">
          <span className="material-symbols-outlined text-admin-primary text-3xl">forum</span>
          <div>
            <h2 className="text-lg font-bold text-white">{t("zaloCardTitle")}</h2>
            <p className="text-sm text-slate-500 mt-0.5">{t("zaloCardDesc")}</p>
          </div>
        </div>
        <span className="text-sm font-bold text-admin-primary group-hover:underline whitespace-nowrap">
          {t("zaloCardCta")} →
        </span>
      </Link>

      {/* 코치마크 투어 — 첫 진입 자동 1회, 이후 "?"로 재생 (T-tutorial-onboarding-6) */}
      <CoachMark
        tourId="adminSettings"
        steps={buildTourSteps(tTour, "adminSettings")}
        labels={buildTourLabels(tTour)}
      />
    </div>
  );
}
