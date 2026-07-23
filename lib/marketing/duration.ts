// lib/marketing/duration.ts — 영상 길이 표시 포맷(마케팅 목록 공용).
//
// 유튜브 쇼츠(YoutubeShort.durationSec)와 인스타 릴스(mediaJson[].durationSec)를 같은 규칙으로 보여준다.
// 목록은 좁으므로 "m:ss"(1시간 이상이면 "h:mm:ss"). 영상이 없거나 값이 없으면 null → 뱃지 자체를 안 그린다.

/** 초 → "m:ss" (1시간 이상은 "h:mm:ss"). 값이 없거나 음수·비정상이면 null. */
export function formatDurationSec(sec: number | null | undefined): string | null {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return null;
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** 인스타 포스트 미디어 배열에서 영상 길이(초) — 릴스면 값, 이미지 캐러셀이면 null. */
export function igMediaDurationSec(
  media: { videoUrl?: string; durationSec?: number }[]
): number | null {
  for (const m of media) {
    if (m.videoUrl && typeof m.durationSec === "number") return m.durationSec;
  }
  return null;
}
