// ffmpeg-static / ffprobe-static — 번들 미포함 타입 선언(런타임 바이너리만 제공하는 패키지).
// reels 파이프라인(lib/instagram/reels.ts)·스모크(scripts/test-instagram-reels.ts) 전용.
declare module "ffmpeg-static" {
  // 플랫폼별 정적 ffmpeg 실행파일 절대경로. 설치 실패 시 null.
  const ffmpegPath: string | null;
  export default ffmpegPath;
}

declare module "ffprobe-static" {
  // 플랫폼별 정적 ffprobe 실행파일 경로(+ 버전).
  export const path: string;
  export const version: string;
  const _default: { path: string; version: string };
  export default _default;
}
