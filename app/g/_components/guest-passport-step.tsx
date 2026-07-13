"use client";

// app/g/_components/guest-passport-step.tsx — G4 여권 사진 업로드 (ADR-0019 v2 #1)
//   동의서 서명 후 단계. 인원수(guestCount)만큼 슬롯, 카메라/갤러리에서 1장씩 → POST /api/g/[token]/passport.
//   ★ 비공개 증빙: 안내만 노출, 원가·마진·타예약 0.
//   ★ 필수화(guest-passport-photo-required): 슬롯 전원 done이어야 부모가 "체크인 완료"를 연다.
//     - done 수를 onDoneCount로 부모에 리프트(부모가 게이트 판정).
//     - 재방문 시 initialDoneCount(서버 누적 장수)만큼 앞 슬롯을 done으로 초기화(사진 URL은 미수신).
import { useEffect, useRef, useState } from "react";
import type { GuestLabels } from "@/lib/guest-i18n";
import {
  resizeImage,
  EVIDENCE_MAX_EDGE,
  EVIDENCE_QUALITY,
  isUnprocessableEvidenceBlob,
} from "@/lib/image-resize";

// "unprocessable" = HEIC 디코딩 실패(원본 폴백) 또는 5MB 초과 — silent 통과 금지, 재촬영 안내
type SlotState = "empty" | "uploading" | "done" | "error" | "unprocessable";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB — /api/uploads, cleaning-submit과 동일

export default function GuestPassportStep({
  token,
  guestCount,
  labels,
  initialDoneCount = 0,
  onDoneCount,
}: {
  token: string;
  guestCount: number;
  labels: GuestLabels["passport"];
  /** 재방문 시 서버에 누적된 여권 사진 장수 — 앞에서부터 min(값, 슬롯 수)개를 done으로 초기화. */
  initialDoneCount?: number;
  /** 완료(done) 슬롯 수를 부모(GuestFlow)에 알림 — 부모가 완료 게이트 판정. */
  onDoneCount?: (n: number) => void;
}) {
  const slotCount = Math.max(1, guestCount);
  const [states, setStates] = useState<SlotState[]>(() => {
    // 앞에서부터 min(누적 장수, 슬롯 수)개를 done으로 초기화(나머지는 empty)
    const doneInit = Math.min(Math.max(0, initialDoneCount), slotCount);
    return Array.from({ length: slotCount }, (_, i) => (i < doneInit ? "done" : "empty"));
  });
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  // done 수를 부모에 리프트(초기값 포함) — 게이트는 여기서 판정하지 않고 수만 올린다.
  const doneCount = states.filter((s) => s === "done").length;
  useEffect(() => {
    onDoneCount?.(doneCount);
  }, [doneCount, onDoneCount]);

  const setSlot = (i: number, s: SlotState) =>
    setStates((prev) => prev.map((v, idx) => (idx === i ? s : v)));

  const upload = async (i: number, file: File) => {
    setSlot(i, "uploading");
    try {
      // 증빙 고품질 프리셋(2400/0.90)으로 클라 리사이즈 — 여권번호·MRZ 가독성 확보 + 페이로드 축소
      const blob = await resizeImage(file, EVIDENCE_MAX_EDGE, EVIDENCE_QUALITY);

      // HEIC 폴백·사이즈 가드: resizeImage는 디코딩 실패 시 원본(HEIC)을 그대로 반환한다.
      // 못 여는 HEIC가 증빙으로 남거나 5MB 초과분이 silent 실패하는 사고를 차단하고 재촬영 안내.
      // (판정은 image-resize의 단일 함수 공유 — PNG/WebP는 통과, HEIC/HEIF·과대만 차단)
      if (isUnprocessableEvidenceBlob(blob, MAX_FILE_SIZE)) {
        setSlot(i, "unprocessable");
        return;
      }

      const form = new FormData();
      form.append("file", blob, file.name);
      const res = await fetch(`/api/g/${token}/passport`, { method: "POST", body: form });
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      setSlot(i, "done");
    } catch {
      setSlot(i, "error");
    }
  };

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-500 leading-relaxed">{labels.intro}</p>

      <div className="space-y-3">
        {states.map((s, i) => (
          <div
            key={i}
            className={`flex items-center gap-3 rounded-xl border px-4 py-3.5 ${
              s === "done"
                ? "border-teal-200 bg-teal-50/50"
                : s === "error" || s === "unprocessable"
                ? "border-red-200 bg-red-50/50"
                : "border-slate-200 bg-white"
            }`}
          >
            <span
              className={`w-10 h-10 shrink-0 rounded-full flex items-center justify-center ${
                s === "done" ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-400"
              }`}
            >
              <span className="material-symbols-outlined text-[22px]">
                {s === "done" ? "check" : "badge"}
              </span>
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-800">{labels.slotLabel(i + 1)}</p>
              {s === "uploading" && <p className="text-[11px] text-slate-400">{labels.uploading}</p>}
              {s === "done" && <p className="text-[11px] text-teal-600">{labels.uploaded}</p>}
              {s === "error" && <p className="text-[11px] text-red-500">{labels.error}</p>}
              {s === "unprocessable" && (
                <p className="text-[11px] text-red-500">{labels.processFailed}</p>
              )}
            </div>
            <input
              ref={(el) => {
                inputs.current[i] = el;
              }}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(i, f);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              disabled={s === "uploading"}
              onClick={() => inputs.current[i]?.click()}
              className={`shrink-0 text-xs font-bold rounded-lg px-3 py-2 active:scale-95 ${
                s === "done"
                  ? "border border-slate-200 text-slate-500"
                  : "bg-teal-600 text-white disabled:opacity-50"
              }`}
            >
              {s === "done" ? labels.retake : labels.addPhoto}
            </button>
          </div>
        ))}
      </div>

      <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 flex gap-3">
        <span className="material-symbols-outlined text-slate-400 text-[20px]">lock</span>
        <p className="text-xs text-slate-500 leading-relaxed">{labels.privacyNote}</p>
      </div>
    </div>
  );
}
