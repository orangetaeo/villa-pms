// [SHARED-MODULE] from Exchange hwanjeoneobmu/server/services/settlementService.ts
// 일마감 정산 서비스
import { db } from "../db";
import { settlements, transactions, assets, type Settlement } from "../../shared/schema";
import { eq, and, desc, sql, isNull } from "drizzle-orm";
import { extractCurrency } from "./profitService";

// 통화별 입출금 내역
interface CurrencyBreakdown {
  currency: string;
  totalIn: number;   // 환전상이 받은 총액
  totalOut: number;  // 환전상이 지급한 총액
  transactionCount: number;
}

// 자산 스냅샷 항목
interface AssetSnapshotItem {
  id: string;
  name: string;
  type: string;
  currency: string;
  balance: number;
  denominations?: Record<string, number>;
}

// 일일 정산 요약
interface DailySummary {
  totalProfit: number;
  fxProfit: number;          // 환율 스프레드 수익
  changeProfit: number;      // 권종 반올림 수익
  compensationCost: number;  // 보상카드 비용
  autoRoundingLossInKRW: number; // ⚠️ 자동 저액권 내림 손실 합계 (≥ 0, 환율 오타/시스템 결함 신호) — P1#4 옵션 C
  autoRoundingLossCount: number; // 손실이 발생한 거래 건수
  transactionCount: number;
  currencyBreakdown: CurrencyBreakdown[];
  assetSnapshot: AssetSnapshotItem[];
  byType: Record<string, { count: number; profit: number; totalIn: number; totalOut: number }>;
}

// 정산 조회 응답
interface DailySettlementResponse {
  date: string;
  status: string; // 'none' | 'draft' | 'confirmed'
  summary: DailySummary;
  settlement: Settlement | null;
}

class SettlementService {
  // 특정 날짜의 정산 레코드 조회
  async getSettlement(userId: string, date: string): Promise<Settlement | null> {
    const [result] = await db
      .select()
      .from(settlements)
      .where(and(
        eq(settlements.userId, userId),
        eq(settlements.date, date)
      ))
      .limit(1);

    return result || null;
  }

  // 특정 날짜의 확정(confirmed) 거래 목록 조회
  async getDailyTransactions(userId: string, date: string) {
    // YYYY-MM-DD 형식의 날짜를 KST(UTC+9) 기준으로 필터링
    // KST 00:00 = UTC 전일 15:00, KST 23:59 = UTC 당일 14:59
    const startOfDay = new Date(date + "T00:00:00+09:00");
    const endOfDay = new Date(date + "T23:59:59.999+09:00");

    const result = await db
      .select()
      .from(transactions)
      .where(and(
        eq(transactions.userId, userId),
        eq(transactions.status, "confirmed"),
        sql`${transactions.timestamp} >= ${startOfDay}`,
        sql`${transactions.timestamp} <= ${endOfDay}`
      ))
      .orderBy(desc(transactions.timestamp));

    return result;
  }

  // 정산 레코드 생성 또는 업데이트
  async createOrUpdateSettlement(
    userId: string,
    date: string,
    summary: DailySummary,
    status: "draft" | "confirmed" = "confirmed"
  ): Promise<Settlement> {
    const existing = await this.getSettlement(userId, date);

    if (existing) {
      // 기존 레코드 업데이트 — Drizzle jsonb 칼럼은 $inferInsert에 누락될 수 있어 Record cast 필요
      const [updated] = await db
        .update(settlements)
        .set({
          summary,
          status,
          confirmedAt: status === "confirmed" ? new Date() : existing.confirmedAt,
          updatedAt: new Date(),
        } as Record<string, unknown>)
        .where(eq(settlements.id, existing.id))
        .returning();

      return updated;
    } else {
      // 새 레코드 생성 — Drizzle jsonb 칼럼은 $inferInsert에서 누락될 수 있어 타입 단언 필요
      const insertValues = {
        userId,
        date,
        status,
        summary,
        confirmedAt: status === "confirmed" ? new Date() : null,
      };
      const [created] = await db
        .insert(settlements)
        .values(insertValues as typeof settlements.$inferInsert & Record<string, unknown>)
        .returning();

      return created;
    }
  }

  // 정산 이력 조회 (최근 N건)
  async getSettlementHistory(userId: string, limit: number = 30): Promise<Settlement[]> {
    return db
      .select()
      .from(settlements)
      .where(eq(settlements.userId, userId))
      .orderBy(desc(settlements.date))
      .limit(limit);
  }

