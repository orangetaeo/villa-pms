"use client";

// 3/5 사진 업로드 (a1-photo-upload) — 침실/욕실 수에 맞춰 슬롯 동적 생성
// 카드 탭 → 카메라/갤러리 → 업로드 중 스피너 → 완료 체크 → 실패 시 재시도 (UX-VN 업로드 패턴)
import { useRef, useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { resizeImage } from "@/lib/image-resize";
import { watermarkImage } from "@/lib/watermark";
import {
  buildPhotoSlots,
  type PhotoSlot,
  type PhotoSlotState,
  type WizardState,
} from "./wizard-types";
import { WizardGuide } from "./wizard-guide";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB — /api/uploads와 동일

interface Props {
  state: WizardState;
  setPhoto: (slotId: string, slot: PhotoSlotState | null) => void;
  onNext: () => void;
  onBack: () => void;
}

export default function StepPhotos({ state, setPhoto, onNext, onBack }: Props) {
  const t = useTranslations("wizard.photos");
  const tw = useTranslations("wizard");
  const [emptyWarned, setEmptyWarned] = useState(false);

  const slots = buildPhotoSlots(state.bedrooms, state.bathrooms, state.hasPool);
  const doneCount = slots.filter((slot) => state.photos[slot.id]?.status === "done").length;
  const totalCount = slots.length;
  const progress = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  function slotLabel(slot: PhotoSlot): string {
    switch (slot.space) {
      case "EXTERIOR":
        return t("exterior");
      case "LIVING":
        return t("living");
      case "KITCHEN":
        return t("kitchen");
      case "BEDROOM":
        return t("bedroom", { n: slot.index ?? 1 });
      case "BATHROOM":
        return t("bathroom", { n: slot.index ?? 1 });
      case "BALCONY":
        return t("balcony");
      case "POOL":
        return t("pool");
      default:
        return "";
    }
  }

  async function uploadFile(slotId: string, file: File) {
    if (!file.type.startsWith("image/")) {
      setPhoto(slotId, { status: "error" });
      return;
    }
    setPhoto(slotId, { status: "uploading" });
    try {
      // 클라 리사이즈 (T0.4 lib/image-resize): 긴 변 1600px JPEG 재인코딩 —
      // 5MB 넘는 휴대폰 카메라 원본도 통과. 크기 검사는 리사이즈 결과 기준
      const resized = await resizeImage(file);
      // 도용 방지 워터마크를 저장 파일에 굽는다 (lib/watermark) — 빌라 마케팅 사진 전용
      const blob = await watermarkImage(resized);
      if (blob.size > MAX_FILE_SIZE) {
        setPhoto(slotId, { status: "error" });
        return;
      }
      const formData = new FormData();
      // 워터마크 출력은 JPEG — 확장자도 .jpg로 맞춘다(서버는 blob MIME으로 저장)
      formData.append("file", blob, file.name.replace(/\.[^.]+$/, "") + ".jpg");
      const res = await fetch("/api/uploads", { method: "POST", body: formData });
      if (!res.ok) throw new Error("upload failed");
      const { url } = (await res.json()) as { url: string };
      setPhoto(slotId, { status: "done", url });
    } catch {
      setPhoto(slotId, { status: "error" });
    }
  }

  function handleContinue() {
    // 사진 0장이어도 경고 1회 후 진행 가능 (계약 완료 기준 6)
    if (doneCount === 0 && !emptyWarned) {
      setEmptyWarned(true);
      return;
    }
    onNext();
  }

  return (
    <>
      <main className="mx-auto w-full max-w-md flex-1 px-4 pb-32 pt-6">
        {/* 진행 카운터 (a1): "N/M" + 진행 바 */}
        <div className="mb-8">
          <div className="mb-2 flex items-end justify-between">
            <h2 className="text-2xl font-bold text-neutral-900">{t("title")}</h2>
            <div className="text-right">
              <span className="text-lg font-bold tabular-nums text-teal-600">
                {t("counter", { done: doneCount, total: totalCount })}
              </span>
              <span className="block text-sm text-neutral-400">{t("counterLabel")}</span>
            </div>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-neutral-200">
            <div
              className="h-full rounded-full bg-teal-600 transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* 인라인 가이드 — 그리드를 처음 보는 순간 "칸 탭=1장 업로드" 조작 모델 + 가로 촬영 팁.
            기존 하단 helper 배너는 여기로 통합·제거(화면당 배너 1개 — UX-VN 확정) */}
        <div className="mb-6">
          <WizardGuide text={t("guide")} />
        </div>

        {/* 공간별 업로드 그리드 */}
        <div className="grid grid-cols-2 gap-4">
          {slots.map((slot) => (
            <PhotoTile
              key={slot.id}
              icon={slot.icon}
              label={slotLabel(slot)}
              photo={state.photos[slot.id]}
              uploadingLabel={t("uploading")}
              retryLabel={t("retry")}
              onFile={(file) => uploadFile(slot.id, file)}
            />
          ))}
        </div>

        {emptyWarned && doneCount === 0 && (
          <div className="mt-6 flex items-start gap-2 rounded-lg bg-amber-50 p-3">
            <span className="material-symbols-outlined mt-0.5 text-sm text-amber-600">warning</span>
            <p className="text-sm leading-relaxed text-amber-800">{t("emptyWarning")}</p>
          </div>
        )}

      </main>

      {/* 하단 액션 (a1): 뒤로 + 계속 */}
      <footer className="pb-safe fixed bottom-0 left-0 z-50 w-full rounded-t-xl bg-white shadow-[0_-4px_12px_rgba(0,0,0,0.05)]">
        <div className="mx-auto flex w-full max-w-md items-center justify-between px-6 py-4">
          <button
            type="button"
            onClick={onBack}
            className="flex h-14 flex-col items-center justify-center px-8 font-label text-xs font-medium text-neutral-600 transition-all duration-200 active:scale-[0.98]"
          >
            <span className="material-symbols-outlined mb-1">chevron_left</span>
            {tw("back")}
          </button>
          <button
            type="button"
            onClick={handleContinue}
            className="flex h-14 items-center justify-center rounded-xl bg-teal-600 px-12 font-label text-base font-bold text-white shadow-lg shadow-teal-600/20 transition-all duration-200 active:scale-[0.98]"
          >
            <div className="flex items-center gap-2">
              {tw("continue")}
              <span className="material-symbols-outlined">chevron_right</span>
            </div>
          </button>
        </div>
      </footer>
    </>
  );
}

