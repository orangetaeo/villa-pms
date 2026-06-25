"use client";

// B 사진 관리 매니저 (a12) — 공간별 접이식 섹션. 추가(카메라/갤러리)·삭제(X)·정렬(◀▶).
// 추가: 클라 리사이즈 → POST /api/uploads(url 확보) → POST photos. 삭제: DELETE photos.
// 정렬: 같은 공간 내 좌/우 이동 → PATCH photos(orders). 드래그 대신 화살표(베트남 사용자 단순성·터치 신뢰성).
// 기준사진(isBaseline) 배지 + 삭제 시 경고 다이얼로그. 진행 중 예약 409 → 사용자 메시지.
// 누수 0: 금액·고객 정보 없음. 사진 url·공간만 다룬다.
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
  labelKey: "exterior" | "living" | "kitchen" | "balcony" | "pool" | "bedroom" | "bathroom";
}

interface Props {
  villaId: string;
  bedrooms: number;
  bathrooms: number;
  hasPool: boolean;
  initialPhotos: ManagedPhoto[];
}

/** 빌라 방 수 기반 섹션 동적 생성 (a12: 침실N·화장실N 동적) */
function buildSections(bedrooms: number, bathrooms: number, hasPool: boolean): Section[] {
  const sections: Section[] = [
    { key: "EXTERIOR", space: "EXTERIOR", labelKey: "exterior" },
    { key: "LIVING", space: "LIVING", labelKey: "living" },
    { key: "KITCHEN", space: "KITCHEN", labelKey: "kitchen" },
  ];
  for (let i = 1; i <= bedrooms; i += 1)
    sections.push({ key: `BEDROOM:${i}`, space: "BEDROOM", index: i, labelKey: "bedroom" });
  for (let i = 1; i <= bathrooms; i += 1)
    sections.push({ key: `BATHROOM:${i}`, space: "BATHROOM", index: i, labelKey: "bathroom" });
  sections.push({ key: "BALCONY", space: "BALCONY", labelKey: "balcony" });
  if (hasPool) sections.push({ key: "POOL", space: "POOL", labelKey: "pool" });
  return sections;
}

/** 사진을 섹션 키로 분류. 침실/욕실은 spaceLabel(번호)로 매칭, 없으면 첫 섹션에 모음 */
function sectionKeyOf(photo: ManagedPhoto): string {
  if (photo.space === "BEDROOM") return `BEDROOM:${photo.spaceLabel ?? "1"}`;
  if (photo.space === "BATHROOM") return `BATHROOM:${photo.spaceLabel ?? "1"}`;
  return photo.space;
}

