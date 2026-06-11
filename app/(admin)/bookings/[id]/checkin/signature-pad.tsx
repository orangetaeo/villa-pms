"use client";

// 터치 서명 패드 (T3.2, b3 §3) — canvas 포인터 드로잉 → PNG → 비공개 증빙 파이프라인 업로드.
// "지우기" — b3의 "지우기 (CLEAR)" 괄호 영문 제거 (T5.5)
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";

export default function SignaturePad({
  onSigned,
}: {
  /** 업로드 완료된 비공개 서빙 경로(/api/passports/sig-…) 전달 */
  onSigned: (url: string) => void;
}) {
  const t = useTranslations("adminCheckin.agreement");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasStroke, setHasStroke] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ctx = () => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    // 표시 크기에 맞춰 백킹 해상도 1회 동기화
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
      {/* b3 §3 — 흰 패드(3:1), 하단 서명/지우기 바 */}
      <div className="relative bg-white rounded-lg aspect-[3/1] flex flex-col overflow-hidden">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full touch-none cursor-crosshair"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={onUp}
        />
        <div className="mt-auto bg-slate-100 px-4 py-2 flex justify-between items-center border-t border-slate-200 relative pointer-events-none">
          <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
            {t("signatureLabel")}
          </span>
          <button
            type="button"
            onClick={clear}
            className="text-[10px] text-slate-400 font-bold hover:text-slate-600 pointer-events-auto"
          >
            {t("clear")}
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">{t("signPrompt")}</p>
        <button
          type="button"
          disabled={!hasStroke || uploading}
          onClick={complete}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg transition-all"
        >
          {uploading ? t("signUploading") : t("signComplete")}
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
