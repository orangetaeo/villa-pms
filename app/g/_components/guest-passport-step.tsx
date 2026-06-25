"use client";

// app/g/_components/guest-passport-step.tsx — G4 여권 사진 업로드 (ADR-0019 v2 #1)
//   동의서 서명 후 단계. 인원수(guestCount)만큼 슬롯, 카메라/갤러리에서 1장씩 → POST /api/g/[token]/passport.
//   ★ 비공개 증빙: 안내만 노출, 원가·마진·타예약 0. 건너뛰기 허용(선택).
import { useRef, useState } from "react";
import type { GuestLabels } from "@/lib/guest-i18n";

type SlotState = "empty" | "uploading" | "done" | "error";

export default function GuestPassportStep({
  token,
  guestCount,
  labels,
}: {
  token: string;
  guestCount: number;
  labels: GuestLabels["passport"];
}) {
  const slotCount = Math.max(1, guestCount);
  const [states, setStates] = useState<SlotState[]>(() => Array(slotCount).fill("empty"));
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  const setSlot = (i: number, s: SlotState) =>
    setStates((prev) => prev.map((v, idx) => (idx === i ? s : v)));

  const upload = async (i: number, file: File) => {
    setSlot(i, "uploading");
    try {
      const form = new FormData();
      form.append("file", file);
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
                : s === "error"
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
