// lib/partner-invoice-pdf.tsx — PARTNER-3b-UI: 마감 청구서 PDF 렌더 (react-pdf, ko/vi/en).
//
// 순수 모델(lib/partner-invoice-statement.ts)을 받아 PDF Buffer 생성. server 전용(renderToBuffer).
// 출력 언어=파트너 국가로 결정(model.locale, lib/partner-country). 라벨은 LABELS 사전에서 선택.
// 폰트·한글 글리프 폴백은 공용 lib/pdf-fonts — 빌라명·파트너명 한글이 깨지지 않게 NanumGothic 분리 렌더.
import * as React from "react"; // react-pdf 렌더는 JSX 클래식 런타임 경로에서 React 전역 필요
import {
  Document,
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
import type { InvoiceLocale } from "@/lib/partner-country";
// 폰트 등록·한글 글리프 폴백은 공용 모듈로 일원화(유실 재발 방지) — lib/pdf-fonts
import { ensurePdfFonts, mixedTextChildren } from "@/lib/pdf-fonts";

// ── 청구서 라벨 사전 (파트너 국가→언어. ko/vi/en) ─────────────────────
interface InvoiceLabels {
  title: string;
  brand: string;
  partner: string;
  invoiceNo: string;
  period: string;
  due: string;
  issued: string;
  colVilla: string;
  colStay: string;
  colNights: string;
  colAmount: string;
  total: string;
  paid: string;
  outstanding: string;
  note: string;
}

const LABELS: Record<InvoiceLocale, InvoiceLabels> = {
  vi: {
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
  },
  ko: {
    title: "객실료 청구서",
    brand: "Villa Go",
    partner: "거래처",
    invoiceNo: "청구서 번호",
    period: "청구 기간",
    due: "납부 기한",
    issued: "발행일",
    colVilla: "빌라",
    colStay: "투숙 기간",
    colNights: "박",
    colAmount: "금액",
    total: "합계",
    paid: "기수납",
    outstanding: "미수 잔액",
    note: "상기 금액은 Villa Go에 납부하실 객실료입니다. 기한 내 납부 부탁드립니다. 문의 사항은 Villa Go로 연락 주시기 바랍니다.",
  },
  en: {
    title: "PAYMENT INVOICE",
    brand: "Villa Go",
    partner: "Partner",
    invoiceNo: "Invoice No.",
    period: "Billing period",
    due: "Due date",
    issued: "Issued",
    colVilla: "Villa",
    colStay: "Stay",
    colNights: "Nights",
    colAmount: "Amount",
    total: "Total",
    paid: "Paid",
    outstanding: "Outstanding",
    note: "The amount above is the room charge payable to Villa Go. Please complete payment before the due date. For any questions, please contact Villa Go.",
  },
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
  const L = LABELS[model.locale]; // 파트너 국가로 결정된 출력 언어
  // 모든 텍스트(라벨 포함)에 한글 글리프 폴백 — ko 라벨이 한글이라 NotoSans로는 깨짐.
  // 한글 런만 NanumGothic, 베트남어/라틴/숫자는 NotoSans 유지(혼합 안전).
  const T = mixedTextChildren;
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.brand}>{T(L.brand)}</Text>
        <Text style={styles.title}>{T(L.title)}</Text>

        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>{T(L.partner)}</Text>
          <Text style={styles.metaValue}>{T(model.partnerName)}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>{T(L.invoiceNo)}</Text>
          <Text style={styles.metaValue}>{T(model.invoiceNo)}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>{T(L.period)}</Text>
          <Text style={styles.metaValue}>
            {T(`${model.periodStart} ~ ${model.periodEnd}`)}
          </Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>{T(L.due)}</Text>
          <Text style={styles.metaDue}>{T(model.dueDate)}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>{T(L.issued)}</Text>
          <Text style={styles.metaValue}>{T(model.issuedAt)}</Text>
        </View>

        <View style={styles.table}>
          <View style={styles.th}>
            <Text style={styles.cVilla}>{T(L.colVilla)}</Text>
            <Text style={styles.cStay}>{T(L.colStay)}</Text>
            <Text style={styles.cNights}>{T(L.colNights)}</Text>
            <Text style={styles.cAmount}>{T(L.colAmount)}</Text>
          </View>
          {model.rows.map((r, i) => (
            <View style={styles.tr} key={i}>
              <Text style={styles.cVilla}>{T(r.villaName)}</Text>
              <Text style={styles.cStay}>{T(r.stay)}</Text>
              <Text style={styles.cNights}>{T(r.nights)}</Text>
              <Text style={styles.cAmount}>{T(r.amount)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>{T(L.total)}</Text>
          <Text style={styles.totalValue}>{T(model.total)}</Text>
        </View>
        {model.paid && (
          <View style={styles.subRow}>
            <Text style={styles.subLabel}>{T(L.paid)}</Text>
            <Text style={styles.subValue}>{T(model.paid)}</Text>
          </View>
        )}
        {model.outstanding && (
          <View style={styles.subRow}>
            <Text style={styles.outLabel}>{T(L.outstanding)}</Text>
            <Text style={styles.outValue}>{T(model.outstanding)}</Text>
          </View>
        )}

        <Text style={styles.note}>{T(L.note)}</Text>
      </Page>
    </Document>
  );
}

/** 청구서 PDF 생성 — 모델 → PDF Buffer. 폰트 1회 등록. */
export async function renderInvoicePdf(
  model: InvoiceStatementModel
): Promise<Buffer> {
  ensurePdfFonts();
  return renderToBuffer(<InvoiceDocument model={model} />);
}

/** 편의: 입력 → 모델 → PDF Buffer. */
export async function generateInvoicePdf(
  input: InvoiceStatementInput
): Promise<Buffer> {
  return renderInvoicePdf(buildInvoiceStatementModel(input));
}
