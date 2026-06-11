// [SHARED-MODULE] from Exchange hwanjeoneobmu/server/services/trading/bithumbLedger.ts
// 빗썸 Ledger 서비스 (Phase 1 — 빗썸을 SoT로)
// 회의록: docs/meetings/2026-04-27-bithumb-truth-source-pnl.md
// 책임:
//  1) 빗썸 거래/입출금 내역을 bithumb_ledger 테이블에 1:1 캐시 (sync*)
//  2) trade_orders와 매칭하여 자동/외부 거래 분류 (classify)
//  3) 회계 항등식 검증 (verify)
import { db } from '../../db';
import { bithumbLedger, tradeOrders } from '../../../shared/schema';
import { eq, and, gte, sql } from 'drizzle-orm';
import bithumbApi from '../../bithumbApi';
import { logger } from '../../logger';

interface SyncResult {
  added: number;
  skipped: number;
  errors: number;
}

interface ClassifyResult {
  matchedAuto: number;
  externalTransfer: number;
  externalManual: number;
  unclassified: number;
}

class BithumbLedgerService {
  /** 빗썸 체결 내역 sync — 신규 uuid만 INSERT, since까지 자동 페이지네이션 */
  async syncTrades(userId: string, since: Date, _limit: number = 200): Promise<SyncResult> {
    const orders = await bithumbApi.getRawCompletedOrders('USDT', 5, since);
    const inRange = orders.filter((o) => {
      const t = o.created_at ? new Date(o.created_at) : null;
      return t && t >= since;
    });

    const result: SyncResult = { added: 0, skipped: 0, errors: 0 };
    for (const o of inRange) {
      if (!o.uuid) {
        result.errors++;
        continue;
      }
      try {
        const existing = await db
          .select({ id: bithumbLedger.id })
          .from(bithumbLedger)
          .where(and(eq(bithumbLedger.userId, userId), eq(bithumbLedger.bithumbUuid, o.uuid)))
          .limit(1);
        if (existing.length > 0) {
          result.skipped++;
          continue;
        }

        const volume = parseFloat(o.executed_volume || o.volume || '0');
        const price = parseFloat(o.avg_price || o.price || '0');
        const funds = parseFloat(o.executed_funds || '0') || volume * price;
        const fee = parseFloat(o.paid_fee || '0');
        const side = o.side === 'bid' ? 'buy' : o.side === 'ask' ? 'sell' : null;

        await db.insert(bithumbLedger).values({
          userId,
          bithumbUuid: o.uuid,
          type: 'trade',
          side,
          currency: 'USDT',
          amount: String(volume),
          price: String(price),
          totalCost: String(funds),
          fee: String(fee),
          classification: 'unclassified',
          bithumbCreatedAt: o.created_at ? new Date(o.created_at) : new Date(),
          rawData: o as unknown as Record<string, unknown>,
        });
        result.added++;
      } catch (e) {
        logger.warn('bithumb-ledger', `trade sync 실패 uuid=${o.uuid}`, {
          error: (e as Error).message,
        });
        result.errors++;
      }
    }
    return result;
  }

  /** KRW 입출금 sync */
  async syncKrwMovements(userId: string, since: Date, limit: number = 200): Promise<SyncResult> {
    const result: SyncResult = { added: 0, skipped: 0, errors: 0 };
    const deposits = await bithumbApi.getKrwDeposits(limit);
    const withdraws = await bithumbApi.getKrwWithdraws(limit);

    for (const d of deposits.filter((x) => x.createdAt >= since)) {
      result.errors += await this.upsertMovement(userId, {
        uuid: d.uuid,
        type: 'krw_deposit',
        currency: 'KRW',
        amount: d.amount,
        fee: d.fee,
        createdAt: d.createdAt,
        doneAt: d.doneAt,
        raw: d as unknown as Record<string, unknown>,
        result,
      });
    }
    for (const w of withdraws.filter((x) => x.createdAt >= since)) {
      result.errors += await this.upsertMovement(userId, {
        uuid: w.uuid,
        type: 'krw_withdraw',
        currency: 'KRW',
        amount: w.amount,
        fee: w.fee,
        createdAt: w.createdAt,
        doneAt: w.doneAt,
        raw: w as unknown as Record<string, unknown>,
        result,
      });
    }
    return result;
  }

