// lib/settlement-statement-pdf.tsx — 정산 2차 P2-4: 월 정산서 PDF 렌더 (react-pdf, vi).
//
// 순수 모델(lib/settlement-statement.ts)을 받아 PDF Buffer 생성. server 전용(renderToBuffer).
// 폰트: 베트남어 글리프 위해 Noto Sans TTF 번들(assets/fonts). 기본 Helvetica는 베트남어 미지원.
// ★ 한글 데이터(빌라명·공급자명이 한국어일 수 있음 — 예: "쏘나씨 V11", "파일럿 중계인") 깨짐 방지:
//   react-pdf(v4)는 글리프 단위 폰트 폴백이 없어 NotoSans(한글 미수록)로는 한글이 깨진다.
//   → 동적 텍스트를 한글/비한글 런으로 분리해, 한글 런만 NanumGothic으로 렌더(MixedText).
//   정적 베트남어 라벨·숫자·베트남어 이름은 그대로 NotoSans(정상).
import * as React from "react"; // react-pdf 렌더는 JSX 클래식 런타임 경로(renderToBuffer)에서 React 전역 필요
import path from "path";
import {
  Document,
  Font,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import {
  buildStatementModel,
  type StatementInput,
  type StatementModel,
} from "@/lib/settlement-statement";

// ── 폰트 등록 (모듈 1회) ─────────────────────────────────────────────
// 기본 출력(비 standalone)에서 프로젝트 트리가 런타임에 존재 → cwd 기준 절대경로 읽기.
const FONT_DIR = path.join(process.cwd(), "assets", "fonts");
let fontsRegistered = false;
function ensureFonts(): void {
  if (fontsRegistered) return;
  Font.register({
    family: "NotoSans",
    fonts: [
      { src: path.join(FONT_DIR, "NotoSans-Regular.ttf") },
      { src: path.join(FONT_DIR, "NotoSans-Bold.ttf"), fontWeight: "bold" },
    ],
  });
  // 한글 글리프 — 한국어 빌라명·공급자명 깨짐 방지 (NotoSans엔 한글 없음)
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

// ── 한글/CJK 런 분리 렌더 (글리프 폴백 부재 우회) ─────────────────────
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
 * 동적 텍스트(빌라명·공급자명)의 자식 노드 — 한글 런만 NanumGothic span으로, 나머지는 부모 폰트(NotoSans) 상속.
 * 한글이 없으면 원문 문자열 그대로(불필요한 span 미생성). 호출부가 스타일 있는 부모 <Text>로 감싼다.
 */
function mixedTextChildren(value: string): React.ReactNode {
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

// ── 베트남어 라벨 (문서 전용 — UI 아닌 정산 문서라 인라인) ─────────────
const L = {
  title: "PHIẾU QUYẾT TOÁN HÀNG THÁNG",
  brand: "Villa Go",
  supplier: "Nhà cung cấp",
  period: "Kỳ quyết toán",
  issued: "Ngày phát hành",
  colVilla: "Biệt thự",
  colCheckout: "Ngày trả phòng",
  colNights: "Số đêm",
  colAmount: "Số tiền",
  total: "Tổng cộng",
  fx: "Điều chỉnh tỷ giá",
  note: "Số tiền trên là chi phí trả cho nhà cung cấp. Mọi thắc mắc xin liên hệ Villa Go.",
};

const styles = StyleSheet.create({
  page: {
    fontFamily: "NotoSans",
    fontSize: 10,
    paddingTop: 40,
    paddingBottom: 48,
    paddingHorizontal: 40,
    color: "#1a1a1a",
  },
  brand: { fontSize: 12, fontWeight: "bold", color: "#0d9488" },
  title: { fontSize: 18, fontWeight: "bold", marginTop: 8, marginBottom: 16 },
  metaRow: { flexDirection: "row", marginBottom: 4 },
  metaLabel: { width: 110, color: "#6b7280" },
  metaValue: { fontWeight: "bold" },
  table: { marginTop: 18, borderTopWidth: 1, borderColor: "#d1d5db" },
  th: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    borderBottomWidth: 1,
    borderColor: "#d1d5db",
    paddingVertical: 6,
    paddingHorizontal: 4,
    fontWeight: "bold",
  },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderColor: "#e5e7eb",
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  cVilla: { flex: 3 },
  cCheckout: { flex: 2, textAlign: "right" },
  cNights: { flex: 1, textAlign: "right" },
  cAmount: { flex: 2, textAlign: "right" },
  totalRow: {
    flexDirection: "row",
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 2,
    borderColor: "#111827",
  },
  totalLabel: { flex: 6, textAlign: "right", fontWeight: "bold", fontSize: 12 },
  totalValue: {
    flex: 2,
    textAlign: "right",
    fontWeight: "bold",
    fontSize: 12,
    color: "#0d9488",
  },
  fxRow: { flexDirection: "row", marginTop: 4 },
  fxLabel: { flex: 6, textAlign: "right", color: "#6b7280" },
  fxValue: { flex: 2, textAlign: "right", color: "#6b7280" },
  note: { marginTop: 28, fontSize: 8, color: "#9ca3af" },
});

function StatementDocument({ model }: { model: StatementModel }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.brand}>{L.brand}</Text>
        <Text style={styles.title}>{L.title}</Text>

        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>{L.supplier}</Text>
          <Text style={styles.metaValue}>{mixedTextChildren(model.supplierName)}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>{L.period}</Text>
          <Text style={styles.metaValue}>{model.yearMonth}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>{L.issued}</Text>
          <Text style={styles.metaValue}>{model.issuedAt}</Text>
        </View>

        <View style={styles.table}>
          <View style={styles.th}>
            <Text style={styles.cVilla}>{L.colVilla}</Text>
            <Text style={styles.cCheckout}>{L.colCheckout}</Text>
            <Text style={styles.cNights}>{L.colNights}</Text>
            <Text style={styles.cAmount}>{L.colAmount}</Text>
          </View>
          {model.rows.map((r, i) => (
            <View style={styles.tr} key={i}>
              <Text style={styles.cVilla}>{mixedTextChildren(r.villaName)}</Text>
              <Text style={styles.cCheckout}>{r.checkOut}</Text>
              <Text style={styles.cNights}>{r.nights}</Text>
              <Text style={styles.cAmount}>{r.amount}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>{L.total}</Text>
          <Text style={styles.totalValue}>{model.total}</Text>
        </View>
        {model.fxNote && (
          <View style={styles.fxRow}>
            <Text style={styles.fxLabel}>{L.fx}</Text>
            <Text style={styles.fxValue}>{model.fxNote}</Text>
          </View>
        )}

        <Text style={styles.note}>{L.note}</Text>
      </Page>
    </Document>
  );
}

/** 정산서 PDF 생성 — 모델 → PDF Buffer. 폰트 1회 등록. */
export async function renderStatementPdf(model: StatementModel): Promise<Buffer> {
  ensureFonts();
  return renderToBuffer(<StatementDocument model={model} />);
}

/** 편의: 입력 → 모델(라인 합 검증) → PDF Buffer. */
export async function generateStatementPdf(input: StatementInput): Promise<Buffer> {
  return renderStatementPdf(buildStatementModel(input));
}