  // 일일 정산 요약 계산
  async calculateDailySummary(userId: string, date: string): Promise<DailySummary> {
    // 1. 해당 날짜의 확정 거래 조회
    const dailyTransactions = await this.getDailyTransactions(userId, date);

    // 2. 자산명 → 통화 매핑 구축 (DB 자산 기반)
    const userAssets = await db
      .select({ name: assets.name, currency: assets.currency })
      .from(assets)
      .where(and(eq(assets.userId, userId), isNull(assets.deletedAt)));
    const assetCurrencyMap: Record<string, string> = {};
    for (const a of userAssets) {
      assetCurrencyMap[a.name] = a.currency;
    }

    // 자산명에서 통화 추출 (DB 매핑 우선, 없으면 이름 기반 추출)
    const resolveCurrency = (assetName: string | null | undefined): string => {
      if (!assetName) return 'KRW';
      if (assetCurrencyMap[assetName]) return assetCurrencyMap[assetName];
      return extractCurrency(assetName);
    };

    // bank_change/cash_change 방향 표시용 리터럴 문자열 (실제 자산이 아님)
    const PLACEHOLDER_NAMES = new Set(['계좌 입금', '계좌 출금', '현금 증가', '현금 감소']);

    // 거래 양쪽 통화를 해석하되, 리터럴 문자열은 상대 자산의 통화로 대체
    const resolveTransactionCurrencies = (fromName: string | null | undefined, toName: string | null | undefined) => {
      let fromCur = resolveCurrency(fromName);
      let toCur = resolveCurrency(toName);
      if (PLACEHOLDER_NAMES.has(fromName || '')) fromCur = toCur;
      if (PLACEHOLDER_NAMES.has(toName || '')) toCur = fromCur;
      return { fromCurrency: fromCur, toCurrency: toCur };
    };

    // 3. 거래 타입별 집계
    const byType: Record<string, { count: number; profit: number; totalIn: number; totalOut: number }> = {};
    let totalProfit = 0;
    let fxProfit = 0;
    let changeProfit = 0;
    let compensationCost = 0;
    let autoRoundingLossInKRW = 0;
    let autoRoundingLossCount = 0;

    // 4. 통화별 입출금 추적
    const currencyMap: Record<string, CurrencyBreakdown> = {};

    for (const txn of dailyTransactions) {
      const type = txn.type || "unknown";
      const profit = parseFloat(txn.totalProfit || txn.profit || "0");

      // 잔액 조정 거래는 관리용이므로 집계에서 제외
      const meta = (txn.metadata || {}) as Record<string, unknown>;
      if (meta.fundSource === 'balance_adjustment') continue;
      const breakdown = (meta.profitBreakdown || {}) as Record<string, unknown>;
      fxProfit += parseFloat(String(breakdown.fxProfit || 0));
      changeProfit += parseFloat(String(breakdown.changeProfit || 0));
      compensationCost += parseFloat(String(breakdown.compensationCost || 0));

      // 옵션 C — 자동 저액권 내림 손실 집계 (P1#4)
      const changeDetails = (meta.changeDetails || {}) as Record<string, unknown>;
      const loss = parseFloat(String(changeDetails.autoRoundingLossInKRW || 0));
      if (loss > 0) {
        autoRoundingLossInKRW += loss;
        autoRoundingLossCount += 1;
      }

      const fromAmount = parseFloat(txn.fromAmount || "0");
      const toAmount = parseFloat(txn.toAmount || "0");

      // 타입별 집계 (profit + 입출금 합계)
      if (!byType[type]) {
        byType[type] = { count: 0, profit: 0, totalIn: 0, totalOut: 0 };
      }
      byType[type].count += 1;
      byType[type].profit += profit;
      byType[type].totalIn += fromAmount;
      byType[type].totalOut += toAmount;
      totalProfit += profit;

      // 통화별 입출금 추적 (DB 자산 기반 통화 해석, 리터럴 보정)
      const { fromCurrency, toCurrency } = resolveTransactionCurrencies(txn.fromAssetName, txn.toAssetName);

      // 환전상이 받는 것 (from): 입금
      if (fromCurrency) {
        if (!currencyMap[fromCurrency]) {
          currencyMap[fromCurrency] = { currency: fromCurrency, totalIn: 0, totalOut: 0, transactionCount: 0 };
        }
        currencyMap[fromCurrency].totalIn += fromAmount;
        currencyMap[fromCurrency].transactionCount += 1;
      }

      // 환전상이 주는 것 (to): 출금
      if (toCurrency) {
        if (!currencyMap[toCurrency]) {
          currencyMap[toCurrency] = { currency: toCurrency, totalIn: 0, totalOut: 0, transactionCount: 0 };
        }
        currencyMap[toCurrency].totalOut += toAmount;
      }
    }

    // 4. 현재 자산 잔액 스냅샷
    const currentAssets = await db
      .select()
      .from(assets)
      .where(and(
        eq(assets.userId, userId),
        isNull(assets.deletedAt)
      ));

    const assetSnapshot: AssetSnapshotItem[] = currentAssets.map(a => {
      const meta = a.metadata && typeof a.metadata === 'object' ? a.metadata as Record<string, any> : {};
      return {
        id: a.id,
        name: a.name,
        type: a.type,
        currency: a.currency,
        balance: parseFloat(a.balance || "0"),
        ...(a.type === 'cash' && meta.denominations ? { denominations: meta.denominations } : {}),
      };
    });

    return {
      totalProfit: Math.round(totalProfit),
      fxProfit: Math.round(fxProfit),
      changeProfit: Math.round(changeProfit),
      compensationCost: Math.round(compensationCost),
      autoRoundingLossInKRW: Math.round(autoRoundingLossInKRW),
      autoRoundingLossCount,
      transactionCount: dailyTransactions.length,
      currencyBreakdown: Object.values(currencyMap),
      assetSnapshot,
      byType,
    };
  }

