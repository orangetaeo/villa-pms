"use client";
// 자료 사진 업로더 (T-seo-media-library)
//
// ★ 문구는 **props로 받는다** — 클라이언트 next-intl 훅을 쓰지 않으므로 ADMIN_CLIENT_NAMESPACES에
//   새 네임스페이스를 등록할 필요가 없다(누락 시 런타임 500 나는 기존 함정 회피).
// ★ 업로드는 기존 /api/uploads 재사용(R2/디스크 자동 선택). 서버 액션 body 1MB 제한을 타지 않는다.
// ★ 이 컴포넌트는 hidden input[name=url]만 채운다 — 실제 저장은 부모 form의 서버 액션이 한다.
import { useState } from "react";
import { resizeImage } from "@/lib/image-resize";

/** 자료 사진은 본문 가로폭에 쓰이므로 긴 변 1600px이면 충분하다(용량·로딩 속도). */
const MAX_EDGE = 1600;

export default function MediaUploader({
  labels,
}: {
  labels: { pick: string; uploading: string; uploadError: string; tooLarge: string; done: string };
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const blob = await resizeImage(file, MAX_EDGE);
      if (blob.size > 5 * 1024 * 1024) {
        setError(labels.tooLarge);
        return;
      }
      const form = new FormData();
      form.append("file", blob, file.name);
      const res = await fetch("/api/uploads", { method: "POST", body: form });
      if (!res.ok) {
        setError(labels.uploadError);
        return;
      }
      const data = (await res.json()) as { url: string };
      setUrl(data.url);
    } catch {
      setError(labels.uploadError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <input type="hidden" name="url" value={url} />
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-sm font-medium text-slate-200">
        <input
          type="file"
          accept="image/*"
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = "";
          }}
        />
        {busy ? labels.uploading : labels.pick}
      </label>

      {url && (
        <div className="mt-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="" className="max-h-48 rounded-lg" />
          <p className="mt-1 text-xs text-emerald-400">{labels.done}</p>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
