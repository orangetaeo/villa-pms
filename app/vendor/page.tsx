// /vendor — 원천 공급자 발주함 메인 (ADR-0023 S3 §6). vi 기본·모바일·라이트.
//   layout이 Role=VENDOR 보장. 발주함/예약현황/정산내역은 클라(VendorBoard)에서
//   /api/vendor/orders를 fetch — 수락/거절 후 즉시 재조회가 필요해 RSC가 아닌 클라 로드.
//   ★ S5 승인 게이트: getVendorForUser로 approvalStatus 확인.
//      PENDING_APPROVAL/REJECTED → 안내 화면(발주함 비노출). APPROVED만 VendorBoard.
import type { Metadata } from "next";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import VendorBoard from "@/components/vendor/vendor-board";
import { getVendorForUser } from "@/lib/vendor-auth";

export const metadata: Metadata = {
  title: "Đơn đặt hàng — Villa Go",
};

export default async function VendorPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "VENDOR") redirect("/login");

  // 임시 비번 사용자는 먼저 비번 변경(미들웨어가 /vendor/profile로 보냄). 여기 도달 시 변경 완료.

  // ── S5 승인 게이트 ─────────────────────────────────────────────
  const vendor = await getVendorForUser(session.user.id);
  // vendor 없음(연결 엔티티 부재) — 정상 흐름 아님. 게이트로 안내(대기 취급).
  const status = vendor?.approvalStatus ?? "PENDING_APPROVAL";

  if (status !== "APPROVED") {
    return (
      <ApprovalGate
        status={status}
        rejectionReason={vendor?.rejectionReason ?? null}
      />
    );
  }

  return <VendorBoard />;
}

// 승인대기·거절 안내 화면 — vi 기본. /vendor/profile(비번변경)은 상태 무관 접근 가능.
async function ApprovalGate({
  status,
  rejectionReason,
}: {
  status: string;
  rejectionReason: string | null;
}) {
  const t = await getTranslations("vendor.approvalGate");
  const rejected = status === "REJECTED";

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <div
        className={`mb-6 flex h-20 w-20 items-center justify-center rounded-full ${
          rejected ? "bg-rose-50" : "bg-amber-50"
        }`}
      >
        <span
          className={`material-symbols-outlined text-5xl [font-variation-settings:'FILL'_1] ${
            rejected ? "text-rose-500" : "text-amber-500"
          }`}
        >
          {rejected ? "cancel" : "hourglass_top"}
        </span>
      </div>
      <h1 className="text-2xl font-bold text-neutral-900">
        {rejected ? t("rejectedTitle") : t("pendingTitle")}
      </h1>
      <p className="mt-3 max-w-sm leading-relaxed text-neutral-500">
        {rejected ? t("rejectedBody") : t("pendingBody")}
      </p>

      {rejected && rejectionReason && (
        <div className="mt-5 w-full rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-left">
          <p className="text-[11px] font-bold uppercase tracking-wider text-rose-400">
            {t("rejectedReasonLabel")}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-rose-700">{rejectionReason}</p>
        </div>
      )}

      {/* 비밀번호 변경은 상태 무관 허용 */}
      <Link
        href="/vendor/profile"
        className="mt-8 inline-flex items-center gap-1.5 text-sm font-semibold text-teal-700 active:scale-95"
      >
        <span className="material-symbols-outlined text-[18px]">lock</span>
        {t("changePassword")}
      </Link>
    </main>
  );
}
