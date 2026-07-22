"use client";

// 운영자(다크) 사진 편집기 — 공간별 접이식 섹션. 추가(파일 선택)·삭제(X)·정렬(◀▶).
// SUPPLIER photo-manager.tsx의 로직을 운영자 대시보드(다크·ko)로 이식. 동일 API 사용:
//   추가: 클라 리사이즈 → POST /api/uploads(url 확보) → POST /api/villas/[id]/photos
//   삭제: DELETE /api/villas/[id]/photos?photoId=…  (기준사진+진행중 예약이면 409 → 경고)
//   정렬: 같은 공간 내 좌/우 교환 → PATCH /api/villas/[id]/photos(orders)
// 누수 0: 금액·고객 정보 없음. 사진 url·공간만 다룬다. i18n: adminVillas.detail.*(화이트리스트 기존 포함).
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { resizeImage } from "@/lib/image-resize";
import { watermarkImage } from "@/lib/watermark";
import { SPACE_ICON } from "@/lib/photo-spaces";

const MAX_FILE_SIZE = 5 * 1024 * 1024;

export interface ManagedPhoto {
  id: string;
  space: string;
  spaceLabel: string | null;
  url: string;
  isBaseline: boolean;
  sortOrder: number;
}

interface Section {
  /** 섹션 키 — `${space}` 또는 `${space}:${n}` (침실/욕실) */
  key: string;
  space: string;
  /** 침실/욕실 번호 (spaceLabel 저장값) */
  index?: number;
  labelKey: "EXTERIOR" | "LIVING" | "KITCHEN" | "BALCONY" | "POOL" | "BEDROOM" | "BATHROOM" | "ETC";
}

interface Props {
  villaId: string;
  bedrooms: number;
  bathrooms: number;
  hasPool: boolean;
  initialPhotos: ManagedPhoto[];
}

/** 빌라 방 수 기반 섹션 동적 생성 — 침실N·화장실N 동적. 미분류(ETC)는 필요 시 뒤에 추가 */
function buildSections(bedrooms: number, bathrooms: number, hasPool: boolean): Section[] {
  const sections: Section[] = [
    { key: "EXTERIOR", space: "EXTERIOR", labelKey: "EXTERIOR" },
    { key: "LIVING", space: "LIVING", labelKey: "LIVING" },
    { key: "KITCHEN", space: "KITCHEN", labelKey: "KITCHEN" },
  ];
  for (let i = 1; i <= bedrooms; i += 1)
    sections.push({ key: `BEDROOM:${i}`, space: "BEDROOM", index: i, labelKey: "BEDROOM" });
  for (let i = 1; i <= bathrooms; i += 1)
    sections.push({ key: `BATHROOM:${i}`, space: "BATHROOM", index: i, labelKey: "BATHROOM" });
  sections.push({ key: "BALCONY", space: "BALCONY", labelKey: "BALCONY" });
  if (hasPool) sections.push({ key: "POOL", space: "POOL", labelKey: "POOL" });
  return sections;
}

/** 사진을 섹션 키로 분류. 침실/욕실은 spaceLabel(번호)로 매칭, 없으면 1번 섹션에 모음 */
function sectionKeyOf(photo: ManagedPhoto): string {
  if (photo.space === "BEDROOM") return `BEDROOM:${photo.spaceLabel ?? "1"}`;
  if (photo.space === "BATHROOM") return `BATHROOM:${photo.spaceLabel ?? "1"}`;
  return photo.space;
}

