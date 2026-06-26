// Villa Go 브랜드 로고 (컨셉 B: 데스티네이션 핀 = 빌라)
// design/stitch/logo-villa-go/concept-b 기준. 마크(핀)와 워드마크를 분리 제공.
// - 라이트 배경: <VillaGoMark /> (teal 핀 + 흰 빌라)
// - teal/다크 배경(타일 안): <VillaGoMark reverse /> (흰 핀 + teal 빌라)

const PIN_PATH =
  "M60 2C29.6 2 5 26.6 5 57c0 39.6 47 86.5 53 92.2 1.1 1.1 2.9 1.1 4 0C68 143.5 115 96.6 115 57 115 26.6 90.4 2 60 2Z";
const HOUSE_PATH = "M60 26 34 50v3h6v28h40V53h6v-3L60 26Z";

export function VillaGoMark({
  className,
  reverse = false,
}: {
  className?: string;
  reverse?: boolean;
}) {
  const pin = reverse ? "#FFFFFF" : "#0D9488";
  const house = reverse ? "#0D9488" : "#FFFFFF";
  const door = reverse ? "#FFFFFF" : "#0D9488";
  return (
    <svg
      viewBox="0 0 120 150"
      className={className}
      fill="none"
      role="img"
      aria-label="Villa Go"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d={PIN_PATH} fill={pin} />
      <path d={HOUSE_PATH} fill={house} />
      <rect x="53" y="63" width="14" height="18" rx="1.5" fill={door} />
      <circle cx="60" cy="42" r="5" fill="#F59E0B" />
    </svg>
  );
}

// 워드마크: "Villa"(villa 클래스) + "Go"(go 클래스, 기본 teal). 폰트 굵기·크기는 부모/className에서.
export function VillaGoWordmark({
  className = "",
  villa = "",
  go = "text-teal-600",
}: {
  className?: string;
  villa?: string;
  go?: string;
}) {
  return (
    <span className={`font-bold tracking-tight whitespace-nowrap ${className}`}>
      <span className={villa}>Villa</span>
      <span className={go}> Go</span>
    </span>
  );
}
