// lib/pdf-fonts.tsx — react-pdf 공용 폰트 등록 + 다국어 글리프 폴백 (정산서·청구서 PDF 공유).
//
// ★ 단일 소스 ★ — NotoSans(베트남어·라틴·키릴)엔 한글/한자 글리프가 없어 한국어·중국어 텍스트가
//   PDF에서 깨진다. react-pdf v4는 글리프 단위 폰트 폴백 미지원이라, 스크립트별로 런을 분리해
//   한글→NanumGothic, 한자→(국가별) NanumGothic/NotoSansSC로 렌더(mixedTextChildren)한다.
//   (과거 이 로직이 공유 HEAD reset로 유실되어 깨짐이 재발 → 공유 모듈로 일원화)
//   지원 스크립트: 라틴·베트남어·키릴(NotoSans), 한글(NanumGothic), 간체 중국어(NotoSansSC).
import * as React from "react"; // react-pdf 렌더는 JSX 클래식 런타임 경로에서 React 전역 필요
import path from "path";
import { Font, Text } from "@react-pdf/renderer";

const FONT_DIR = path.join(process.cwd(), "assets", "fonts");
let fontsRegistered = false;

/** PDF 폰트 1회 등록. 모든 PDF 렌더 진입에서 호출. */
export function ensurePdfFonts(): void {
  if (fontsRegistered) return;
  Font.register({
    family: "NotoSans",
    fonts: [
      { src: path.join(FONT_DIR, "NotoSans-Regular.ttf") },
      { src: path.join(FONT_DIR, "NotoSans-Bold.ttf"), fontWeight: "bold" },
    ],
  });
  // 한글 — 한국어 빌라명·이름·라벨 (NotoSans엔 한글 없음)
  Font.register({
    family: "NanumGothic",
    fonts: [
      { src: path.join(FONT_DIR, "NanumGothic-Regular.ttf") },
      { src: path.join(FONT_DIR, "NanumGothic-Bold.ttf"), fontWeight: "bold" },
    ],
  });
  // 간체 중국어 — 중국 파트너 청구서(GB2312 상용자 서브셋, Regular만). bold 요청 시 Regular로 폴백.
  Font.register({
    family: "NotoSansSC",
    fonts: [{ src: path.join(FONT_DIR, "NotoSansSC-Regular.ttf") }],
  });
  // 단어 단위 줄바꿈만(하이픈 분절 비활성) — 베트남어/숫자 깨짐 방지
  Font.registerHyphenationCallback((word) => [word]);
  fontsRegistered = true;
}

type Script = "hangul" | "han" | "other";

/** 코드포인트를 스크립트로 분류 — hangul=한글, han=한자/CJK기호, other=라틴·키릴·숫자 등 */
function classify(cp: number): Script {
  if (
    (cp >= 0xac00 && cp <= 0xd7a3) || // 한글 음절
    (cp >= 0x1100 && cp <= 0x11ff) || // 한글 자모
    (cp >= 0x3130 && cp <= 0x318f) || // 호환 자모
    (cp >= 0xa960 && cp <= 0xa97f) || // 자모 확장 A
    (cp >= 0xd7b0 && cp <= 0xd7ff) // 자모 확장 B
  ) {
    return "hangul";
  }
  if (
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK 한자
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK 확장 A
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK 호환 한자
    (cp >= 0x3000 && cp <= 0x303f) || // CJK 문장부호
    (cp >= 0xff00 && cp <= 0xffef) // 전각 영숫자·기호
  ) {
    return "han";
  }
  return "other";
}

/** 문자열을 스크립트별 인접 런으로 분리 */
function splitScriptRuns(text: string): { text: string; script: Script }[] {
  const runs: { text: string; script: Script }[] = [];
  for (const ch of text) {
    const script = classify(ch.codePointAt(0) ?? 0);
    const last = runs[runs.length - 1];
    if (last && last.script === script) last.text += ch;
    else runs.push({ text: ch, script });
  }
  return runs;
}

/**
 * 동적/정적 텍스트의 자식 노드 — 스크립트별로 폰트 분리:
 *  - 한글 런 → NanumGothic
 *  - 한자 런 → hanFont (기본 NanumGothic의 한자, 중국어 청구서는 NotoSansSC)
 *  - 그 외(라틴·키릴·숫자) → 부모 폰트(NotoSans) 상속
 * 비-한글/한자만이면 원문 문자열 그대로(불필요한 span 미생성). 호출부가 스타일 부모 <Text>로 감싼다.
 * @param hanFont 한자 런에 쓸 폰트 패밀리 — 중국어 문서면 "NotoSansSC" 전달.
 */
export function mixedTextChildren(
  value: string,
  hanFont: "NanumGothic" | "NotoSansSC" = "NanumGothic"
): React.ReactNode {
  const runs = splitScriptRuns(value);
  if (runs.every((r) => r.script === "other")) return value;
  return runs.map((r, i) => {
    if (r.script === "hangul") {
      return (
        <Text key={i} style={{ fontFamily: "NanumGothic" }}>
          {r.text}
        </Text>
      );
    }
    if (r.script === "han") {
      return (
        <Text key={i} style={{ fontFamily: hanFont }}>
          {r.text}
        </Text>
      );
    }
    return <Text key={i}>{r.text}</Text>;
  });
}
