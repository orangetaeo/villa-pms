"use client";

// 운영자 사진 섹션 — 보기(갤러리 라이트박스) ↔ 편집(추가·삭제·정렬) 토글 래퍼.
// 편집은 SUPPLIER PhotoManager와 동일한 API(POST/DELETE/PATCH /api/villas/[id]/photos)를 다크 테마로 사용.
// 누수 0: 금액·고객 정보 없음. 사진 url·공간 라벨만 다룬다.
import { useState } from "react";
import { useTranslations } from "next-intl";
import PhotoGallery from "./photo-gallery";
import AdminPhotoManager, { type ManagedPhoto } from "./admin-photo-manager";

interface GalleryPhoto {
  id: string;
  space: string;
  spaceLabel: string | null;
  url: string;
}

interface GalleryGroup {
  space: string;
  photos: GalleryPhoto[];
}

interface Props {
  groups: GalleryGroup[];
  villaId: string;
  bedrooms: number;
  bathrooms: number;
  hasPool: boolean;
  initialPhotos: ManagedPhoto[];
}

export default function PhotoSection({
  groups,
  villaId,
  bedrooms,
  bathrooms,
  hasPool,
  initialPhotos,
}: Props) {
  const t = useTranslations("adminVillas.detail");
  const [editing, setEditing] = useState(false);

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          onClick={() => setEditing((e) => !e)}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
            editing
              ? "bg-admin-primary text-white hover:bg-admin-primary/90"
              : "border border-slate-700 text-slate-300 hover:bg-slate-800"
          }`}
        >
          <span className="material-symbols-outlined text-[16px]">
            {editing ? "check" : "edit"}
          </span>
          {editing ? t("photoEdit.done") : t("photoEdit.edit")}
        </button>
      </div>

      {editing ? (
        <AdminPhotoManager
          villaId={villaId}
          bedrooms={bedrooms}
          bathrooms={bathrooms}
          hasPool={hasPool}
          initialPhotos={initialPhotos}
        />
      ) : groups.length === 0 ? (
        <p className="py-6 text-center text-sm text-admin-muted">{t("photos.empty")}</p>
      ) : (
        <PhotoGallery groups={groups} />
      )}
    </div>
  );
}
