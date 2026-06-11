// [SHARED-MODULE] from Exchange hwanjeoneobmu/shared/schema.ts
// 파일 경로: /workspaces/hwanjeoneobmu/shared/schema.ts

import { sql } from "drizzle-orm";
import { pgTable, text, varchar, decimal, timestamp, jsonb, index, boolean, integer, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// --- 테이블 정의 ---

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(), // 레거시: Firebase 인증으로 대체됨. 향후 마이그레이션으로 제거 예정
});

export const transactions = pgTable("transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  type: text("type").notNull(),
  fromAssetType: text("from_asset_type"),
  fromAssetId: varchar("from_asset_id"),
  fromAssetName: text("from_asset_name").notNull(),
  toAssetType: text("to_asset_type"),
  toAssetId: varchar("to_asset_id"),
  toAssetName: text("to_asset_name").notNull(),
  fromAmount: decimal("from_amount", { precision: 18, scale: 8 }).notNull(),
  toAmount: decimal("to_amount", { precision: 18, scale: 8 }).notNull(),
  rate: decimal("rate", { precision: 18, scale: 8 }).notNull(),
  fees: decimal("fees", { precision: 18, scale: 8 }).default("0"),
  profit: decimal("profit", { precision: 18, scale: 8 }).default("0"),
  totalProfit: decimal("total_profit", { precision: 18, scale: 8 }).default("0"),
  marketPrice: decimal("market_price", { precision: 18, scale: 8 }),
  customPrice: decimal("custom_price", { precision: 18, scale: 8 }),
  status: text("status").default("pending"),
  memo: text("memo"),
  customerName: text("customer_name"),
  metadata: jsonb("metadata").$type<TransactionMetadata>(),
  // FK는 SQL로 별도 추가 (self-reference가 Drizzle 타입 추론에 순환 참조 유발)
  // ALTER TABLE transactions ADD CONSTRAINT fk_parent_transaction FOREIGN KEY (parent_transaction_id) REFERENCES transactions(id) ON DELETE SET NULL
  parentTransactionId: varchar("parent_transaction_id"),
  isMainTransaction: boolean("is_main_transaction").default(true),
  deletedAt: timestamp("deleted_at"),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
}, (table) => [
  index("idx_transactions_user_timestamp").on(table.userId, table.timestamp),
  index("idx_transactions_user_type").on(table.userId, table.type),
  index("idx_transactions_parent").on(table.parentTransactionId),
  index("idx_transactions_customer_name").on(table.userId, table.customerName),
]);

export const assets = pgTable("assets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  type: text("type").notNull(),
  name: text("name").notNull(),
  currency: text("currency").notNull(),
  balance: decimal("balance", { precision: 18, scale: 8 }).default("0"),
  metadata: jsonb("metadata").$type<AssetMetadata>(),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_assets_user_name_type").on(table.userId, table.name, table.type),
  index("idx_assets_user_deleted").on(table.userId, table.deletedAt),
]);

