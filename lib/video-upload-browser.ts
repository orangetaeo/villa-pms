// 영상 업로드 브라우저 인프라 — 공급자·운영자 화면 공용.
//
// 왜 별도 파일인가: `lib/villa-clip-upload.ts`는 **순수 함수만** 두는 모듈이다(node 환경에서 유닛
// 테스트가 돈다). 여기 두 함수는 DOM·XHR에 의존하므로 섞으면 그 성질이 깨진다.
//
// 왜 공용화했나: 공급자(`clip-manager.tsx`)와 운영자(`clip-review.tsx`)가 **글자 단위로 동일한**
// 사본을 각자 갖고 있었다. UX(버튼 구성·상태 표시)는 화면마다 달라야 하지만 이 둘은 UX 결합이
// 전혀 없는 인프라라, 나뉘어 있으면 "한쪽만 고쳐지는" 사고가 난다
// (예: iOS HEVC 대응·업로드 재시도를 넣을 때 한쪽을 잊는다).

/**
 * 브라우저에서 영상 길이·해상도 읽기. 못 읽으면 **null**(서버 실측에 위임).
 *
 * ★ null을 위반으로 취급하지 말 것 — iOS `.mov` HEVC 등은 브라우저가 메타데이터를 못 읽는다.
 *   여기서 막으면 정상 파일도 못 올리게 되고, 그건 서버가 걸러줄 위반보다 나쁘다.
 */
export function probeLocalVideo(
  file: File
): Promise<{ durationSec: number; width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    const done = (result: { durationSec: number; width: number; height: number } | null) => {
      URL.revokeObjectURL(url);
      resolve(result);
    };
    video.onloadedmetadata = () => {
      const d = video.duration;
      // Infinity·NaN(스트리밍 메타 미완)이면 판정 불가 → 서버에 위임
      if (!Number.isFinite(d) || d <= 0) return done(null);
      done({ durationSec: d, width: video.videoWidth, height: video.videoHeight });
    };
    video.onerror = () => done(null);
    video.src = url;
  });
}

/**
 * presigned URL로 R2에 직접 PUT — 진행률이 필요해서 fetch 대신 XHR.
 *
 * ★ 이 요청은 브라우저→R2 직결이라 **버킷 CORS 규칙이 없으면 프리플라이트에서 죽는다**
 *   (2026-07-23까지 실제로 그랬다). 실패가 네트워크 오류로 보이면 CORS부터 의심할 것.
 */
export function putWithProgress(
  url: string,
  file: File,
  contentType: string,
  onProgress: (pct: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`PUT ${xhr.status}`));
    xhr.onerror = () => reject(new Error("PUT network error"));
    xhr.send(file);
  });
}
