// lib/settlement-statement-pdf.tsx — 정산 2차 P2-4: 월 정산서 PDF 렌더 (react-pdf, vi).
//
// 순수 모델(lib/settlement-statement.ts)을 받아 PDF Buffer 생성. server 전용(renderToBuffer).
// 폰트: 베트남어 글리프 위해 Noto Sans TTF 번들(assets/fonts). 기본 Helvetica는 베트남어 미지원.
import * as React from "react"; // react-pdf 렌더는 JSX 클래식 런타임 경로(renderToBuffer)에서 React 전역 필요
import {
  Document,
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
// 폰트 등록·한글 글리프 폴백은 공용 모듈로 일원화(유실 재발 방지) — lib/pdf-fonts
import { ensurePdfFonts, mixedTextChildren } from "@/lib/pdf-fonts";

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
  ensurePdfFonts();
  return renderToBuffer(<StatementDocument model={model} />);
}

/** 편의: 입력 → 모델(라인 합 검증) → PDF Buffer. */
export async function generateStatementPdf(input: StatementInput): Promise<Buffer> {
  return renderStatementPdf(buildStatementModel(input));
}
