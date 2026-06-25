import { ImageResponse } from "next/og";

// iOS 홈화면 아이콘 (T-pwa-install) — Safari는 SVG apple-touch-icon 미지원이라
// next/og(Satori)로 PNG 생성. sharp 불필요(nixpacks 네이티브 리스크 회피).
// 풀블리드 teal 배경(애플이 모서리 자동 라운딩) + 흰 핀=빌라 마크(컨셉 B).
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// app/icon.svg와 동일 모티브(컨셉 B 핀=빌라)를 풀블리드(라운드 코너 없음)로 — 데이터 URI로 임베드
const HOUSE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#0D9488"/>
  <g transform="translate(100 60) scale(2.6)">
    <path d="M60 2C29.6 2 5 26.6 5 57c0 39.6 47 86.5 53 92.2 1.1 1.1 2.9 1.1 4 0C68 143.5 115 96.6 115 57 115 26.6 90.4 2 60 2Z" fill="#FFFFFF"/>
    <path d="M60 26 34 50v3h6v28h40V53h6v-3L60 26Z" fill="#0D9488"/>
    <rect x="53" y="63" width="14" height="18" rx="1.5" fill="#FFFFFF"/>
    <circle cx="60" cy="42" r="5" fill="#F59E0B"/>
  </g>
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
        <img src={dataUri} width={180} height={180} alt="Villa Go" />
      </div>
    ),
    { ...size }
  );
}
