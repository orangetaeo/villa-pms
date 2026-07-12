// lib/fx-auto-update — 유효 환율 AUTO 모드일 때 수동 키(FX_VND_PER_KRW·FX_VND_PER_USD)를 시세로 하루 1회 갱신.
//
// 운영자가 /settings에서 매일 수동 입력하던 판매가 기준 환율을, FX_MODE=AUTO일 때만 외부 환율
// (open.er-api, lib/fx-rates 재사용)로 자동 갱신한다.
//
// ★ 근거: FX_MODE=AUTO에서 유효 환율은 이미 시세를 직접 읽지만(getEffectiveFx*), 수동 키를 시세로
//   함께 최신화하면 (a)시세 장애 시 폴백값이 최신이고 (b)미치환 표시/정산용 소비처(대시보드·정산)가
//   시세와 정렬된다. MANUAL(미설정 포함)이면 무동작 — 수동 입력값을 자동으로 덮지 않는다.
// ★ 저장 형식은 lib/pricing 파서(/^\d+(\.\d{1,4})?$/, 양수)와 호환(formatVndPerUnit).
import type { DbClient } from "./availability";
import { writeAuditLog } from "./audit-log";
import { FX_VND_PER_KRW_KEY, FX_VND_PER_USD_KEY } from "./pricing";
import { getDailyRates, type DailyRates } from "./fx-rates";
import { formatVndPerUnit } from "./fx-format";
import { parseFxMode, FX_MODE_KEY } from "./fx-effective";

/**
 * @deprecated FX_AUTO_UPDATE 토글은 FX_MODE(MANUAL|AUTO)로 대체됨 — runFxAutoUpdate는 더 이상 이 키를 읽지 않는다.
 *   라이브 잔존 데이터 때문에 키 상수·settings 검증자는 유지하되(주입 차단), 동작 판정은 FX_MODE가 담당한다.
 */
export const FX_AUTO_UPDATE_KEY = "FX_AUTO_UPDATE";

/** @deprecated FX_AUTO_UPDATE 해석 헬퍼 — cron은 이제 FX_MODE=AUTO로 판정한다. */
export function isFxAutoUpdateOn(value: string | null | undefined): boolean {
  return value === "on";
}

/**
 * 수치 → FX 저장 문자열 (통화 무관). fx-format.formatVndPerUnit의 하위호환 별칭.
 * @deprecated formatVndPerUnit(lib/fx-format)을 직접 사용.
 */
export const formatFxVndPerKrw = formatVndPerUnit;

/** 키 1개 갱신 결과. */
export type FxKeyUpdateStatus =
  | "updated" // 값 갱신 + AuditLog
  | "unchanged" // 새 값이 기존과 동일 — 쓰기·로그 생략
  | "invalid"; // 환율 수치가 저장 형식으로 변환 불가 — 기존 값 유지

export interface FxKeyUpdate {
  key: string;
  status: FxKeyUpdateStatus;
  oldValue: string | null;
  newValue?: string;
}

export type FxAutoUpdateStatus =
  | "skipped_manual" // FX_MODE != AUTO(미설정 포함) — 무동작
  | "no_rate" // 외부 환율 조회 실패(장애) — 기존 값 유지
  | "updated" // 하나 이상 키 갱신
  | "unchanged"; // 시세 정상이나 갱신 없음(전부 동일/invalid)

export interface FxAutoUpdateResult {
  status: FxAutoUpdateStatus;
  /** 통화 키별 상세 (AUTO 실행 시 KRW·USD 2건). skip/no_rate면 빈 배열. */
  keys: FxKeyUpdate[];
}

/** runFxAutoUpdate가 의존하는 최소 DB 형태 (PrismaClient·tx 호환). */
type FxAutoDbClient = DbClient & {
  appSetting: {
    findUnique(args: { where: { key: string } }): Promise<{ value: string } | null>;
    upsert(args: {
      where: { key: string };
      create: { key: string; value: string };
      update: { value: string };
    }): Promise<unknown>;
  };
};

/** 수동 키 1개를 시세값(vndPerUnit)으로 갱신 — 변환 불가/동일값은 쓰기·로그 생략. */
async function updateFxKey(
  db: FxAutoDbClient,
  key: string,
  vndPerUnit: number
): Promise<FxKeyUpdate> {
  const existing = await db.appSetting.findUnique({ where: { key } });
  const oldValue = existing?.value ?? null;
  const newValue = formatVndPerUnit(vndPerUnit);
  if (!newValue) return { key, status: "invalid", oldValue };
  if (oldValue === newValue) return { key, status: "unchanged", oldValue, newValue };

  await db.appSetting.upsert({
    where: { key },
    create: { key, value: newValue },
    update: { value: newValue },
  });

  // 감사 로그 — 데이터 변경 동시 기록(글로벌 절대 규칙). cron 시스템 처리이므로 userId=null.
  await writeAuditLog({
    userId: null,
    action: "UPDATE",
    entity: "AppSetting",
    entityId: key,
    changes: { value: { old: oldValue, new: newValue }, source: { new: "fx-auto-update" } },
    db,
  });

  return { key, status: "updated", oldValue, newValue };
}

/**
 * 유효 환율 AUTO 갱신 1회 실행 (cron 진입점이 호출).
 * - FX_MODE != AUTO(미설정 포함)면 즉시 skipped_manual.
 * - getRates(기본: lib/fx-rates getDailyRates, 일 1회 캐시·장애 폴백)의 KRW·USD vndPerUnit으로
 *   FX_VND_PER_KRW·FX_VND_PER_USD를 각각 갱신(다를 때만 upsert + AuditLog).
 * getRates 주입으로 외부 네트워크와 분리(단위 테스트 가능).
 */
export async function runFxAutoUpdate(
  db: FxAutoDbClient,
  opts?: {
    now?: Date;
    getRates?: () => Promise<DailyRates | null>;
  }
): Promise<FxAutoUpdateResult> {
  const modeRow = await db.appSetting.findUnique({ where: { key: FX_MODE_KEY } });
  if (parseFxMode(modeRow?.value ?? null) !== "AUTO") {
    return { status: "skipped_manual", keys: [] };
  }

  const getRates = opts?.getRates ?? (() => getDailyRates(db, opts?.now ?? new Date()));
  const rates = await getRates();
  if (!rates) return { status: "no_rate", keys: [] };

  const keys: FxKeyUpdate[] = [
    await updateFxKey(db, FX_VND_PER_KRW_KEY, rates.vndPerUnit.KRW),
    await updateFxKey(db, FX_VND_PER_USD_KEY, rates.vndPerUnit.USD),
  ];

  const status: FxAutoUpdateStatus = keys.some((k) => k.status === "updated")
    ? "updated"
    : "unchanged";
  return { status, keys };
}