  /** USDT 입출금 sync */
  async syncUsdtMovements(userId: string, since: Date, limit: number = 200): Promise<SyncResult> {
    const result: SyncResult = { added: 0, skipped: 0, errors: 0 };
    const deposits = await bithumbApi.getCoinDeposits('USDT', limit);
    const withdraws = await bithumbApi.getCoinWithdraws('USDT', limit);

    const filterSince = (raw: any) => {
      const t = raw.created_at ? new Date(raw.created_at) : null;
      return t && t >= since;
    };

    for (const d of deposits.filter(filterSince)) {
      result.errors += await this.upsertMovement(userId, {
        uuid: d.uuid || d.txid || `deposit-${d.created_at}`,
        type: 'usdt_deposit',
        currency: 'USDT',
        amount: parseFloat(d.amount || '0'),
        fee: parseFloat(d.fee || '0'),
        createdAt: new Date(d.created_at),
        doneAt: d.done_at ? new Date(d.done_at) : null,
        raw: d as Record<string, unknown>,
        result,
      });
    }
    for (const w of withdraws.filter(filterSince)) {
      result.errors += await this.upsertMovement(userId, {
        uuid: w.uuid || `withdraw-${w.created_at}`,
        type: 'usdt_withdraw',
        currency: 'USDT',
        amount: parseFloat(w.amount || '0'),
        fee: parseFloat(w.fee || '0'),
        createdAt: new Date(w.created_at),
        doneAt: w.done_at ? new Date(w.done_at) : null,
        raw: w as Record<string, unknown>,
        result,
      });
    }
    return result;
  }

  private async upsertMovement(
    userId: string,
    args: {
      uuid: string;
      type: 'krw_deposit' | 'krw_withdraw' | 'usdt_deposit' | 'usdt_withdraw';
      currency: 'KRW' | 'USDT';
      amount: number;
      fee: number;
      createdAt: Date;
      doneAt: Date | null;
      raw: Record<string, unknown>;
      result: SyncResult;
    }
  ): Promise<number> {
    try {
      const existing = await db
        .select({ id: bithumbLedger.id })
        .from(bithumbLedger)
        .where(and(eq(bithumbLedger.userId, userId), eq(bithumbLedger.bithumbUuid, args.uuid)))
        .limit(1);
      if (existing.length > 0) {
        args.result.skipped++;
        return 0;
      }
      await db.insert(bithumbLedger).values({
        userId,
        bithumbUuid: args.uuid,
        type: args.type,
        currency: args.currency,
        amount: String(args.amount),
        fee: String(args.fee),
        classification: 'external_transfer', // 입출금은 즉시 외부 분류
        classifiedAt: new Date(),
        classifiedBy: 'auto_match',
        bithumbCreatedAt: args.createdAt,
        bithumbDoneAt: args.doneAt,
        rawData: args.raw,
      });
      args.result.added++;
      return 0;
    } catch (e) {
      logger.warn('bithumb-ledger', `${args.type} sync 실패 uuid=${args.uuid}`, {
        error: (e as Error).message,
      });
      return 1;
    }
  }

  /** 전체 sync */
  async syncAll(userId: string, since: Date): Promise<{
    trades: SyncResult;
    krw: SyncResult;
    usdt: SyncResult;
  }> {
    const [trades, krw, usdt] = await Promise.all([
      this.syncTrades(userId, since),
      this.syncKrwMovements(userId, since),
      this.syncUsdtMovements(userId, since),
    ]);
    logger.info('bithumb-ledger', 'syncAll 완료', { trades, krw, usdt });
    return { trades, krw, usdt };
  }

