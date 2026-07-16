"use client";

// 계약 전자서명 캔버스 (T-business-contract-esign) — guest-signature-pad 패턴 재사용.
//   canvas → PNG Blob. 여기서는 업로드하지 않고 blob만 노출(상위 폼이 신원 필드와 함께 FormData 전송).
//   ref로 { toBlob, clear, isEmpty } 노출. onStrokeChange로 그림 여부를 상위에 통지(제출 버튼 활성화용).
import { forwardRef, useImperativeHandle, useRef, useState } from "react";

export interface SignPadHandle {
  toBlob: () => Promise<Blob | null>;
  clear: () => void;
  isEmpty: () => boolean;
}

interface Props {
  clearLabel: string;
  promptLabel: string;
  onStrokeChange?: (hasStroke: boolean) => void;
}

const ContractSignPad = forwardRef<SignPadHandle, Props>(function ContractSignPad(
  { clearLabel, promptLabel, onStrokeChange },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasStroke, setHasStroke] = useState(false);

  const setStroke = (v: boolean) => {
    setHasStroke(v);
    onStrokeChange?.(v);
  };

  const ctx = () => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    // 실제 표시 크기에 맞춰 backing store 크기 동기화(서명 왜곡 방지)
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
    if (!hasStroke) setStroke(true);
  };
  const onUp = () => {
    drawing.current = false;
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const c = canvas?.getContext("2d");
    if (canvas && c) c.clearRect(0, 0, canvas.width, canvas.height);
    setStroke(false);
  };

  useImperativeHandle(ref, () => ({
    isEmpty: () => !hasStroke,
    clear,
    toBlob: () =>
      new Promise<Blob | null>((resolve) => {
        const canvas = canvasRef.current;
        if (!canvas || !hasStroke) return resolve(null);
        canvas.toBlob((b) => resolve(b), "image/png");
      }),
  }));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={clear}
          className="flex items-center gap-1 text-xs font-semibold text-teal-600 hover:underline"
        >
          <span className="material-symbols-outlined text-[16px]">ink_eraser</span>
          {clearLabel}
        </button>
      </div>
      <div className="relative h-40 overflow-hidden rounded-xl border-2 border-dashed border-teal-200 bg-white">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={onUp}
        />
        {!hasStroke && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-medium text-slate-300">
            {promptLabel}
          </span>
        )}
      </div>
    </div>
  );
});

export default ContractSignPad;
