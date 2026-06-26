"use client";

// 게스트 셀프 동의서 서명 패드 (ADR-0019 S3) — (admin) signature-pad 패턴 적응.
//   업로드 대상이 게스트 토큰 엔드포인트(/api/g/[token]/signature)로 다름. canvas → PNG → sig- 경로.
import { useRef, useState } from "react";
import type { GuestLabels } from "@/lib/guest-i18n";

export default function GuestSignaturePad({
  token,
  labels,
  onSigned,
}: {
  token: string;
  labels: GuestLabels["agreement"];
  /** 업로드 완료된 비공개 서빙 경로(/api/passports/sig-…) 전달 */
  onSigned: (url: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasStroke, setHasStroke] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ctx = () => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    if (canvas.width !== canvas.offsetWidth) {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    }
    const c = canvas.getContext("2d");
    if (c) {
      c.lineWidth = 3;
      c.lineCap = "round";
      c.lineJoin = "round";
      c.strokeStyle = "#0F172A";
    }
    return c;
  };

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const c = ctx();
    if (!c) return;
    const { x, y } = pos(e);
    c.beginPath();
    c.moveTo(x, y);
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const c = ctx();
    if (!c) return;
    const { x, y } = pos(e);
    c.lineTo(x, y);
    c.stroke();
    if (!hasStroke) setHasStroke(true);
  };
  const onUp = () => {
    drawing.current = false;
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const c = canvas?.getContext("2d");
    if (canvas && c) c.clearRect(0, 0, canvas.width, canvas.height);
    setHasStroke(false);
    setError(null);
  };

  const complete = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasStroke || uploading) return;
    setUploading(true);
    setError(null);
    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png")
      );
      if (!blob) throw new Error("blob");
      const form = new FormData();
      form.append("file", new File([blob], "signature.png", { type: "image/png" }));
      const res = await fetch(`/api/g/${token}/signature`, { method: "POST", body: form });
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      const data = await res.json();
      if (!data?.url) throw new Error("no_url");
      onSigned(data.url);
    } catch {
      setError(labels.error);
      setUploading(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-bold text-slate-800">{labels.signLabel}</label>
        <button
          type="button"
          onClick={clear}
          className="text-xs font-semibold text-teal-600 hover:underline flex items-center gap-1"
        >
          <span className="material-symbols-outlined text-[16px]">ink_eraser</span>
          {labels.clear}
        </button>
      </div>
      <div className="sign-pad relative border-2 border-dashed border-teal-200 rounded-xl h-40 bg-white overflow-hidden">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full touch-none cursor-crosshair"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={onUp}
        />
        {!hasStroke && (
          <span className="absolute inset-0 flex items-center justify-center text-slate-300 text-sm font-medium pointer-events-none">
            {labels.signPrompt}
          </span>
        )}
      </div>
      <div className="flex items-center justify-end">
        <button
          type="button"
          disabled={!hasStroke || uploading}
          onClick={complete}
          className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg transition-all"
        >
          {uploading ? labels.signUploading : labels.signLabel}
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
