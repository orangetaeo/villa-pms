import { ImageResponse } from "next/og";

// iOS 홈화면 아이콘 (T-pwa-install) — Safari는 SVG apple-touch-icon 미지원이라
// next/og(Satori)로 PNG 생성. sharp 불필요(nixpacks 네이티브 리스크 회피).
// 풀블리드 teal 배경(애플이 모서리 자동 라운딩) + 흰 빌라 실루엣.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// app/icon.svg와 동일 모티브를 풀블리드(라운드 코너 없음)로 — 데이터 URI로 임베드
const HOUSE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#0D9488"/>
  <path d="M256 116 L398 236 H114 Z" fill="#FFFFFF"/>
  <rect x="150" y="236" width="212" height="160" rx="16" fill="#FFFFFF"/>
  <rect x="232" y="300" width="48" height="96" rx="12" fill="#0D9488"/>
  <rect x="178" y="276" width="40" height="40" rx="8" fill="#0D9488"/>
  <rect x="294" y="276" width="40" height="40" rx="8" fill="#0D9488"/>
  <circle cx="256" cy="150" r="14" fill="#F59E0B"/>
</svg>`;

export default function AppleIcon() {
  const dataUri = `data:image/svg+xml,${encodeURIComponent(HOUSE_SVG)}`;
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          backgroundColor: "#0D9488",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={dataUri} width={180} height={180} alt="Villa PMS" />
      </div>
    ),
    { ...size }
  );
}