export default function AdminPhotoManager({
  villaId,
  bedrooms,
  bathrooms,
  hasPool,
  initialPhotos,
}: Props) {
  const t = useTranslations("adminVillas.detail");
  const router = useRouter();

  const [photos, setPhotos] = useState<ManagedPhoto[]>(initialPhotos);

  // 스키마에 없는 방 번호(예: 침실 수 축소 후 남은 사진)나 ETC 사진도 편집 가능하도록,
  // 실제 사진이 속한 섹션 키를 동적으로 흡수한다.
  const sections = useMemo(() => {
    const base = buildSections(bedrooms, bathrooms, hasPool);
    const known = new Set(base.map((s) => s.key));
    const extras: Section[] = [];
    for (const p of photos) {
      const key = sectionKeyOf(p);
      if (known.has(key) || extras.some((e) => e.key === key)) continue;
      if (p.space === "BEDROOM")
        extras.push({ key, space: "BEDROOM", index: Number(p.spaceLabel) || undefined, labelKey: "BEDROOM" });
      else if (p.space === "BATHROOM")
        extras.push({ key, space: "BATHROOM", index: Number(p.spaceLabel) || undefined, labelKey: "BATHROOM" });
      else extras.push({ key, space: p.space, labelKey: (p.space as Section["labelKey"]) ?? "ETC" });
    }
    return [...base, ...extras];
  }, [bedrooms, bathrooms, hasPool, photos]);

  const [openKey, setOpenKey] = useState<string | null>(sections[0]?.key ?? null);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ManagedPhoto | null>(null);
  const [errorKey, setErrorKey] = useState<"baselineLocked" | "error" | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function sectionLabel(s: Section): string {
    if (s.labelKey === "BEDROOM") return t("photoEdit.bedroomN", { n: s.index ?? 1 });
    if (s.labelKey === "BATHROOM") return t("photoEdit.bathroomN", { n: s.index ?? 1 });
    return t(`spaces.${s.space}`);
  }

  function photosOf(key: string): ManagedPhoto[] {
    return photos
      .filter((p) => sectionKeyOf(p) === key)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  // ── 추가 (업로드 → POST photos) ──────────────────────────────
  async function addPhoto(section: Section, file: File) {
    if (!file.type.startsWith("image/")) {
      setErrorKey("error");
      return;
    }
    setErrorKey(null);
    setUploadingKey(section.key);
    try {
      const resized = await resizeImage(file);
      // 도용 방지 워터마크를 저장 파일에 굽는다 (공급자 업로드와 동일 규약)
      const blob = await watermarkImage(resized);
      if (blob.size > MAX_FILE_SIZE) {
        setErrorKey("error");
        return;
      }
      const fd = new FormData();
      fd.append("file", blob, file.name.replace(/\.[^.]+$/, "") + ".jpg");
      // SEO 파일명 — 서버가 villaId로 슬러그를 조회해 "슬러그-공간-..." 형태로 저장한다
      fd.append("villaId", villaId);
      fd.append("space", section.space);
      const up = await fetch("/api/uploads", { method: "POST", body: fd });
      if (!up.ok) throw new Error("upload");
      const { url } = (await up.json()) as { url: string };

      const res = await fetch(`/api/villas/${villaId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          space: section.space,
          ...(section.index ? { spaceLabel: String(section.index) } : {}),
          url,
        }),
      });
      if (!res.ok) throw new Error("create");
      const created = (await res.json()) as ManagedPhoto;
      setPhotos((prev) => [...prev, created]);
      router.refresh();
    } catch {
      setErrorKey("error");
    } finally {
      setUploadingKey(null);
    }
  }

  // ── 삭제 (DELETE photos) — 기준사진은 다이얼로그 확인 후 ─────────
  async function deletePhoto(photo: ManagedPhoto) {
    setErrorKey(null);
    setBusyId(photo.id);
    try {
      const res = await fetch(
        `/api/villas/${villaId}/photos?photoId=${encodeURIComponent(photo.id)}`,
        { method: "DELETE" }
      );
      if (res.status === 409) {
        // 진행 중 예약이 점유한 기준사진 — 증빙 무결성 보호
        setErrorKey("baselineLocked");
        return;
      }
      if (!res.ok) throw new Error("delete");
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
      router.refresh();
    } catch {
      setErrorKey("error");
    } finally {
      setBusyId(null);
      setConfirmDelete(null);
    }
  }

  function onDeleteClick(photo: ManagedPhoto) {
    if (photo.isBaseline) setConfirmDelete(photo); // 경고 다이얼로그
    else deletePhoto(photo);
  }

  // ── 정렬 (같은 공간 내 좌/우 이동 → PATCH orders) ───────────────
  async function move(key: string, photoId: string, dir: -1 | 1) {
    const list = photosOf(key);
    const idx = list.findIndex((p) => p.id === photoId);
    const swapIdx = idx + dir;
    if (idx < 0 || swapIdx < 0 || swapIdx >= list.length) return;
    setErrorKey(null);
    setBusyId(photoId);
    const a = list[idx];
    const b = list[swapIdx];
    const orders = [
      { photoId: a.id, sortOrder: b.sortOrder },
      { photoId: b.id, sortOrder: a.sortOrder },
    ];
    // 낙관적 갱신
    setPhotos((prev) =>
      prev.map((p) =>
        p.id === a.id
          ? { ...p, sortOrder: b.sortOrder }
          : p.id === b.id
            ? { ...p, sortOrder: a.sortOrder }
            : p
      )
    );
    try {
      const res = await fetch(`/api/villas/${villaId}/photos`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orders }),
      });
      if (!res.ok) throw new Error("reorder");
      router.refresh();
    } catch {
      // 롤백
      setPhotos((prev) =>
        prev.map((p) =>
          p.id === a.id
            ? { ...p, sortOrder: a.sortOrder }
            : p.id === b.id
              ? { ...p, sortOrder: b.sortOrder }
              : p
        )
      );
      setErrorKey("error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-3">
      {errorKey && (
        <p
          className="rounded-lg bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-400"
          role="alert"
        >
          {t(`photoEdit.${errorKey}`)}
        </p>
      )}

      {sections.map((section) => {
        const list = photosOf(section.key);
        const isOpen = openKey === section.key;
        return (
          <div
            key={section.key}
            className={`overflow-hidden rounded-lg border bg-slate-900/50 ${
              isOpen ? "border-admin-primary/40" : "border-slate-800"
            }`}
          >
            {/* 섹션 헤더 — 아이콘 + 라벨 + 사진 수량 칩 + 접기 */}
            <button
              type="button"
              onClick={() => setOpenKey(isOpen ? null : section.key)}
              className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-slate-800/50"
            >
              <div className={`flex items-center gap-3 ${isOpen ? "text-admin-primary" : "text-slate-300"}`}>
                <span className="material-symbols-outlined">{SPACE_ICON[section.space] ?? "image"}</span>
                <span className="font-semibold text-slate-100">{sectionLabel(section)}</span>
                <span className="rounded bg-slate-800 px-2 py-0.5 text-xs font-bold text-slate-400">
                  {list.length}
                </span>
              </div>
              <span className={`material-symbols-outlined ${isOpen ? "text-admin-primary" : "text-slate-500"}`}>
                {isOpen ? "expand_less" : "expand_more"}
              </span>
            </button>

            {isOpen && (
              <div className="border-t border-slate-800 p-4">
                <div className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {list.map((photo, i) => (
                    <div
                      key={photo.id}
                      className="group relative h-28 w-28 flex-shrink-0 overflow-hidden rounded-lg bg-slate-800"
                    >
                      <Image
                        src={photo.url}
                        alt={sectionLabel(section)}
                        fill
                        unoptimized
                        sizes="112px"
                        className="object-cover"
                      />
                      {/* 기준사진 배지 */}
                      {photo.isBaseline && (
                        <div className="absolute inset-x-0 bottom-0 bg-admin-primary/90 px-1 py-0.5">
                          <p className="text-center text-[9px] font-bold tracking-tight text-white">
                            {t("photoEdit.baselineBadge")}
                          </p>
                        </div>
                      )}
                      {/* 삭제 X */}
                      <button
                        type="button"
                        onClick={() => onDeleteClick(photo)}
                        disabled={busyId === photo.id}
                        aria-label={t("photoEdit.delete")}
                        className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white shadow-lg transition-transform active:scale-90 disabled:opacity-50"
                      >
                        <span className="material-symbols-outlined text-[16px]">close</span>
                      </button>
                      {/* 정렬 ◀▶ — 2장 이상일 때만 */}
                      {list.length > 1 && (
                        <div className="absolute bottom-6 left-1 flex gap-1">
                          {i > 0 && (
                            <button
                              type="button"
                              onClick={() => move(section.key, photo.id, -1)}
                              disabled={busyId === photo.id}
                              aria-label={t("photoEdit.moveLeft")}
                              className="flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white transition-transform active:scale-90 disabled:opacity-50"
                            >
                              <span className="material-symbols-outlined text-[16px]">chevron_left</span>
                            </button>
                          )}
                          {i < list.length - 1 && (
                            <button
                              type="button"
                              onClick={() => move(section.key, photo.id, 1)}
                              disabled={busyId === photo.id}
                              aria-label={t("photoEdit.moveRight")}
                              className="flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white transition-transform active:scale-90 disabled:opacity-50"
                            >
                              <span className="material-symbols-outlined text-[16px]">chevron_right</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}

                  {/* 추가 타일 — 파일 선택 */}
                  {uploadingKey === section.key ? (
                    <div className="flex h-28 w-28 flex-shrink-0 flex-col items-center justify-center gap-1 rounded-lg border-2 border-admin-primary/40 bg-admin-primary/10">
                      <div className="h-8 w-8 animate-spin rounded-full border-4 border-admin-primary/30 border-t-admin-primary" />
                      <span className="text-[10px] font-bold text-admin-primary">
                        {t("photoEdit.uploading")}
                      </span>
                    </div>
                  ) : (
                    <AddTile
                      icon="add_photo_alternate"
                      label={t("photoEdit.add")}
                      onFile={(f) => addPhoto(section, f)}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* 기준사진 삭제 경고 다이얼로그 */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
          onClick={() => setConfirmDelete(null)}
        >
          <div
            className="w-full max-w-sm overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10 text-red-400">
                <span
                  className="material-symbols-outlined text-4xl"
                  style={{ fontVariationSettings: "'wght' 600" }}
                >
                  warning
                </span>
              </div>
              <h3 className="mb-2 text-xl font-bold text-slate-100">{t("photoEdit.baselineWarnTitle")}</h3>
              <p className="px-2 text-sm leading-relaxed text-slate-400">
                {t("photoEdit.baselineWarnBody")}
              </p>
            </div>
            <div className="flex h-14 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                disabled={busyId === confirmDelete.id}
                className="h-full flex-1 font-bold text-slate-400 transition-colors hover:bg-slate-800 disabled:opacity-50"
              >
                {t("photoEdit.cancel")}
              </button>
              <div className="h-full w-px bg-slate-800" />
              <button
                type="button"
                onClick={() => deletePhoto(confirmDelete)}
                disabled={busyId === confirmDelete.id}
                className="h-full flex-1 font-bold text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50"
              >
                {t("photoEdit.delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AddTile({
  icon,
  label,
  onFile,
}: {
  icon: string;
  label: string;
  onFile: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex-shrink-0">
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
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex h-28 w-28 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-admin-primary/40 bg-admin-primary/5 transition-colors hover:bg-admin-primary/10"
      >
        <span className="material-symbols-outlined text-admin-primary">{icon}</span>
        <span className="text-[10px] font-bold text-admin-primary">{label}</span>
      </button>
    </div>
  );
}
