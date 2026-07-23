"use client";
// 사진 업로더 (T-seo-media-library → T-seo-ux-fix에서 **다중 선택**으로 개편)
//
// ★ 문구는 props로 받는다 — 클라이언트 next-intl 훅을 쓰지 않으므로 ADMIN_CLIENT_NAMESPACES에
//   새 네임스페이스를 등록할 필요가 없다(누락 시 런타임 500 나는 기존 함정 회피).
// ★ 업로드는 기존 /api/uploads 재사용(R2/디스크 자동 선택). 서버 액션 body 1MB 제한을 타지 않는다.
// ★ 이 컴포넌트는 url[]·alt[] 쌍만 만든다 — 저장은 부모 form의 서버 액션이 한다.
//   같은 사진을 두 번 고르면 URL이 같아 서버가 걸러내지만, 여기서도 미리 막는다(메오키친 중복 사례).
import { useState } from "react";
import { resizeImage } from "@/lib/image-resize";

/** 자료 사진은 본문 가로폭에 쓰이므로 긴 변 1600px이면 충분하다(용량·로딩 속도). */
const MAX_EDGE = 1600;

interface Uploaded {
  url: string;
  alt: string;
}

export interface UploaderLabels {
  pick: string;
  uploading: string;
  uploadError: string;
  tooLarge: string;
  done: string;
  altPlaceholder: string;
  remove: string;
}

export default function MediaUploader({
  labels,
  altPrefix = "",
}: {
  labels: UploaderLabels;
  /** 장소 화면처럼 맥락이 분명한 곳에서 설명 기본값을 채워준다(예: "메오키친 1") */
  altPrefix?: string;
}) {
  const [items, setItems] = useState<Uploaded[]>([]);
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = async (files: File[]) => {
    setError(null);
    setBusy((n) => n + files.length);
    for (const file of files) {
      try {
        const blob = await resizeImage(file, MAX_EDGE);
        if (blob.size > 5 * 1024 * 1024) {
          setError(labels.tooLarge);
          continue;
        }
        const form = new FormData();
        form.append("file", blob, file.name);
        const res = await fetch("/api/uploads", { method: "POST", body: form });
        if (!res.ok) {
          setError(labels.uploadError);
          continue;
        }
        const data = (await res.json()) as { url: string };
        setItems((prev) =>
          prev.some((p) => p.url === data.url)
            ? prev // 같은 파일을 두 번 고른 경우 — 중복 행을 만들지 않는다
            : [...prev, { url: data.url, alt: altPrefix ? `${altPrefix} ${prev.length + 1}` : "" }]
        );
      } catch {
        setError(labels.uploadError);
      } finally {
        setBusy((n) => n - 1);
      }
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-sm font-medium text-slate-200 hover:border-slate-500">
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const list = Array.from(e.target.files ?? []);
              if (list.length > 0) void handleFiles(list);
              e.target.value = "";
            }}
          />
          {busy > 0 ? `${labels.uploading} (${busy})` : labels.pick}
        </label>
        {items.length > 0 && <span className="text-xs text-emerald-400">{labels.done}</span>}
      </div>

      {items.length > 0 && (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it, i) => (
            <li key={it.url} className="flex gap-2 rounded-lg border border-slate-800 bg-slate-950 p-2">
              <input type="hidden" name="url" value={it.url} />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={it.url} alt="" className="h-16 w-16 shrink-0 rounded object-cover" />
              <div className="min-w-0 flex-1">
                <input
                  name="alt"
                  value={it.alt}
                  onChange={(e) =>
                    setItems((prev) => prev.map((p, j) => (j === i ? { ...p, alt: e.target.value } : p)))
                  }
                  maxLength={200}
                  placeholder={labels.altPlaceholder}
                  className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
                />
                <button
                  type="button"
                  onClick={() => setItems((prev) => prev.filter((_, j) => j !== i))}
                  className="mt-1 text-[11px] text-slate-500 hover:text-red-400"
                >
                  {labels.remove}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
