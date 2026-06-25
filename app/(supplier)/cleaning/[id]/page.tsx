// 청소 사진 제출 (T3.8, SPEC F4) — design/stitch/a4-cleaning-photos 변환
// 소유/배정 검증: SUPPLIER=자기 빌라, CLEANER=배정분 — 아니면 404 (존재 비노출)
// 슬롯 구성은 빌라 등록(T1.1)과 동일 — buildPhotoSlots(bedrooms/bathrooms/hasPool)
// i18n: (supplier) layout 클라 네임스페이스 화이트리스트에 cleaning이 없으므로
//       (layout.tsx 수정 금지 구역) 라벨은 RSC에서 번역해 props로 전달한다
import type { Metadata } from "next";
import { auth } from "@/auth";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSupplierLocale } from "@/lib/locale";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  buildPhotoSlots,
  type PhotoSlot,
} from "@/app/(supplier)/my-villas/new/wizard-types";
import { CleaningSubmit, type SlotProp, type SubmitLabels } from "./cleaning-submit";
import CleaningPhotosView from "./cleaning-photos-view";
import { formatVillaName } from "@/lib/villa-name";

export const metadata: Metadata = {
  title: "Dọn dẹp xong — Villa Go",
};

export default async function CleaningTaskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { role, id: userId } = session.user;
  if (role !== "SUPPLIER" && role !== "CLEANER") redirect("/");

  const { id } = await params;
  const task = await prisma.cleaningTask.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      photoUrls: true,
      rejectNote: true,
      assigneeId: true, // 배정 검증용 — 클라이언트로 비전달
      villa: {
        select: {
          supplierId: true, // 소유 검증용 — 클라이언트로 비전달
          name: true,
          nameVi: true,
          bedrooms: true,
          bathrooms: true,
          hasPool: true,
        },
      },
    },
  });
  // 미존재·타인 빌라·비배정 모두 404 — 존재 비노출 (submit API와 동일 규칙)
  if (!task) notFound();
  if (role === "SUPPLIER" && task.villa.supplierId !== userId) notFound();
  if (role === "CLEANER" && task.assigneeId !== userId) notFound();

  const villaDisplayName = formatVillaName({
    name: task.villa.name,
    nameVi: task.villa.nameVi,
  });

  const locale = await getSupplierLocale(session.user.locale);
  const t = await getTranslations({ locale, namespace: "cleaning" });
  // 공간 라벨은 빌라 등록 사진 단계(wizard.photos)와 동일 키 재사용 — 중복 정의 금지
  const tp = await getTranslations({ locale, namespace: "wizard.photos" });

  const slots = buildPhotoSlots(
    task.villa.bedrooms,
    task.villa.bathrooms,
    task.villa.hasPool
  );
  function slotLabel(slot: PhotoSlot): string {
    switch (slot.space) {
      case "EXTERIOR":
        return tp("exterior");
      case "LIVING":
        return tp("living");
      case "KITCHEN":
        return tp("kitchen");
      case "BEDROOM":
        return tp("bedroom", { n: slot.index ?? 1 });
      case "BATHROOM":
        return tp("bathroom", { n: slot.index ?? 1 });
      case "BALCONY":
        return tp("balcony");
      case "POOL":
        return tp("pool");
      default:
        return "";
    }
  }
  const slotProps: SlotProp[] = slots.map((slot) => ({
    id: slot.id,
    icon: slot.icon,
    label: slotLabel(slot),
  }));

  const todayLabel = t("today", {
    date: new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "Asia/Ho_Chi_Minh",
    }).format(new Date()),
  });

  // PENDING·REJECTED만 제출 가능 (lib/cleaning.ts 상태기계와 동일)
  if (task.status === "PENDING" || task.status === "REJECTED") {
    const labels: SubmitLabels = {
      back: t("back"),
      title: t("submitTitle"),
      heading: t("submitHeading"),
      progress: t("progress"),
      counterUnit: t("counterUnit"),
      uploadTile: t("uploadTile"),
      uploading: t("uploading"),
      retry: t("retry"),
      submit: t("submit"),
      submitting: t("submitting"),
      submitHint: t("submitHint", { total: slots.length }),
      submitError: t("submitError"),
      conflict: t("conflict"),
      rejectedTitle: t("status.REJECTED"),
      rejectedHint: t("rejectedHint"),
    };
    return (
      <CleaningSubmit
        taskId={task.id}
        villaName={villaDisplayName}
        todayLabel={todayLabel}
        slots={slotProps}
        rejectNote={task.status === "REJECTED" ? task.rejectNote : null}
        labels={labels}
      />
    );
  }

  // PHOTOS_SUBMITTED·APPROVED — 제출된 사진 읽기 전용 그리드
  const isApproved = task.status === "APPROVED";
  // 제출 시 슬롯 순서대로 저장되므로 개수가 맞으면 공간 라벨을 함께 표시
  const labelsMatch = task.photoUrls.length === slotProps.length;

  return (
    <>
      {/* TopAppBar (a4) */}
      <nav className="fixed top-0 z-50 flex h-14 w-full items-center gap-3 border-b border-neutral-100 bg-white px-4 shadow-sm">
        <Link
          href="/cleaning"
          aria-label={t("back")}
          className="-ml-2 flex h-12 w-12 items-center justify-center rounded-full text-teal-600 transition-transform active:scale-95"
        >
          <span className="material-symbols-outlined">arrow_back</span>
        </Link>
        <h1 className="text-lg font-semibold text-neutral-900">{t("submitTitle")}</h1>
      </nav>

      <header className="mt-14 border-b border-neutral-100 bg-white px-4 py-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-bold text-neutral-900">{t("submittedPhotos")}</h2>
          <span className="font-semibold text-teal-600">{villaDisplayName}</span>
        </div>
        {/* 상태 안내 — 승인 대기(파랑) / 승인됨(초록) */}
        <div
          className={`mt-4 flex items-center gap-2 rounded-xl p-3 ${
            isApproved
              ? "border border-green-200 bg-green-50"
              : "border border-blue-200 bg-blue-50"
          }`}
        >
          <span
            className={`material-symbols-outlined icon-fill ${
              isApproved ? "text-green-600" : "text-blue-600"
            }`}
          >
            {isApproved ? "check_circle" : "hourglass_top"}
          </span>
          <p
            className={`text-sm font-semibold ${
              isApproved ? "text-green-800" : "text-blue-800"
            }`}
          >
            {isApproved ? t("status.APPROVED") : t("waitingReview")}
          </p>
        </div>
      </header>

      <CleaningPhotosView
        photos={task.photoUrls.map((url, i) => ({
          url,
          label: labelsMatch ? slotProps[i].label : undefined,
        }))}
        showLabels={labelsMatch}
        lightboxLabels={{
          close: t("lightbox.close"),
          prev: t("lightbox.prev"),
          next: t("lightbox.next"),
        }}
      />
    </>
  );
}