export default function PhotoManager({
  villaId,
  bedrooms,
  bathrooms,
  hasPool,
  initialPhotos,
}: Props) {
  const t = useTranslations("photoManage");
  const tPhoto = useTranslations("wizard.photos");
  const router = useRouter();

  const sections = useMemo(
    () => buildSections(bedrooms, bathrooms, hasPool),
    [bedrooms, bathrooms, hasPool]
  );

  const [photos, setPhotos] = useState<ManagedPhoto[]>(initialPhotos);
  const [openKey, setOpenKey] = useState<string | null>(sections[0]?.key ?? null);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ManagedPhoto | null>(null);
  const [errorKey, setErrorKey] = useState<"baselineLocked" | "error" | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function sectionLabel(s: Section): string {
    if (s.labelKey === "bedroom") return tPhoto("bedroom", { n: s.index ?? 1 });
    if (s.labelKey === "bathroom") return tPhoto("bathroom", { n: s.index ?? 1 });
    return tPhoto(s.labelKey);
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
      // 도용 방지 워터마크를 저장 파일에 굽는다 (lib/watermark) — 빌라 마케팅 사진 전용
      const blob = await watermarkImage(resized);
      if (blob.size > MAX_FILE_SIZE) {
        setErrorKey("error");
        return;
      }
      const fd = new FormData();
      // 워터마크 출력은 JPEG — 확장자도 .jpg로 맞춘다(서버는 blob MIME으로 저장)
      fd.append("file", blob, file.name.replace(/\.[^.]+$/, "") + ".jpg");
      const up = await fetch("/api/uploads", { method: "POST", body: fd });
      if (!up.ok) throw new Error("upload");
      const { url } = (await up.json()) as { url: string };

      const res = await fetch(`/api/villas/${villaId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          space: section.space,
          // 침실/욕실은 번호를 spaceLabel로 저장(상세·라이트박스 라벨 규약과 동일)
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
    // 두 사진의 sortOrder 교환
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
    <main className="space-y-3 px-4 pb-28 pt-6">
      {errorKey && (
        <p
          className="rounded-lg bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700"
          role="alert"
        >
          {t(errorKey)}
        </p>
      )}

      {sections.map((section) => {
        const list = photosOf(section.key);
        const isOpen = openKey === section.key;
        return (
          <div
            key={section.key}
            className={`overflow-hidden rounded-lg border bg-white shadow-sm ${
              isOpen ? "border-teal-100 ring-1 ring-teal-50" : "border-slate-200"
            }`}
          >
            {/* 섹션 헤더 — 아이콘 + 라벨 + 사진 수량 칩 + 접기 */}
            <button
              type="button"
              onClick={() => setOpenKey(isOpen ? null : section.key)}
              className="flex w-full items-center justify-between p-4 text-left transition-colors active:bg-slate-50"
            >
              <div className={`flex items-center gap-3 ${isOpen ? "text-teal-600" : "text-slate-700"}`}>
                <span
                  className="material-symbols-outlined"
                  style={isOpen ? { fontVariationSettings: "'FILL' 1" } : undefined}
                >
                  {SPACE_ICON[section.space] ?? "image"}
                </span>
                <span className={`font-semibold ${isOpen ? "text-slate-900" : "text-slate-700"}`}>
                  {sectionLabel(section)}
                </span>
                <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs font-bold text-neutral-600">
                  {list.length}
                </span>
              </div>
              <span
                className={`material-symbols-outlined ${isOpen ? "text-teal-600" : "text-slate-400"}`}
              >
                {isOpen ? "expand_less" : "expand_more"}
              </span>
            </button>

            {isOpen && (
              <div className="border-t border-slate-100 p-4">
                <div className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {list.map((photo, i) => (
                    <div
                      key={photo.id}
                      className="group relative h-28 w-28 flex-shrink-0 overflow-hidden rounded-lg bg-neutral-200"
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
                        <div className="absolute inset-x-0 bottom-0 bg-teal-600/90 px-1 py-0.5">
                          <p className="text-center text-[9px] font-bold tracking-tight text-white">
                            {t("baselineBadge")}
                          </p>
                        </div>
                      )}
                      {/* 삭제 X */}
                      <button
                        type="button"
                        onClick={() => onDeleteClick(photo)}
                        disabled={busyId === photo.id}
                        aria-label={t("delete")}
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
                              aria-label={t("moveLeft")}
                              className="flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white transition-transform active:scale-90 disabled:opacity-50"
                            >
                              <span className="material-symbols-outlined text-[16px]">chevron_left</span>
                            </button>
                          )}
                          {i < list.length - 1 && (
                            <button
                              type="button"
                              onClick={() => move(section.key, photo.id, 1)}
                              disabled={busyId === photo.id}
                              aria-label={t("moveRight")}
                              className="flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white transition-transform active:scale-90 disabled:opacity-50"
                            >
                              <span className="material-symbols-outlined text-[16px]">chevron_right</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}

                  {/* 추가 타일 — 카메라 / 갤러리 */}
                  {uploadingKey === section.key ? (
                    <div className="flex h-28 w-28 flex-shrink-0 flex-col items-center justify-center gap-1 rounded-lg border-2 border-teal-200 bg-teal-50">
                      <div className="h-8 w-8 animate-spin rounded-full border-4 border-teal-200 border-t-teal-600" />
                      <span className="text-[10px] font-bold text-teal-700">{t("uploading")}</span>
                    </div>
                  ) : (
                    <>
                      <AddTile
                        icon="photo_camera"
                        label={t("camera")}
                        capture
                        onFile={(f) => addPhoto(section, f)}
                      />
                      <AddTile
                        icon="gallery_thumbnail"
                        label={t("gallery")}
                        onFile={(f) => addPhoto(section, f)}
                      />
                    </>
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
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-6 backdrop-blur-sm"
          onClick={() => setConfirmDelete(null)}
        >
          <div
            className="w-full max-w-sm overflow-hidden rounded-xl border border-red-100 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-50 text-red-500">
                <span
                  className="material-symbols-outlined text-4xl"
                  style={{ fontVariationSettings: "'wght' 600" }}
                >
                  warning
                </span>
              </div>
              <h3 className="mb-2 text-xl font-bold text-slate-900">{t("baselineWarnTitle")}</h3>
              <p className="px-2 text-sm leading-relaxed text-slate-500">
                {t("baselineWarnBody")}
              </p>
            </div>
            <div className="flex h-14 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                disabled={busyId === confirmDelete.id}
                className="h-full flex-1 font-bold text-slate-500 transition-colors active:bg-slate-100 disabled:opacity-50"
              >
                {t("cancel")}
              </button>
              <div className="h-full w-px bg-slate-100" />
              <button
                type="button"
                onClick={() => deletePhoto(confirmDelete)}
                disabled={busyId === confirmDelete.id}
                className="h-full flex-1 font-bold text-red-500 transition-colors active:bg-red-100 disabled:opacity-50"
              >
                {t("delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function AddTile({
  icon,
  label,
  capture,
  onFile,
}: {
  icon: string;
  label: string;
  capture?: boolean;
  onFile: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex-shrink-0">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        // capture: 카메라 직접 호출(모바일). 갤러리 타일은 미지정 → 라이브러리 선택
        {...(capture ? { capture: "environment" as const } : {})}
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
        className="flex h-28 w-28 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-teal-200 bg-teal-50/50 transition-colors active:bg-teal-100"
      >
        <span className="material-symbols-outlined text-teal-600">{icon}</span>
        <span className="text-[10px] font-bold text-teal-700">{label}</span>
      </button>
    </div>
  );
}