export const vndInventory = pgTable("vnd_inventory", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  vndAmount: decimal("vnd_amount", { precision: 18, scale: 8 }).notNull(),
  krwAmount: decimal("krw_amount", { precision: 18, scale: 8 }).notNull(),
  rate: decimal("rate", { precision: 18, scale: 8 }).notNull(),
  transactionId: varchar("transaction_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const userSettings = pgTable("user_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique(),
  bithumbFeeRate: decimal("bithumb_fee_rate", { precision: 5, scale: 4 }).default("0.0004"),
  // 🔥 하드코딩 제거: marketVndRate는 사용자가 명시적으로 설정해야 함
  // 기존 하드코딩된 기본값 "18.9160"을 제거하고 DB에서 관리
  marketVndRate: decimal("market_vnd_rate", { precision: 10, scale: 4 }),
  // 네이버 시세 기반 수수료 환전 설정
  defaultNaverFeeRate: decimal("default_naver_fee_rate", { precision: 5, scale: 4 }).default("0.0300"),
  naverRates: jsonb("naver_rates").$type<NaverRates>(), // { VND_KRW: 18.52, USD_KRW: 1385, USDT_KRW: 1383 }
  naverRateUpdatedAt: timestamp("naver_rate_updated_at"),
  // 매매 타이밍 알림 임계값 (사용자 설정 가능)
  alertThresholds: jsonb("alert_thresholds").$type<AlertThresholds>(), // { excellent: 2.5, good: 1.5, warning: 0.5 }
  // 거래소 자동 동기화 설정
  autoSyncConfig: jsonb("auto_sync_config").$type<AutoSyncConfig>(),
  // 거래소 API Key (AES-256-GCM 암호화, 서버 재시작 후 복원용)
  encryptedApiKeys: jsonb("encrypted_api_keys").$type<EncryptedApiKeys>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const exchangeRates = pgTable("exchange_rates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  fromCurrency: text("from_currency").notNull(),
  toCurrency: text("to_currency").notNull(),
  denomination: text("denomination"),
  goldShopRate: decimal("gold_shop_rate", { precision: 18, scale: 8 }),
  myBuyRate: decimal("my_buy_rate", { precision: 18, scale: 8 }),
  mySellRate: decimal("my_sell_rate", { precision: 18, scale: 8 }),
  isActive: boolean("is_active").default(true),
  memo: text("memo"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_exchange_rates_user_pair").on(table.userId, table.fromCurrency, table.toCurrency, table.isActive),
]);

// --- 일마감 정산 테이블 ---

export const settlements = pgTable("settlements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  date: date("date").notNull(), // YYYY-MM-DD 형식
  status: text("status").default("draft"), // draft, confirmed
  summary: jsonb("summary").$type<SettlementSummary>(), // { totalProfit, transactionCount, currencyBreakdown, assetSnapshot }
  confirmedAt: timestamp("confirmed_at"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  index("idx_settlements_user_date").on(table.userId, table.date),
]);

// --- 스프레드 스냅샷 (P2P 호가 축적용) ---

export const spreadSnapshots = pgTable("spread_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),

  // 빗썸 시세
  bithumbPrice: decimal("bithumb_price", { precision: 10, scale: 2 }).notNull(),
  bithumbMin24h: decimal("bithumb_min_24h", { precision: 10, scale: 2 }),
  bithumbMax24h: decimal("bithumb_max_24h", { precision: 10, scale: 2 }),

  // P2P 호가 집계
  p2pBestPrice: decimal("p2p_best_price", { precision: 12, scale: 2 }),
  p2pAvgPrice: decimal("p2p_avg_price", { precision: 12, scale: 2 }),
  p2pQuoteCount: integer("p2p_quote_count").default(0),

  // 환율
  krwToVndRate: decimal("krw_to_vnd_rate", { precision: 10, scale: 4 }),

  // 계산된 스프레드
  costPerUsdt: decimal("cost_per_usdt", { precision: 10, scale: 2 }),
  revenuePerUsdt: decimal("revenue_per_usdt", { precision: 10, scale: 2 }),
  margin: decimal("margin", { precision: 8, scale: 4 }),

  // 지정학 뉴스 컨텍스트 (A/B 분석용)
  newsDigest: text("news_digest"),                    // Gemini 요약 텍스트 (nullable)
  newsHeadlineCount: integer("news_headline_count"),   // 수집된 관련 뉴스 수 (nullable)
}, (table) => [
  index("idx_spread_snapshots_recorded_at").on(table.recordedAt),
]);

// --- API 응답 캐시 (빗썸/바이낸스 IP 제한 대응) ---

export const apiCache = pgTable("api_cache", {
  id: varchar("id").primaryKey(), // "{provider}_{endpoint}_{paramsHash}"
  provider: text("provider").notNull(), // 'bithumb' | 'binance'
  endpoint: text("endpoint").notNull(), // 'ticker', 'balance', 'p2p_orders' 등
  responseData: jsonb("response_data").$type<Record<string, unknown>>().notNull(),
  cachedAt: timestamp("cached_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  hitCount: integer("hit_count").default(0),
}, (table) => [
  index("idx_api_cache_provider_endpoint").on(table.provider, table.endpoint),
  index("idx_api_cache_expires_at").on(table.expiresAt),
]);

// --- 감사 로그 (Audit Log) ---

export const auditLogs = pgTable("audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  action: text("action").notNull(), // 'CREATE' | 'UPDATE' | 'DELETE'
  entity: text("entity").notNull(), // 'transaction' | 'asset' | 'exchangeRate' | 'userSettings' | 'settlement'
  entityId: varchar("entity_id").notNull(),
  changes: jsonb("changes").$type<Record<string, { old: unknown; new: unknown }>>(), // { field: { old: value, new: value } }
  metadata: jsonb("metadata").$type<Record<string, unknown>>(), // 추가 컨텍스트 (IP, 요청 경로 등)
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_audit_logs_entity").on(table.entity, table.entityId),
  index("idx_audit_logs_user").on(table.userId),
  index("idx_audit_logs_created_at").on(table.createdAt),
]);

export type AuditLog = typeof auditLogs.$inferSelect;
export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE';
export type AuditEntity = 'transaction' | 'asset' | 'exchangeRate' | 'userSettings' | 'settlement' | 'trade_order';

// --- 자동매매 주문 이력 (Auto Trading Orders) ---

export const tradeOrders = pgTable("trade_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  mode: text("mode").notNull(), // 'dry_run' | 'manual' | 'auto'
  status: text("status").notNull().default("pending"), // 'pending' | 'executing' | 'completed' | 'failed' | 'rejected'

  // AI 판단 결과
  signalGrade: text("signal_grade"), // 'S' | 'A' | 'B' | 'C' | 'D'
  signalConfidence: decimal("signal_confidence", { precision: 5, scale: 2 }),
  estimatedMargin: decimal("estimated_margin", { precision: 8, scale: 4 }),
  agentResult: jsonb("agent_result").$type<Record<string, unknown>>(), // MultiAgentResult 전체 스냅샷

  // 주문 상세
  side: text("side").notNull(), // 'buy' | 'sell'
  exchange: text("exchange").notNull(), // 'bithumb' | 'binance_p2p'
  currency: text("currency").notNull().default("USDT"),
  amount: decimal("amount", { precision: 18, scale: 8 }), // USDT 수량
  pricePerUnit: decimal("price_per_unit", { precision: 18, scale: 8 }), // 단가 (KRW or VND)
  totalCost: decimal("total_cost", { precision: 18, scale: 8 }), // 총 비용
  fees: decimal("fees", { precision: 18, scale: 8 }).default("0"),

  // 실제 체결 결과
  filledAmount: decimal("filled_amount", { precision: 18, scale: 8 }),
  filledPrice: decimal("filled_price", { precision: 18, scale: 8 }),
  realizedProfit: decimal("realized_profit", { precision: 18, scale: 8 }),

  // 원금 보호
  rejectionReason: text("rejection_reason"), // 원금 보호로 거부된 경우 사유

  // 연결 거래
  linkedTransactionId: varchar("linked_transaction_id"), // 실제 거래 기록 ID
  linkedOrderId: varchar("linked_order_id"), // 매수→매도 연결

  memo: text("memo"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  // P0-D2(296c0c2): 의사결정 시점의 spreadSnapshot 참조 — 뉴스↔주문 조인용 (nullable, 하위 호환)
  spreadSnapshotId: varchar("spread_snapshot_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
}, (table) => [
  index("idx_trade_orders_user_status").on(table.userId, table.status),
  index("idx_trade_orders_user_created").on(table.userId, table.createdAt),
  index("idx_trade_orders_mode").on(table.mode),
  index("idx_trade_orders_spread_snapshot").on(table.spreadSnapshotId),
]);

export type TradeOrder = typeof tradeOrders.$inferSelect;
export type TradeOrderMode = 'dry_run' | 'manual' | 'auto';
export type TradeOrderStatus = 'pending' | 'executing' | 'completed' | 'failed' | 'rejected';

// --- 빗썸 Ledger (Phase 1 — 빗썸을 SoT로) ---
// 회의록: docs/meetings/2026-04-27-bithumb-truth-source-pnl.md
// 목적: 빗썸의 모든 거래/입출금을 1:1 캐시 → 우리 trade_orders와 매칭하여 외부 거래 분리
export const bithumbLedger = pgTable("bithumb_ledger", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),

  // 빗썸 측 식별 (uuid는 빗썸이 발급, 거래/입출금 모두 보유)
  bithumbUuid: text("bithumb_uuid").notNull(),
  type: text("type").notNull(), // 'trade' | 'krw_deposit' | 'krw_withdraw' | 'usdt_deposit' | 'usdt_withdraw'
  side: text("side"), // trade의 경우만: 'buy' | 'sell'
  currency: text("currency").notNull(), // 'KRW' | 'USDT'

  // 금액 정보
  amount: decimal("amount", { precision: 18, scale: 8 }).notNull(), // 수량 (USDT거래는 USDT, 입출금은 해당 통화)
  price: decimal("price", { precision: 18, scale: 8 }), // 단가 (거래만)
  totalCost: decimal("total_cost", { precision: 18, scale: 8 }), // 총액 KRW (거래만)
  fee: decimal("fee", { precision: 18, scale: 8 }).default("0"),

  // 분류 (Phase 1 핵심)
  classification: text("classification").notNull().default("unclassified"),
  // 'auto' = 자동매매 매칭됨, 'external_manual' = 빗썸 수동매매,
  // 'external_transfer' = 입출금(환전소/외부), 'unclassified' = 분류 대기
  ourTradeOrderId: varchar("our_trade_order_id"), // 매칭된 trade_orders.id (auto만)
  classifiedAt: timestamp("classified_at"),
  classifiedBy: text("classified_by"), // 'auto_match' | 'manual'
  classificationNote: text("classification_note"),

  // 시점 정보
  bithumbCreatedAt: timestamp("bithumb_created_at").notNull(),
  bithumbDoneAt: timestamp("bithumb_done_at"),
  rawData: jsonb("raw_data").$type<Record<string, unknown>>(), // 빗썸 원본 응답 (감사용)
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
}, (table) => [
  index("idx_bithumb_ledger_user").on(table.userId),
  index("idx_bithumb_ledger_uuid").on(table.bithumbUuid),
  index("idx_bithumb_ledger_classification").on(table.classification),
  index("idx_bithumb_ledger_type_created").on(table.type, table.bithumbCreatedAt),
]);