  /** 분류: trade_orders.metadata.bithumbOrderUuid와 매칭하여 auto/external 분류 */
  async classify(userId: string): Promise<ClassifyResult> {
    // 1) unclassified 거래 ledger 조회
    const unclassified = await db
      .select()
      .from(bithumbLedger)
      .where(and(
        eq(bithumbLedger.userId, userId),
        eq(bithumbLedger.classification, 'unclassified'),
        eq(bithumbLedger.type, 'trade'),
      ));

    // 2) 우리 trade_orders의 bithumbOrderUuid 맵 — 단일 쿼리로 한 번에
    const ourOrders = await db.execute<{ id: string; bithumb_uuid: string }>(sql`
      SELECT id, metadata->>'bithumbOrderUuid' as bithumb_uuid
      FROM trade_orders
      WHERE user_id = ${userId}
        AND mode != 'dry_run' AND status = 'completed'
        AND metadata->>'bithumbOrderUuid' IS NOT NULL
    `);
    const uuidToOrderId = new Map<string, string>();
    for (const r of ourOrders.rows) {
      if (r.bithumb_uuid) uuidToOrderId.set(r.bithumb_uuid, r.id);
    }

    // 휴리스틱: USDT 출금 ledger 미리 조회 (수량/시점 매칭으로 환전소 흐름 자동 분류)
    const usdtWithdraws = await db
      .select({
        amount: bithumbLedger.amount,
        bithumbCreatedAt: bithumbLedger.bithumbCreatedAt,
      })
      .from(bithumbLedger)
      .where(and(
        eq(bithumbLedger.userId, userId),
        eq(bithumbLedger.type, 'usdt_withdraw'),
      ));
    const isLikelyTransfer = (tradeAmount: number, tradeTime: Date): boolean => {
      // ±5분 이내 + 수량 ±1 USDT (수수료 4U까지 허용) 매칭 시 환전소 추정
      const tradeMs = tradeTime.getTime();
      for (const wd of usdtWithdraws) {
        const wdAmount = parseFloat(wd.amount || '0');
        const diffAmount = Math.abs(tradeAmount - wdAmount);
        const diffMs = Math.abs(wd.bithumbCreatedAt.getTime() - tradeMs);
        if (diffAmount <= 5 && diffMs <= 5 * 60_000) return true;
      }
      return false;
    };

    const result: ClassifyResult = { matchedAuto: 0, externalTransfer: 0, externalManual: 0, unclassified: 0 };
    for (const ledger of unclassified) {
      const matchedOrderId = uuidToOrderId.get(ledger.bithumbUuid);
      if (matchedOrderId) {
        await db.update(bithumbLedger)
          .set({
            classification: 'auto',
            ourTradeOrderId: matchedOrderId,
            classifiedAt: new Date(),
            classifiedBy: 'auto_match',
          })
          .where(eq(bithumbLedger.id, ledger.id));
        result.matchedAuto++;
        continue;
      }

      // 미매칭 → 휴리스틱으로 환전소 송금 매수인지 검사
      const tradeAmount = parseFloat(ledger.amount || '0');
      if (ledger.side === 'buy' && isLikelyTransfer(tradeAmount, ledger.bithumbCreatedAt)) {
        await db.update(bithumbLedger)
          .set({
            classification: 'external_transfer',
            classifiedAt: new Date(),
            classifiedBy: 'auto_match',
            classificationNote: '휴리스틱: USDT 출금과 ±5분/±1U 매칭 → 환전소 송금 추정',
          })
          .where(eq(bithumbLedger.id, ledger.id));
        result.externalTransfer++;
      } else {
        await db.update(bithumbLedger)
          .set({
            classification: 'external_manual',
            classifiedAt: new Date(),
            classifiedBy: 'auto_match',
            classificationNote: '우리 trade_orders와 미매칭 + 출금 매칭 없음 → 빗썸 수동매매 추정',
          })
          .where(eq(bithumbLedger.id, ledger.id));
        result.externalManual++;
      }
    }

    // 입출금은 syncMovements에서 이미 external_transfer로 분류됨 — 카운트만 집계
    const transferRows = await db
      .select({ cnt: sql<string>`COUNT(*)::text` })
      .from(bithumbLedger)
      .where(and(
        eq(bithumbLedger.userId, userId),
        eq(bithumbLedger.classification, 'external_transfer'),
      ));
    result.externalTransfer = parseInt(transferRows[0]?.cnt || '0');

    const remaining = await db
      .select({ cnt: sql<string>`COUNT(*)::text` })
      .from(bithumbLedger)
      .where(and(
        eq(bithumbLedger.userId, userId),
        eq(bithumbLedger.classification, 'unclassified'),
      ));
    result.unclassified = parseInt(remaining[0]?.cnt || '0');

    logger.info('bithumb-ledger', 'classify 완료', { ...result });
    return result;
  }