  // 일일 정산 데이터 전체 조회 (summary + 기존 정산 레코드)
  async getDailySettlement(userId: string, date: string): Promise<DailySettlementResponse> {
    const [summary, settlement] = await Promise.all([
      this.calculateDailySummary(userId, date),
      this.getSettlement(userId, date),
    ]);

    return {
      date,
      status: settlement?.status || "none",
      summary,
      settlement,
    };
  }

  // 일마감 보고서 데이터 (summary + 거래 목록 포함)
  async getDailyReport(userId: string, date: string) {
    const [summary, settlement, dailyTransactions] = await Promise.all([
      this.calculateDailySummary(userId, date),
      this.getSettlement(userId, date),
      this.getDailyTransactions(userId, date),
    ]);

    // 자산명 → 통화 매핑 (거래 목록에 통화 정보 포함용)
    const userAssets = await db
      .select({ name: assets.name, currency: assets.currency })
      .from(assets)
      .where(and(eq(assets.userId, userId), isNull(assets.deletedAt)));
    const assetCurrencyMap: Record<string, string> = {};
    for (const a of userAssets) {
      assetCurrencyMap[a.name] = a.currency;
    }
    const resolveCurrency = (assetName: string | null | undefined): string => {
      if (!assetName) return 'KRW';
      if (assetCurrencyMap[assetName]) return assetCurrencyMap[assetName];
      return extractCurrency(assetName);
    };
    const PLACEHOLDER_NAMES = new Set(['계좌 입금', '계좌 출금', '현금 증가', '현금 감소']);
    const resolveTransactionCurrencies = (fromName: string | null | undefined, toName: string | null | undefined) => {
      let fromCur = resolveCurrency(fromName);
      let toCur = resolveCurrency(toName);
      if (PLACEHOLDER_NAMES.has(fromName || '')) fromCur = toCur;
      if (PLACEHOLDER_NAMES.has(toName || '')) toCur = fromCur;
      return { fromCurrency: fromCur, toCurrency: toCur };
    };

    // 거래 목록을 간결한 형태로 변환 (통화 정보 포함)
    const transactionList = dailyTransactions.map(tx => {
      const { fromCurrency, toCurrency } = resolveTransactionCurrencies(tx.fromAssetName, tx.toAssetName);
      return {
      id: tx.id,
      type: tx.type,
      fromAssetName: tx.fromAssetName,
      toAssetName: tx.toAssetName,
      fromAmount: tx.fromAmount,
      toAmount: tx.toAmount,
      fromCurrency,
      toCurrency,
      rate: tx.rate,
      profit: tx.profit,
      totalProfit: tx.totalProfit,
      customerName: tx.customerName,
      memo: tx.memo,
      timestamp: tx.timestamp,
      metadata: tx.metadata,
    };
    });

    return {
      date,
      status: settlement?.status || "none",
      summary,
      settlement,
      transactions: transactionList,
    };
  }

  // 정산 확정 처리
  async confirmSettlement(userId: string, date: string): Promise<Settlement> {
    // 최신 요약 계산 후 confirmed 상태로 저장
    const summary = await this.calculateDailySummary(userId, date);
    return this.createOrUpdateSettlement(userId, date, summary, "confirmed");
  }

  async unconfirmSettlement(userId: string, date: string): Promise<Settlement> {
    // 확정 취소 → draft 상태로 되돌림
    const summary = await this.calculateDailySummary(userId, date);
    return this.createOrUpdateSettlement(userId, date, summary, "draft");
  }
}

export const settlementService = new SettlementService();