export type BithumbLedger = typeof bithumbLedger.$inferSelect;
export type BithumbLedgerType = 'trade' | 'krw_deposit' | 'krw_withdraw' | 'usdt_deposit' | 'usdt_withdraw';
export type BithumbLedgerClassification = 'auto' | 'external_manual' | 'external_transfer' | 'unclassified';

// --- 학습된 매수 패턴 (Phase 6 — 자율 학습 시스템) ---
// 회의록: docs/meetings/2026-04-27-phase6-continuous-learning.md
// patternLearningService가 매시간 분석 → 백테스트 검증 → 통과만 active 등록
export const learnedPatterns = pgTable("learned_patterns", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  // 패턴 차원
  dimension: text("dimension").notNull(), // 'signalGrade' | 'kstHour' | 'regime' | 'kstHour+grade' 등
  bucket: text("bucket").notNull(),       // 예: 'S', '00-05', 'RANGE+B'
  patternType: text("pattern_type").notNull(), // 'penalty' | 'bonus'
  delta: decimal("delta", { precision: 5, scale: 1 }).notNull(), // 적용 점수 (페널티는 양수, 보너스도 양수)
  // 학습 통계
  winRate: decimal("win_rate", { precision: 5, scale: 2 }).notNull(),
  baseRate: decimal("base_rate", { precision: 5, scale: 2 }).notNull(),
  deltaPercentPoint: decimal("delta_pp", { precision: 5, scale: 2 }).notNull(),
  sampleSize: integer("sample_size").notNull(),
  // 활성 상태
  isActive: boolean("is_active").default(true).notNull(),
  appliedAt: timestamp("applied_at").defaultNow().notNull(),
  deactivatedAt: timestamp("deactivated_at"),
  deactivationReason: text("deactivation_reason"), // 'superseded' | 'auto_rollback' | 'manual'
  // 백테스트 검증
  backtestPnlImprovement: decimal("backtest_pnl_improvement", { precision: 12, scale: 2 }),
  backtestWinRateGain: decimal("backtest_win_rate_gain", { precision: 5, scale: 2 }),
  // 메타
  createdBy: text("created_by").default('auto_learning').notNull(), // 'auto_learning' | 'manual'
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
}, (table) => [
  index("idx_learned_patterns_user_active").on(table.userId, table.isActive),
  index("idx_learned_patterns_dimension_bucket").on(table.dimension, table.bucket),
]);

