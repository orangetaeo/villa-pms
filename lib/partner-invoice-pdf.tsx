// lib/partner-invoice-pdf.tsx — PARTNER-3b-UI: 마감 청구서 PDF 렌더 (react-pdf, vi).
//
// 순수 모델(lib/partner-invoice-statement.ts)을 받아 PDF Buffer 생성. server 전용(renderToBuffer).
// 폰트: 베트남어 글리프 위해 Noto Sans TTF 번들(assets/fonts) — 정산서 PDF와 동일.
// 파트너명은 호출부에서 nameVi 우선으로 결정(한글 토푸 회피).
import * as React from "react"; // react-pdf 렌더는 JSX 클래식 런타임 경로에서 React 전역 필요
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
  buildInvoiceStatementModel,
  type InvoiceStatementInput,
  type InvoiceStatementModel,
} from "@/lib/partner-invoice-statement";

// ── 폰트 등록 (모듈 1회) ─────────────────────────────────────────────
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
  Font.registerHyphenationCallback((word) => [word]);
  fontsRegistered = true;
}

// ── 베트남어 라벨 (청구 문서 전용 — 인라인) ─────────────────────────
const L = {
  title: "HÓA ĐƠN THANH TOÁN",
  brand: "Villa Go",
  partner: "Đối tác",
  invoiceNo: "Số hóa đơn",
  period: "Kỳ thanh toán",
  due: "Hạn thanh toán",
  issued: "Ngày phát hành",
  colVilla: "Biệt thự",
  colStay: "Thời gian lưu trú",
  colNights: "Số đêm",
  colAmount: "Số tiền",
  total: "Tổng cộng",
  paid: "Đã thanh toán",
  outstanding: "Còn lại",
  note: "Số tiền trên là tiền phòng phải thanh toán cho Villa Go. Vui lòng thanh toán trước hạn. Mọi thắc mắc xin liên hệ Villa Go.",
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
  metaDue: { fontWeight: "bold", color: "#b91c1c" },
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
  cStay: { flex: 3, textAlign: "right" },
  cNights: { flex: 1, textAlign: "right" },
  cAmount: { flex: 2, textAlign: "right" },
  totalRow: {
    flexDirection: "row",
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 2,
    borderColor: "#111827",
  },
  totalLabel: { flex: 7, textAlign: "right", fontWeight: "bold", fontSize: 12 },
  totalValue: {
    flex: 2,
    textAlign: "right",
    fontWeight: "bold",
    fontSize: 12,
    color: "#0d9488",
  },
  subRow: { flexDirection: "row", marginTop: 4 },
  subLabel: { flex: 7, textAlign: "right", color: "#6b7280" },
  subValue: { flex: 2, textAlign: "right", color: "#6b7280" },
  outLabel: { flex: 7, textAlign: "right", fontWeight: "bold", color: "#b91c1c" },
  outValue: { flex: 2, textAlign: "right", fontWeight: "bold", color: "#b91c1c" },
  note: { marginTop: 28, fontSize: 8, color: "#9ca3af" },
});

function InvoiceDocument({ model }: { model: InvoiceStatementModel }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.brand}>{L.brand}</Text>
        <Text style={styles.title}>{L.title}</Text>

        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>{L.partner}</Text>
          <Text style={styles.metaValue}>{model.partnerName}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>{L.invoiceNo}</Text>
          <Text style={styles.metaValue}>{model.invoiceNo}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>{L.period}</Text>
          <Text style={styles.metaValue}>
            {model.periodStart} ~ {model.periodEnd}
          </Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>{L.due}</Text>
          <Text style={styles.metaDue}>{model.dueDate}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>{L.issued}</Text>
          <Text style={styles.metaValue}>{model.issuedAt}</Text>
        </View>

        <View style={styles.table}>
          <View style={styles.th}>
            <Text style={styles.cVilla}>{L.colVilla}</Text>
            <Text style={styles.cStay}>{L.colStay}</Text>
            <Text style={styles.cNights}>{L.colNights}</Text>
            <Text style={styles.cAmount}>{L.colAmount}</Text>
          </View>
          {model.rows.map((r, i) => (
            <View style={styles.tr} key={i}>
              <Text style={styles.cVilla}>{r.villaName}</Text>
              <Text style={styles.cStay}>{r.stay}</Text>
              <Text style={styles.cNights}>{r.nights}</Text>
              <Text style={styles.cAmount}>{r.amount}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>{L.total}</Text>
          <Text style={styles.totalValue}>{model.total}</Text>
        </View>
        {model.paid && (
          <View style={styles.subRow}>
            <Text style={styles.subLabel}>{L.paid}</Text>
            <Text style={styles.subValue}>{model.paid}</Text>
          </View>
        )}
        {model.outstanding && (
          <View style={styles.subRow}>
            <Text style={styles.outLabel}>{L.outstanding}</Text>
            <Text style={styles.outValue}>{model.outstanding}</Text>
          </View>
        )}

        <Text style={styles.note}>{L.note}</Text>
      </Page>
    </Document>
  );
}

/** 청구서 PDF 생성 — 모델 → PDF Buffer. 폰트 1회 등록. */
export async function renderInvoicePdf(
  model: InvoiceStatementModel
): Promise<Buffer> {
  ensureFonts();
  return renderToBuffer(<InvoiceDocument model={model} />);
}

/** 편의: 입력 → 모델 → PDF Buffer. */
export async function generateInvoicePdf(
  input: InvoiceStatementInput
): Promise<Buffer> {
  return renderInvoicePdf(buildInvoiceStatementModel(input));
}
