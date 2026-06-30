// 청소 태스크 정보 카드 (T-cleaner-features A·C·D) — 예정일·청소유형·주소·출입정보·청소메모.
//   서버에서 번역·값을 모두 plain 문자열로 받아 렌더(제출 클라 컴포넌트에 infoSlot으로 주입 가능).
//   ★ 누수: 고객정보·금액·WiFi 비번은 받지도 않는다. 주소·출입정보는 배정 청소직원 전용(게스트 비공개).
import type { ReactNode } from "react";

export interface CleaningTaskInfoProps {
  dueDateLabel: string | null;
  dueLabelText: string;
  typeText: string;
  address: string | null;
  addressLabelText: string;
  accessInfo: string | null;
  accessLabelText: string;
  cleaningNotes: string | null;
  notesLabelText: string;
}

export function CleaningTaskInfo({
  dueDateLabel,
  dueLabelText,
  typeText,
  address,
  addressLabelText,
  accessInfo,
  accessLabelText,
  cleaningNotes,
  notesLabelText,
}: CleaningTaskInfoProps) {
  return (
    <div className="space-y-3 rounded-2xl border border-neutral-100 bg-white p-4 shadow-sm">
      {/* 예정일 + 청소유형 배지 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2.5 py-1 text-xs font-bold text-teal-700">
          <span className="material-symbols-outlined text-sm">cleaning_services</span>
          {typeText}
        </span>
        {dueDateLabel && (
          <span className="inline-flex items-center gap-1 text-sm text-neutral-600">
            <span className="material-symbols-outlined text-base text-neutral-400">event</span>
            <span className="font-medium text-neutral-400">{dueLabelText}:</span>
            <span className="font-semibold text-neutral-800">{dueDateLabel}</span>
          </span>
        )}
      </div>

      {/* 주소 (D) */}
      {address && (
        <InfoRow icon="location_on" label={addressLabelText} tone="neutral">
          {address}
        </InfoRow>
      )}
      {/* 출입정보 (D) — 도어코드/키 위치 */}
      {accessInfo && (
        <InfoRow icon="key" label={accessLabelText} tone="amber">
          {accessInfo}
        </InfoRow>
      )}
      {/* 청소 특이사항/지시 (C) */}
      {cleaningNotes && (
        <InfoRow icon="info" label={notesLabelText} tone="blue">
          {cleaningNotes}
        </InfoRow>
      )}
    </div>
  );
}

function InfoRow({
  icon,
  label,
  tone,
  children,
}: {
  icon: string;
  label: string;
  tone: "neutral" | "amber" | "blue";
  children: ReactNode;
}) {
  const toneClass =
    tone === "amber"
      ? "border-amber-200 bg-amber-50"
      : tone === "blue"
        ? "border-blue-200 bg-blue-50"
        : "border-neutral-100 bg-neutral-50";
  const iconClass =
    tone === "amber" ? "text-amber-600" : tone === "blue" ? "text-blue-600" : "text-neutral-500";
  return (
    <div className={`flex items-start gap-2 rounded-xl border p-3 ${toneClass}`}>
      <span className={`material-symbols-outlined text-lg ${iconClass}`}>{icon}</span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{label}</p>
        <p className="whitespace-pre-wrap text-sm font-medium text-neutral-800">{children}</p>
      </div>
    </div>
  );
}