export type LearnedPattern = typeof learnedPatterns.$inferSelect;
export type LearnedPatternType = 'penalty' | 'bonus';

// 자동매매 실시간 상태 (alertStatus API에서 반환 — 인메모리, 서버 재시작 시 리셋)
export interface AutoTradingInfo {
  consecutiveWatchCount: number;  // 연속 WATCH/HOLD 횟수
  lastDecision: string;           // 마지막 AI 결정 (BUY/SELL/WATCH/HOLD)
  expectedValue: number | null;   // 기대값 (USDT) — Gemini 분석 시 계산
  roundCompleted: boolean;        // 직전 라운드 완료 여부
}

// 자동매매 설정 (userSettings.autoTradingConfig jsonb 확장)
export interface AutoTradingConfig {
  enabled: boolean;
  mode: TradeOrderMode;             // 현재 운영 모드
  defaultVndAccountName: string;    // P2P 매도 시 VND 입금 계좌명
  syncIntervalMinutes: number;      // 동기화 주기

  // 투자 금액 제한
  maxPositionUsdt: number;          // 최대 USDT 보유량 — 0=무제한
  maxInvestmentKrw: number;         // 총 투자 한도 KRW — 0=무제한
  dailyBuyLimitKrw: number;         // 일일 매수 한도 KRW — 0=무제한

  // 원금 보호 설정
  maxOrderAmountUsdt: number;       // 1회 최대 주문 (USDT) — 기본 1000
  dailyLossLimitKrw: number;        // 일일 최대 손실 (KRW) — 기본 20,000 (2026-04-22 50K→20K)
  totalLossLimitKrw: number;        // 총 최대 손실 (KRW) — 기본 250,000
  consecutiveLossLimit: number;     // 연속 손실 허용 횟수 — 기본 2 (2026-04-22 3→2)
  minMarginPercent: number;         // 최소 마진율 (%) — 기본 0.15 (수수료 왕복 0.08% + 여유 0.07%, 2026-04-22 0.3→0.15)
  stopLossPercent?: number;         // 손절 임계율 (%) — 기본 0.6, 미실현 손익이 -N% 이하 시 손절 (2026-04-22 0.3→0.6)
  forceStopLossPercent?: number;    // 강제 손절 임계율 (%) — 기본 1.0, 원금회수 대기 중에도 반드시 끊는 최종 안전선 (Phase 2에서 활용)
  buyImmunityMinutes?: number;      // 매수 후 손절 면역 시간 (분) — 기본 10 (노이즈 방어, 2026-04-22 5→10)

  // 자동 실행 조건
  autoExecuteGrades: string[];      // 자동 실행 신호 등급 — 기본 ['S', 'A']
  requireApproval: boolean;         // 수동 승인 필요 여부 — Phase 2: true

  // 운영 상태
  isEmergencyStopped: boolean;      // 긴급 정지 상태
  lastEmergencyReason?: string;

  // USDT 축적 전략 — 원금 회전 + 차액 USDT 축적
  principalKrw: number;               // 1회 매수 원금 (KRW) — 사용자 수시 조정 가능
  accumulationEnabled: boolean;       // 축적 모드 활성화 — 매도 시 원금만 회수, 차액 USDT 축적
  accumulatedUsdt: number;            // 현재 축적된 USDT (시스템이 건드리지 않음, 사용자만 관리)
  pendingAccumulationKrw: number;     // (레거시) 다음 매수 시 추가 매수할 수익 KRW

  // 서버 재시작 복원용 영속화 상태
  lastConsecutiveWatchCount?: number;
  lastAiDecision?: string;
  lastStopLossTime?: number;    // 마지막 손절 시각 (ms) — 재매수 쿨다운용
  lastSellPrice?: number;       // 직전 매도가 — 동일가 재진입 방지용
  lastSellTime?: number;        // 직전 매도 시각 (ms) — 재진입 TTL용
  lastScalpingTime?: number;    // 마지막 스캘핑 시각 (ms) — 쿨다운용
  lastRoundEndTime?: string;    // 마지막 라운드 종료 시각 (ISO) — 새 라운드 FIFO 격리용