function PhotoTile({
  icon,
  label,
  photo,
  uploadingLabel,
  retryLabel,
  onFile,
}: {
  icon: string;
  label: string;
  photo?: PhotoSlotState;
  uploadingLabel: string;
  retryLabel: string;
  onFile: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const openPicker = () => inputRef.current?.click();

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />

      {photo?.status === "done" && photo.url ? (
        // 업로드 완료 — 썸네일 + 체크 (탭하면 교체)
        <button
          type="button"
          onClick={openPicker}
          className="relative block aspect-square w-full overflow-hidden rounded-xl border-2 border-teal-600 shadow-sm transition-transform active:scale-95"
        >
          <Image
            src={photo.url}
            alt={label}
            fill
            unoptimized
            sizes="(max-width: 768px) 50vw, 200px"
            className="object-cover"
          />
          <div className="absolute inset-0 bg-black/20" />
          <div className="absolute right-2 top-2 rounded-full bg-teal-600 p-1 text-white shadow-lg">
            <span className="material-symbols-outlined icon-fill text-sm">check_circle</span>
          </div>
          <div className="absolute bottom-0 left-0 w-full bg-gradient-to-t from-black/80 to-transparent p-3 text-left">
            <p className="text-sm font-semibold text-white">{label}</p>
          </div>
        </button>
      ) : photo?.status === "uploading" ? (
        // 업로드 중 — 스피너
        <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-teal-200 bg-teal-50">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-teal-200 border-t-teal-600" />
          <span className="text-sm font-medium text-teal-700">{uploadingLabel}</span>
          <span className="text-sm font-medium text-neutral-600">{label}</span>
        </div>
      ) : photo?.status === "error" ? (
        // 실패 — 재시도
        <button
          type="button"
          onClick={openPicker}
          className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-red-300 bg-red-50 transition-colors active:scale-95"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-red-500">
            <span className="material-symbols-outlined text-3xl">refresh</span>
          </div>
          <span className="text-sm font-semibold text-red-600">{retryLabel}</span>
          <span className="text-sm font-medium text-neutral-600">{label}</span>
        </button>
      ) : (
        // 비어 있음 — 카메라 카드 (a1)
        <button
          type="button"
          onClick={openPicker}
          className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-neutral-300 bg-white transition-colors hover:border-teal-400 hover:bg-teal-50 active:scale-95"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 text-neutral-400">
            <span className="material-symbols-outlined text-3xl">{icon}</span>
          </div>
          <span className="text-sm font-medium text-neutral-600">{label}</span>
        </button>
      )}
    </div>
  );
}
