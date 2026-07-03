"use client";

// 청소 사진 제출 클라이언트 (T3.8) — a4-cleaning-photos 변환
// 업로드 타일·진행 카운터·리사이즈는 빌라 등록 사진 단계(T1.1 step-photos) 패턴 재사용
// 카드 탭 → 카메라/갤러리 → 업로드 중 스피너 → 완료 체크 → 실패 시 재시도 (UX-VN)
// 라벨은 전부 RSC에서 번역해 props로 받는다 — layout 화이트리스트(수정 금지) 우회
import { useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { resizeImage } from "@/lib/image-resize";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB — /api/uploads와 동일

export interface SlotProp {
  id: string;
  icon: string;
  label: string;
  /** B: 이 공간의 기준 사진(정리된 상태) URL — 제출 전 참고용. 없으면 미표시. */
  baselineUrl?: string;
  /** 선택 슬롯(발코니·수영장 등) — 제출 필수 아님. 있으면 올려도 되고 없으면 건너뛴다. */
  optional?: boolean;
}

export interface SubmitLabels {
  back: string;
  title: string;
  heading: string;
  progress: string;
  counterUnit: string;
  uploadTile: string;
  uploading: string;
  retry: string;
  submit: string;
  submitting: string;
  submitHint: string;
  submitError: string;
  conflict: string;
  rejectedTitle: string;
  rejectedHint: string;
  baselineLabel: string;
  /** 선택 슬롯 배지 라벨(예: "선택"/"Tùy chọn"). */
  optionalTag: string;
}

interface PhotoState {
  status: "uploading" | "done" | "error";
  url?: string;
}

export function CleaningSubmit({
  taskId,
  villaName,
  todayLabel,
  slots,
  rejectNote,
  labels,
  infoSlot,
}: {
  taskId: string;
  villaName: string;
  todayLabel: string;
  slots: SlotProp[];
  rejectNote: string | null;
  labels: SubmitLabels;
  /** A·C·D 정보 카드(서버 렌더) — 예정일·유형·주소·출입·메모. */
  infoSlot?: ReactNode;
}) {
  const router = useRouter();
  const [photos, setPhotos] = useState<Record<string, PhotoState>>({});
  const [submitState, setSubmitState] = useState<
    "idle" | "submitting" | "error" | "conflict"
  >("idle");

  // 제출 게이트는 "필수 슬롯"만 요구 — 발코니·수영장 등 선택 슬롯은 없거나 못 들어가도 제출 가능.
  // (선택 슬롯도 올리면 함께 제출되지만, 진행률·완료 판정에는 필수 슬롯만 센다.)
  const requiredSlots = slots.filter((s) => !s.optional);
  const doneCount = requiredSlots.filter((s) => photos[s.id]?.status === "done").length;
  const totalCount = requiredSlots.length;
  const allDone = doneCount === totalCount;
  const progress = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  function setPhoto(slotId: string, state: PhotoState | null) {
    setPhotos((prev) => {
      const next = { ...prev };
      if (state) next[slotId] = state;
      else delete next[slotId];
      return next;
    });
  }

  async function uploadFile(slotId: string, file: File) {
    if (!file.type.startsWith("image/")) {
      setPhoto(slotId, { status: "error" });
      return;
    }
    setPhoto(slotId, { status: "uploading" });
    try {
      // 클라 리사이즈 (lib/image-resize): 긴 변 1600px JPEG 재인코딩 — EXIF 회전 반영
      const blob = await resizeImage(file);
      if (blob.size > MAX_FILE_SIZE) {
        setPhoto(slotId, { status: "error" });
        return;
      }
      const formData = new FormData();
      formData.append("file", blob, file.name);
      const res = await fetch("/api/uploads", { method: "POST", body: formData });
      if (!res.ok) throw new Error("upload failed");
      const { url } = (await res.json()) as { url: string };
      setPhoto(slotId, { status: "done", url });
    } catch {
      setPhoto(slotId, { status: "error" });
    }
  }

  async function handleSubmit() {
    if (!allDone || submitState === "submitting") return;
    setSubmitState("submitting");
    // 슬롯 순서대로 제출 — 읽기 전용 그리드에서 공간 라벨과 1:1 대응
    const photoUrls = slots
      .map((s) => photos[s.id]?.url)
      .filter((u): u is string => Boolean(u));
    try {
      const res = await fetch(`/api/cleaning-tasks/${taskId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoUrls }),
      });
      if (res.ok) {
        // 성공 — 목록 복귀 + 성공 배너 (Đã gửi 반영)
        router.push("/cleaning?submitted=1");
        return;
      }
      if (res.status === 409) {
        // 이미 제출/승인됨 — 안내 후 RSC 재조회로 읽기 전용 화면 전환
        setSubmitState("conflict");
        setTimeout(() => router.refresh(), 1500);
        return;
      }
      setSubmitState("error");
    } catch {
      setSubmitState("error");
    }
  }

  return (
    <>
      {/* TopAppBar (a4) */}
      <nav className="fixed top-0 z-50 flex h-14 w-full items-center gap-3 border-b border-neutral-100 bg-white px-4 shadow-sm">
        <Link
          href="/cleaning"
          aria-label={labels.back}
          className="-ml-2 flex h-12 w-12 items-center justify-center rounded-full text-teal-600 transition-transform active:scale-95"
        >
          <span className="material-symbols-outlined">arrow_back</span>
        </Link>
        <h1 className="text-lg font-semibold text-neutral-900">{labels.title}</h1>
      </nav>

      {/* 헤더 — 제목·빌라명·진행 카운터 (a4) */}
      <header className="mt-14 border-b border-neutral-100 bg-white px-4 py-6">
        <div className="mb-4 flex flex-col gap-1">
          <h2 className="text-2xl font-bold text-neutral-900">{labels.heading}</h2>
          <span className="font-semibold text-teal-600">{villaName}</span>
          <p className="text-xs text-neutral-500">{todayLabel}</p>
        </div>
        <div className="space-y-2">
          <div className="flex items-end justify-between">
            <span className="text-sm font-medium text-neutral-700">{labels.progress}</span>
            <span className="text-sm font-bold tabular-nums text-teal-600">
              {doneCount}/{totalCount} {labels.counterUnit}
            </span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-neutral-100">
            <div
              className="h-full rounded-full bg-teal-600 transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-md p-4 pb-44">
        {/* A·C·D 정보 카드 — 예정일·유형·주소·출입·메모 */}
        {infoSlot && <div className="mb-4">{infoSlot}</div>}

        {/* 반려 사유 — 재제출 안내 (REJECTED) */}
        {rejectNote !== null && (
          <div className="mb-4 flex items-start gap-3 rounded-xl border-2 border-red-200 bg-red-50 p-4">
            <span className="material-symbols-outlined mt-0.5 text-red-600">error</span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-red-700">{labels.rejectedTitle}</p>
              {rejectNote && (
                <p className="mt-1 text-sm leading-snug text-red-700">{rejectNote}</p>
              )}
              <p className="mt-1 text-sm text-neutral-600">{labels.rejectedHint}</p>
            </div>
          </div>
        )}

        {/* 공간별 사진 그리드 (a4) — 빌라 등록과 동일 슬롯 */}
        <div className="grid grid-cols-2 gap-4">
          {slots.map((slot) => (
            <PhotoTile
              key={slot.id}
              icon={slot.icon}
              label={slot.label}
              optional={slot.optional}
              optionalTag={labels.optionalTag}
              baselineUrl={slot.baselineUrl}
              baselineLabel={labels.baselineLabel}
              photo={photos[slot.id]}
              uploadTileLabel={labels.uploadTile}
              uploadingLabel={labels.uploading}
              retryLabel={labels.retry}
              onFile={(file) => uploadFile(slot.id, file)}
            />
          ))}
        </div>
      </main>

      {/* 하단 제출 (a4) — 전 슬롯 완료 시에만 활성, 탭바(h-16) 위 고정 */}
      <section className="fixed bottom-16 left-0 z-40 w-full border-t border-neutral-100 bg-white p-4 shadow-[0_-10px_20px_rgba(0,0,0,0.05)]">
        <div className="mx-auto w-full max-w-md">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!allDone || submitState === "submitting"}
            className={`flex min-h-14 w-full items-center justify-center gap-2 rounded-xl py-4 text-lg font-bold text-white transition-all ${
              allDone && submitState !== "submitting"
                ? "bg-teal-600 shadow-lg shadow-teal-600/20 active:scale-[0.98]"
                : "cursor-not-allowed bg-neutral-300"
            }`}
          >
            {submitState === "submitting" && (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            )}
            {submitState === "submitting" ? labels.submitting : labels.submit}
          </button>
          {submitState === "error" ? (
            <p className="mt-2 text-center text-xs font-medium text-red-600">
              {labels.submitError}
            </p>
          ) : submitState === "conflict" ? (
            <p className="mt-2 text-center text-xs font-medium text-blue-700">
              {labels.conflict}
            </p>
          ) : !allDone ? (
            <p className="mt-2 text-center text-xs font-medium text-neutral-500">
              {labels.submitHint}
            </p>
          ) : null}
        </div>
      </section>
    </>
  );
}

// 업로드 타일 — T1.1 step-photos PhotoTile 패턴 (비어 있음/업로드 중/완료/실패 4상태)
function PhotoTile({
  icon,
  label,
  optional,
  optionalTag,
  baselineUrl,
  baselineLabel,
  photo,
  uploadTileLabel,
  uploadingLabel,
  retryLabel,
  onFile,
}: {
  icon: string;
  label: string;
  optional?: boolean;
  optionalTag: string;
  baselineUrl?: string;
  baselineLabel: string;
  photo?: PhotoState;
  uploadTileLabel: string;
  uploadingLabel: string;
  retryLabel: string;
  onFile: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const openPicker = () => inputRef.current?.click();

  return (
    <div className="relative">
      {/* B: 기준 사진(정리된 상태) — 업로드 전 같은 각도로 촬영하도록 참고. 없으면 미표시. */}
      {baselineUrl && (
        <div className="relative mb-1.5 aspect-square w-full overflow-hidden rounded-xl border border-neutral-200 bg-neutral-100">
          <Image
            src={baselineUrl}
            alt={`${baselineLabel} · ${label}`}
            fill
            unoptimized
            sizes="(max-width: 768px) 50vw, 200px"
            className="object-cover"
          />
          <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-0.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-bold text-white">
            <span className="material-symbols-outlined text-[13px]">photo_library</span>
            {baselineLabel}
          </span>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        aria-label={label}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />

      {photo?.status === "done" && photo.url ? (
        // 완료 — 썸네일 + 체크 (탭하면 교체)
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
          <div className="absolute right-2 top-2 rounded-full bg-white p-0.5 shadow-md">
            <span className="material-symbols-outlined icon-fill text-2xl text-green-600">
              check_circle
            </span>
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
        // 비어 있음 — 카메라 카드 (a4: 점선 + photo_camera + "Tải ảnh")
        <button
          type="button"
          onClick={openPicker}
          className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-neutral-300 bg-neutral-50 text-neutral-400 transition-colors hover:border-teal-400 hover:bg-teal-50 active:scale-95"
        >
          <span className="material-symbols-outlined text-4xl">
            {icon === "pool" ? "pool" : "photo_camera"}
          </span>
          <span className="text-xs font-medium">{uploadTileLabel}</span>
        </button>
      )}
      {/* a4: 타일 아래 공간 라벨 */}
      {photo?.status !== "uploading" && photo?.status !== "error" && (
        <p
          className={`mt-2 flex items-center justify-center gap-1.5 text-center text-sm font-medium ${
            photo?.status === "done" ? "text-neutral-700" : "text-neutral-500"
          }`}
        >
          {label}
          {optional && (
            <span className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-500">
              {optionalTag}
            </span>
          )}
        </p>
      )}
    </div>
  );
}