  // 스캘핑 (횡보 구간 레인지 트레이딩)
  scalpingEnabled: boolean;           // 스캘핑 활성화
  scalpingQuantityRatio: number;      // 스캘핑 수량 비율 (원금 대비, 기본 0.5 = 50%)
  scalpingBuyPercentile: number;      // 매수 백분위 (24H 범위 하단 %, 기본 20)
  scalpingSellPercentile: number;     // 매도 백분위 (24H 범위 상단 %, 기본 80)
  scalpingCooldownMs: number;         // 스캘핑 간 최소 대기 시간 (ms, 기본 5분)

  // MDD (최대 낙폭) 기반 보수 모드
  mddThresholdPercent?: number;       // MDD 임계값 (%) — 기본 20, 초과 시 보수 모드 진입
  mddConservativeMultiplier?: number; // 보수 모드 수량 계수 — 기본 0.5 (50% 감소)
  mddRecoveryWins?: number;           // 보수 모드 해제 조건: 연속 승 수 — 기본 3
  mddMode?: 'normal' | 'conservative'; // 현재 MDD 모드 — 시스템 관리
  mddLastPeakKrw?: number;            // MDD 계산용: 최고 누적수익 (KRW)
  mddCurrentPercent?: number;         // 현재 MDD (%) — 읽기 전용, UI 표시용

  // 트레일링 스탑 — 수익 봤던 포지션의 본전 탈출
  trailingStopPercent?: number;       // 고점 대비 하락 시 청산 (%) — 기본 0.15

  // 서버 재시작 복원용 — 인메모리 상태 영속화
  externalBalanceSuspected?: boolean; // 외부 잔고 급증 매매 차단 플래그
  zeroBalanceCount?: number;          // 잔고 0 연속 횟수 (3회 이상 시 축적분 리셋)
  previousHolding?: number;           // 이전 사이클 잔고 (급증/급감 감지 기준)

  // Config 버전 추적 (롤백용, 2026-04-22 Phase 1 도입)
  configVersion?: number;             // 수정 시마다 증분되는 버전 번호
  configUpdatedAt?: string;           // 마지막 수정 시각 (ISO)

  // Phase 2 (2026-04-22): 진입가 가드 (rangePositionAgent)
  enableRangePositionGuard?: boolean; // 진입가 가드 활성화 (기본 false, feature flag)
  rangePositionUpperThreshold?: number; // 1H 범위 내 위치 임계값 (%, 기본 60 — 이 값 이상 시 페널티)
  // Phase 3c (2026-04-27): 레짐별 파라미터 동적 적용 (회의록 2026-04-27-phase2-activate-phase3c-regime-params.md)
  enableDynamicRegimeParams?: boolean; // false 기본 (shadow). 활성화 시 regime.suggestedParams로 stopLoss/trailing/minMargin 오버라이드
  // Phase 5 (2026-04-27): 학습 기반 매수 가드 (회의록 2026-04-27-phase5-learn-win-patterns.md)
  enableLearnedPatterns?: boolean; // false 기본 (shadow). 활성화 시 S등급/새벽 회피 + B등급/아침 강화
}

// --- Web Push 구독 ---

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_push_subscriptions_user").on(table.userId),
  index("idx_push_subscriptions_endpoint").on(table.endpoint),
]);

export type PushSubscription = typeof pushSubscriptions.$inferSelect;

// --- Zod 스키마 및 타입 추론 ---

export const insertUserSchema = createInsertSchema(users);
export const insertTransactionSchema = createInsertSchema(transactions);
export const insertAssetSchema = createInsertSchema(assets);
export const insertUserSettingsSchema = createInsertSchema(userSettings);
export const insertExchangeRatesSchema = createInsertSchema(exchangeRates);

export type User = typeof users.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;

// Asset 타입은 DB 스키마($inferSelect)를 기반으로 하되, UI 표시용 확장 필드 포함
// displayName, bankName, exchangeName은 런타임에 추가되는 선택적 필드
export type Asset = typeof assets.$inferSelect & {
  // 추가 표시 이름 관련
  displayName?: string;
  assetId?: string;

  // 은행 계좌 관련
  bankName?: string;
  accountNumber?: string;
  accountHolder?: string;

  // 거래소 관련
  exchangeName?: string;
  symbol?: string;
  quantity?: number;

  // 메타데이터에서 추출��는 속성들
  denominations?: Record<string, number>;
  denominationBreakdown?: Record<string, number>;
}

export type UserSettings = typeof userSettings.$inferSelect;
export type VNDInventoryItem = typeof vndInventory.$inferSelect;
export type ExchangeRate = typeof exchangeRates.$inferSelect;
export type InsertExchangeRate = typeof exchangeRates.$inferInsert;
export type Settlement = typeof settlements.$inferSelect;
export type SpreadSnapshot = typeof spreadSnapshots.$inferSelect;

// 매매 타이밍 알림 임계값 (userSettings.alertThresholds jsonb)
export interface AlertThresholds {
  excellent: number;   // 매우 좋은 매매 기회 (기본 2.5%)
  good: number;        // 좋은 매매 기회 (기본 1.5%)
  warning: number;     // 주의 수준 (기본 0.5%)
  [key: string]: number;
}