  /** 사용자가 수동으로 거래 분류 변경 (관리 UI에서 호출) */
  async reclassify(
    userId: string,
    ledgerId: string,
    classification: 'auto' | 'external_manual' | 'external_transfer',
    note?: string
  ): Promise<void> {
    await db.update(bithumbLedger)
      .set({
        classification,
        classifiedAt: new Date(),
        classifiedBy: 'manual',
        classificationNote: note,
      })
      .where(and(eq(bithumbLedger.id, ledgerId), eq(bithumbLedger.userId, userId)));
  }

  /** 회계 항등식 검증: 시작 잔고 + 자동매매 + 외부 = 현재 잔고 */
  async verify(userId: string, since: Date, currentKrwBal: number, currentUsdtBal: number): Promise<{
    krw: { autoNet: number; externalNet: number; manualNet: number; impliedStart: number };
    usdt: { autoNet: number; externalNet: number; manualNet: number; impliedStart: number };
  }> {
    // 자동/외부/수동 거래 net 합계
    const rows = await db.execute<{
      classification: string;
      type: string;
      currency: string;
      side: string | null;
      total_amount: string;
      total_cost: string;
      total_fee: string;
    }>(sql`
      SELECT
        classification,
        type,
        currency,
        side,
        SUM(CAST(amount AS NUMERIC))::text AS total_amount,
        SUM(COALESCE(CAST(total_cost AS NUMERIC), 0))::text AS total_cost,
        SUM(COALESCE(CAST(fee AS NUMERIC), 0))::text AS total_fee
      FROM bithumb_ledger
      WHERE user_id = ${userId} AND bithumb_created_at >= ${since.toISOString()}
      GROUP BY classification, type, currency, side
    `);

    let autoKrw = 0, autoUsdt = 0;
    let manualKrw = 0, manualUsdt = 0;
    let externalKrw = 0, externalUsdt = 0;

    for (const r of rows.rows) {
      const totalCost = parseFloat(r.total_cost || '0');
      const totalAmount = parseFloat(r.total_amount || '0');
      const totalFee = parseFloat(r.total_fee || '0');
      // KRW 변동 / USDT 변동 산출
      let krwDelta = 0;
      let usdtDelta = 0;
      if (r.type === 'trade') {
        // buy: KRW -=(cost+fee), USDT +=amount  | sell: KRW +=(cost-fee), USDT -=amount
        if (r.side === 'buy') {
          krwDelta = -(totalCost + totalFee);
          usdtDelta = totalAmount;
        } else if (r.side === 'sell') {
          krwDelta = totalCost - totalFee;
          usdtDelta = -totalAmount;
        }
      } else if (r.type === 'krw_deposit') krwDelta = totalAmount;
      else if (r.type === 'krw_withdraw') krwDelta = -(totalAmount + totalFee);
      else if (r.type === 'usdt_deposit') usdtDelta = totalAmount;
      else if (r.type === 'usdt_withdraw') usdtDelta = -(totalAmount + totalFee);

      if (r.classification === 'auto') {
        autoKrw += krwDelta; autoUsdt += usdtDelta;
      } else if (r.classification === 'external_manual') {
        manualKrw += krwDelta; manualUsdt += usdtDelta;
      } else if (r.classification === 'external_transfer') {
        externalKrw += krwDelta; externalUsdt += usdtDelta;
      }
    }

    return {
      krw: {
        autoNet: Math.round(autoKrw),
        externalNet: Math.round(externalKrw),
        manualNet: Math.round(manualKrw),
        impliedStart: Math.round(currentKrwBal - autoKrw - externalKrw - manualKrw),
      },
      usdt: {
        autoNet: Math.round(autoUsdt * 100) / 100,
        externalNet: Math.round(externalUsdt * 100) / 100,
        manualNet: Math.round(manualUsdt * 100) / 100,
        impliedStart: Math.round((currentUsdtBal - autoUsdt - externalUsdt - manualUsdt) * 100) / 100,
      },
    };
  }
}

export const bithumbLedgerService = new BithumbLedgerService();
