"use client";

// 공급자 vi 터치 서명 패드 (T10.5, a-supplier-checkin §3) — 라이트 테마.
// canvas 포인터 드로잉 → PNG → 비공개 증빙 파이프라인(/api/uploads/passport, kind=signature) 업로드.
// 운영자 signature-pad.tsx와 동일 로직, teal 라이트 스타일.
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";

export default function SupplierSignaturePad({
  onSigned,
}: {
  /** 업로드 완료된 비공개 서빙 경로(/api/passports/sig-…) 전달 */
  onSigned: (url: string) => void;
}) {
  const t = useTranslations("supplierCheckin.agreement");
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
      c.strokeStyle = "#0D9488"; // teal
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
    if (!canvas || !hasStroke) return;
    setUploading(true);
    setError(null);
    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png")
      );
      if (!blob) throw new Error("blob");
      const form = new FormData();
      form.append("file", new File([blob], "signature.png", { type: "image/png" }));
      form.append("kind", "signature"); // 서버가 sig- 접두로 저장 (여권과 증빙 분리)
      const res = await fetch("/api/uploads/passport", { method: "POST", body: form });
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      const data = await res.json();
      if (!data?.url) throw new Error("no_url");
      onSigned(data.url);
    } catch {
      setError(t("signError"));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="relative aspect-[3/1] overflow-hidden rounded-xl border-2 border-dashed border-teal-300 bg-white">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={onUp}
        />
      </div>
      <div className="flex items-center justify-between px-1">
        <span className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">
          {t("signatureLabel")}
        </span>
        <button
          type="button"
          onClick={clear}
          className="text-[11px] font-bold text-teal-600 active:opacity-60"
        >
          {t("clear")}
        </button>
      </div>
      <button
        type="button"
        disabled={!hasStroke || uploading}
        onClick={complete}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-teal-600 text-base font-bold text-white transition-all active:scale-[0.98] disabled:opacity-40"
      >
        <span className="material-symbols-outlined">draw</span>
        {uploading ? t("signUploading") : t("signComplete")}
      </button>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