// 일마감 정산 요약 (settlements.summary jsonb)
export interface SettlementSummary {
  totalProfit: number;
  fxProfit?: number;
  changeProfit?: number;
  compensationCost?: number;
  transactionCount: number;
  currencyBreakdown?: Array<{
    currency: string;
    totalIn: number;
    totalOut: number;
    transactionCount: number;
  }>;
  assetSnapshot?: Array<{
    id: string;
    name: string;
    type: string;
    currency: string;
    balance: number;
    denominations?: Record<string, number>;
  }>;
  byType?: Record<string, { count: number; profit: number; totalIn: number; totalOut: number }>;
}

// 암호화된 거래소 API Key (userSettings.encryptedApiKeys jsonb)
export interface EncryptedApiKeys {
  bithumb?: { encrypted: string; iv: string; tag: string };
  binance?: { encrypted: string; iv: string; tag: string };
}

// 거래소 자동 동기화 설정 (userSettings.autoSyncConfig jsonb)
// autoTrading 키에 AutoTradingConfig를 중첩 저장하는 용도로도 사용
export interface AutoSyncConfig {
  enabled: boolean;
  defaultVndAccountName: string;  // P2P 매도 시 VND 입금 계좌명
  syncIntervalMinutes: number;    // 동기화 주기 (기본 5분)
  autoTrading?: AutoTradingConfig; // 자동매매 설정 (중첩)
  [key: string]: unknown;         // 확장 필드 허용
}

// 네이버 시세 기반 환전 정보 (transactions.metadata에 저장)
export interface NaverRateInfo {
  naverRate: number;        // 네이버 시세 (예: 18.52 for KRW→VND, 1385 for USD→KRW)
  feeRate: number;          // 수수료율 (0.03 = 3%)
  feeAmountKRW: number;     // 수수료 금액 (KRW)
  netExchangeAmount: number; // 수수료 선차감 후 실제 환전 금액
  rateMode: 'naver';        // 모드 식별자
  fromCurrency: string;     // 입금 통화
  toCurrency: string;       // 출금 통화
}

// 네이버 시세 저장 구조 (userSettings.naverRates jsonb)
export interface NaverRates {
  VND_KRW: number;   // 1 KRW = X VND (예: 18.52)
  USD_KRW: number;   // 1 USD = X KRW (예: 1385)
  USDT_KRW: number;  // 1 USDT = X KRW (예: 1383)
  [key: string]: number; // 향후 통화 추가 시 유연하게 대응
}

// 환전상 매입가/매도가 적용 규칙
export interface ExchangeRateRule {
  currency: string;
  denomination: string;
  buyRate: number;  // 매입가 (환전상이 받을 때)
  sellRate: number; // 매도가 (환전상이 줄 때)
}

// 환율 계산기 인터페이스
export interface ExchangeRateCalculator {
  getDepositRate(currency: string, amount: number, denomination?: string): Promise<number>;
  getWithdrawRate(currency: string, amount: number, denomination?: string): Promise<number>;
  getRateRule(fromCurrency: string, toCurrency: string): Promise<ExchangeRateRule[]>;
  calculateProfit(
    depositCurrency: string, 
    depositAmount: number,
    withdrawCurrency: string,
    withdrawAmount: number,
    metadata?: Record<string, unknown>
  ): Promise<number>;
}

// ======================================
// 일반화된 FIFO 재고 관리 타입들
// ======================================

// 자금 원천 타입 — FIFO 로트가 어떤 경로로 생성되었는지 추적
export type FundSourceType =
  | 'exchange'          // 고객 환전으로 매입
  | 'deposit'           // 일반 입금 (기본값)
  | 'transfer'          // 자산 이동 (거래소 간 등)
  | 'manual_deposit'    // 수동 현금 입금 (cash_change)
  | 'bithumb_purchase'  // 빗썸 USDT 매입
  | 'binance_p2p'       // 바이낸스 P2P VND 수령
  | 'gold_shop'         // 금은방 USD→VND 환전
  | 'nike_revenue'      // 나이키 매장 매출
  | 'profit_reinvest'   // 수익 재투입
  | 'initial_capital'   // 초기자원 (시스템 도입 시 기존 보유 자산)
  | 'balance_adjustment'; // 잔액 조정 (실물 대조 후 보정)

// 자금 원천별 라벨 (UI 표시용)
export const FUND_SOURCE_LABELS: Record<FundSourceType, string> = {
  exchange: '고객 환전',
  deposit: '일반 입금',
  transfer: '자산 이동',
  manual_deposit: '수동 입금',
  bithumb_purchase: '빗썸 매입',
  binance_p2p: '바이낸스 P2P',
  gold_shop: '금은방 환전',
  nike_revenue: '매장 매출',
  profit_reinvest: '수익 재투입',
  initial_capital: '초기자원',
  balance_adjustment: '잔액 조정',
};

export interface GenericInventoryItem {
  amount: number;                    // 재고 수량
  costPerUnitKRW: number;           // KRW 기준 단위 원가
  totalCostKRW: number;             // KRW 기준 총 원가
  sourceTransactionId: string;      // 매입 거래 ID
  purchaseDate: string;             // 매입 일시
  sourceType: FundSourceType;       // 재고 생성 원인 (자금 원천)
  denomination?: string;            // 권종 (현금 자산의 경우)
}

