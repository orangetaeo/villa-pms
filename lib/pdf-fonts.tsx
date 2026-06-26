// lib/pdf-fonts.tsx — react-pdf 공용 폰트 등록 + 한글/CJK 글리프 폴백 (정산서·청구서 PDF 공유).
//
// ★ 단일 소스 ★ — NotoSans(베트남어·라틴·키릴)엔 한글 글리프가 없어 한국어 빌라명·이름이
//   PDF에서 겹쳐 깨진다. react-pdf v4는 글리프 단위 폰트 폴백 미지원이라, 한글(CJK) 런만
//   NanumGothic으로 분리 렌더(mixedTextChildren)로 우회한다.
//   (과거 정산서 PDF에 있던 동일 로직이 공유 HEAD reset로 유실되어 깨짐이 재발 → 공유 모듈로 일원화)
import * as React from "react"; // react-pdf 렌더는 JSX 클래식 런타임 경로에서 React 전역 필요
import path from "path";
import { Font, Text } from "@react-pdf/renderer";

const FONT_DIR = path.join(process.cwd(), "assets", "fonts");
let fontsRegistered = false;

/** PDF 폰트 1회 등록 — 베트남어/라틴=NotoSans, 한글=NanumGothic. 모든 PDF 렌더 진입에서 호출. */
export function ensurePdfFonts(): void {
  if (fontsRegistered) return;
  Font.register({
    family: "NotoSans",
    fonts: [
      { src: path.join(FONT_DIR, "NotoSans-Regular.ttf") },
      { src: path.join(FONT_DIR, "NotoSans-Bold.ttf"), fontWeight: "bold" },
    ],
  });
  // 한글 글리프 — 한국어 빌라명·이름 깨짐 방지 (NotoSans엔 한글 없음)
  Font.register({
    family: "NanumGothic",
    fonts: [
      { src: path.join(FONT_DIR, "NanumGothic-Regular.ttf") },
      { src: path.join(FONT_DIR, "NanumGothic-Bold.ttf"), fontWeight: "bold" },
    ],
  });
  // 단어 단위 줄바꿈만(하이픈 분절 비활성) — 베트남어/숫자 깨짐 방지
  Font.registerHyphenationCallback((word) => [word]);
  fontsRegistered = true;
}

/** 한글 음절·자모 및 CJK 한자/문장부호 → NanumGothic으로 라우팅할 코드포인트인지 */
function isCjkCodePoint(cp: number): boolean {
  return (
    (cp >= 0xac00 && cp <= 0xd7a3) || // 한글 음절
    (cp >= 0x1100 && cp <= 0x11ff) || // 한글 자모
    (cp >= 0x3130 && cp <= 0x318f) || // 호환 자모
    (cp >= 0xa960 && cp <= 0xa97f) || // 자모 확장 A
    (cp >= 0xd7b0 && cp <= 0xd7ff) || // 자모 확장 B
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK 한자
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK 확장 A
    (cp >= 0x3000 && cp <= 0x303f) || // CJK 문장부호
    (cp >= 0xff00 && cp <= 0xffef) // 전각 영숫자·기호
  );
}

/** 문자열을 한글(CJK)/비한글 런으로 분리 — 인접 동종 문자 묶음 */
function splitScriptRuns(text: string): { text: string; cjk: boolean }[] {
  const runs: { text: string; cjk: boolean }[] = [];
  for (const ch of text) {
    const cjk = isCjkCodePoint(ch.codePointAt(0) ?? 0);
    const last = runs[runs.length - 1];
    if (last && last.cjk === cjk) last.text += ch;
    else runs.push({ text: ch, cjk });
  }
  return runs;
}

/**
 * 동적 텍스트(빌라명·공급자명·파트너명)의 자식 노드 — 한글 런만 NanumGothic span으로,
 * 나머지는 부모 폰트(NotoSans) 상속. 한글이 없으면 원문 문자열 그대로(불필요한 span 미생성).
 * 호출부가 스타일 있는 부모 <Text>로 감싼다.
 */
export function mixedTextChildren(value: string): React.ReactNode {
  const runs = splitScriptRuns(value);
  if (!runs.some((r) => r.cjk)) return value;
  return runs.map((r, i) =>
    r.cjk ? (
      <Text key={i} style={{ fontFamily: "NanumGothic" }}>
        {r.text}
      </Text>
    ) : (
      <Text key={i}>{r.text}</Text>
    )
  );
}