export interface AssetMetadata {
  balance?: number;                  // 현재 잔액
  totalCostBasis?: number;          // 총 원가 기준 (KRW)
  costTracking?: GenericInventoryItem[]; // FIFO 재고 추적

  denominationBreakdown?: Record<string, number>;
  totalCostBasisVND?: number;

  denominations?: Record<string, number>;

  bankName?: string;
  accountNumber?: string;
  accountHolder?: string;

  exchangeName?: string;
  symbol?: string;

  updatedAt?: string;
  lastSyncedAt?: string;         // 거래소 동기화 시각
}

// ======================================
// 거래 메타데이터 타입 (transactions.metadata jsonb)
// ======================================

// 보상카드 항목 (compensationCards/additionalCompensationCards 배열 원소)
export interface CompensationCardItem {
  currency: string;
  amount: number;
  denominations?: Record<string, number>;
  assetName?: string;
  cardName?: string;         // 자산명 (rollback용)
  absorbed?: boolean;        // 소액 흡수 여부
  absorptionReason?: string; // 흡수 사유
  absorbedAmount?: number;   // 흡수된 금액
  compensationAmount?: number; // 원래 ��상 금액
  originalCompensationAmount?: number; // 최초 보상 금액 (FIFO 계산용)
  reason?: string;           // 보상 사유
  isAdditional?: boolean;    // 추��보상카드 여부
}

// 권종 절사 보상 상세 (changeDetails)
export interface ChangeDetails {
  shouldPayKrw?: number;           // 보상 계산 총액 (KRW 기준)
  actualPayKrw?: number;           // 실제 지급한 보상 총액
  vndShortfall?: number;           // VND 부족분
  autoRoundingProfitInKRW?: number; // 자동 저액권 내림 수익 (≥ 0)
  autoRoundingLossInKRW?: number;  // ⚠️ 자동 저액권 내림 손실 (≥ 0, 환율 오타/시스템 결함 신호) — BUG 2026-05-19 P1#4
  autoRoundingDetails?: unknown; // AutoRoundingProfitResult — 상세 자동 절사 결과
}

// 수익 분석 메타데이터 (profitBreakdown)
export interface ProfitBreakdownMetadata {
  fxProfit: number;                          // 환율 스프레드 수익
  changeProfit: number;                      // 권종 반올림 수익
  outputRoundingProfit?: number;             // 출금카드 권종 절사 수익
  compDenominationRoundingProfit?: number;   // 보상카드 소액 절사 수익
  compensationCost: number;                  // 보상카드 비용
  compensationBreakdown?: {
    compensationFifoCost: number;
    savedWithdrawCost: number;
    netCompensationProfit: number;
    denominationRoundingProfit: number;
    details: Array<{
      currency: string;
      amount: number;
      fifoCost: number;
      originalAmount?: number;
    }>;
  };
  feeProfit?: number;                        // 수수료 수익
  totalProfit: number;                       // 합계
  fifoTotalCost?: number;                    // FIFO 원가 합계
  depositValueKRW?: number;                  // 입금 KRW 환산값
  originalLoss?: number;                     // 원래 손실 금액 (Math.max(0) 전)
  lossReason?: string;                       // 손실 사유
  absorptionSavings?: number | Record<string, number>; // 흡수 절약분 (통화별 또는 합계)
}

// 거래 메타데이터 전체 인터페이스 (transactions.metadata)
export interface TransactionMetadata {
  // 카드 기반 거래
  compensationCards?: CompensationCardItem[];
  additionalCompensationCards?: CompensationCardItem[];
  outputCardDenominations?: Record<string, number>;
  inputCardDenominations?: Record<string, number>;

  // 권종 보상 상세
  changeDetails?: ChangeDetails;

  // 수익 분석
  profitBreakdown?: ProfitBreakdownMetadata;

  // 자산 타입 (환전상 관점)
  depositAssetType?: string;
  withdrawAssetType?: string;

  // 계좌 자산 참조
  depositAccountId?: string;
  withdrawAccountId?: string;
  depositAccountName?: string;
  withdrawAccountName?: string;
  depositAccountType?: string;
  withdrawAccountType?: string;

  // 은행 거래 참조
  assetId?: string;

  // 환율 정보
  customRate?: number | string;
  naverRateInfo?: NaverRateInfo;

  // 자금 원천
  fundSource?: FundSourceType | string;
  sourceType?: FundSourceType | string; // fundSource 레거시 별칭

  // 금액 보정
  originalCompensationAmount?: number;
  fullExchangeAmount?: number | string;
  actualExchangeAmount?: number | string;

  // 빗썸 거래 동기화
  bithumbTradeKey?: string;        // 중복 방지용 composite key
  syncedAt?: string;               // 동기화 시각
  bithumbRaw?: {                   // 원본 데이터 보존
    transfer_date: number;
    units: string;
    price: string;
    amount: string;
    fee: string;
  };

  // 바이낸스 P2P 동기화
  binanceSyncKey?: string;         // 중복 방지용 composite key (binance_p2p_{orderNumber})
  orderNumber?: string;            // 바이낸스 P2P 주문번호
  counterParty?: string;           // P2P 상대방 닉네임
  usdtUnitPriceVND?: number;       // P2P 단가 (VND per USDT)
  fifoWeightedCost?: number;       // FIFO 가중 원가 (KRW)

  // 통화 정보 (동기화 거래용)
  fromCurrency?: string;           // 출금 통화
  toCurrency?: string;             // 입금 통화

  // 네트워크 이동
  txId?: string;                   // 블록체인 TX 해시
  network?: string;                // TRC20 / ERC20 / BEP20
  transferStatus?: string;         // pending / completed / failed
  transferFee?: number;            // 네트워크 수수료 (USDT)
  networkFee?: number;             // 네트워크 수수료 (USDT, 동기화용)
  networkDepositSyncKey?: string;  // 네트워크 입금 동기화 중복 방지 키
  binanceDepositAddress?: string;  // 바이낸스 입금 주소

  // 빗썸 KRW 입출금 동기화
  bithumbKrwSyncKey?: string;      // KRW 입출금 동기화 중복 방지 키
  bithumbKrwUuid?: string;         // 빗썸 입출금 UUID
  transferType?: string;           // 입출금 유형 (deposit / withdraw 등)

  // 롤백용 FIFO 스냅샷
  consumedFifoLots?: GenericInventoryItem[];              // 출금 시 소비된 FIFO 로트 원본
  depositFifoLot?: GenericInventoryItem;                  // 입금 시 추가된 FIFO 로트 원본
  compensationConsumedFifoLots?: Record<string, GenericInventoryItem[]>; // 보상카드별 소비 로트 (currency→lots)

  // 잔액 조정
  adjustmentReason?: string;      // 조정 사유
  previousBalance?: number;       // 조정 전 잔액
  actualBalance?: number;         // 조정 후 실제 잔액

  // FIFO 에러 기록 (처리 실패 시 거래는 계속 생성, 에러만 기록)
  fifoError?: boolean;
  fifoErrorMessage?: string;
}

// 타입 안전 메타데이터 추출 헬퍼
export function getTransactionMeta(tx: { metadata?: unknown }): TransactionMetadata {
  return (typeof tx.metadata === 'object' && tx.metadata !== null ? tx.metadata : {}) as TransactionMetadata;
}

export function getAssetMeta(asset: { metadata?: unknown }): AssetMetadata {
  return (typeof asset.metadata === 'object' && asset.metadata !== null ? asset.metadata : {}) as AssetMetadata;
}

// 환전상 거래 패턴 타입
export type MoneyExchangerTransactionPattern =
  | 'vnd_deposit_krw_withdraw'           // VND 받고 KRW 주기
  | 'krw_deposit_vnd_withdraw'           // KRW 받고 VND 주기
  | 'vnd_deposit_usd_withdraw'           // VND 받고 USD 주기
  | 'usd_deposit_vnd_withdraw'           // USD 받고 VND 주기
  | 'vnd_deposit_krw_withdraw_compensation'  // VND 받고 KRW 주기 + 보상
  | 'complex_multi_currency';            // 복합 다통화 거래

// ======================================
// 환전 수익성 분석 (Exchange Opportunity) 타입
// ======================================

export type OpportunityVerdict = 'profit' | 'loss' | 'neutral' | 'no_inventory' | 'no_rate';

export interface OpportunityMatrixItem {
  id: string;
  label: string;
  customerGives: string;
  customerReceives: string;
  exchangerAction: string;
  currentBuyRate: number | null;
  currentSellRate: number | null;
  myCostRate: number | null;
  profitPerUnit: number | null;
  profitPerUnitCurrency: string;
  profitPercent: number | null;
  myInventory: number;
  totalPotentialProfit: number | null;
  /** 권종 반올림 수익 (고액권 1건 기준, KRW) — 50만VND/100$ 단위 절사 차익 */
  changeProfitPerBill: number | null;
  /** 고객 100만원(또는 동등 외화) 기준 예상 총수익 (환율마진 + 권종반올림, KRW) */
  estimatedProfitPerMillion: number | null;
  /** 고객이 주는 통화 1단위의 KRW 가치 (시뮬레이션 환산용, KRW=1) */
  customerGivesKRWRate: number | null;
  verdict: OpportunityVerdict;
  explanation: string;
}

export interface OpportunityAssetEvaluation {
  currency: string;
  assetName: string;
  balance: number;
  avgCostPerUnitKRW: number;
  currentSellRateKRW: number | null;
  totalCostKRW: number;
  totalMarketValueKRW: number | null;
  unrealizedPnlKRW: number | null;
  unrealizedPnlPercent: number | null;
}

export type RecommendationType = 'profit' | 'loss' | 'info';

export interface Recommendation {
  text: string;
  type: RecommendationType;
}

export interface OpportunitySummary {
  totalUnrealizedPnlKRW: number;
  bestOpportunity: string | null;
  worstOpportunity: string | null;
  recommendations: Recommendation[];
}

export interface ExchangeOpportunityResult {
  matrix: OpportunityMatrixItem[];
  assetEvaluation: OpportunityAssetEvaluation[];
  summary: OpportunitySummary;
  timestamp: string;
}