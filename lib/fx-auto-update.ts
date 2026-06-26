// lib/fx-auto-update — 판매가 환율(FX_VND_PER_KRW) opt-in 자동 갱신 (Phase 2 백로그)
//
// 운영자가 /settings에서 매일 수동 입력하던 판매가 기준 환율(1 KRW = x VND)을,
// FX_AUTO_UPDATE 토글이 "on"일 때만 외부 환율(open.er-api, lib/fx-rates 재사용)로 하루 1회 자동 갱신한다.
//
// ★ 사업 안전: 토글 기본 OFF(미설정=off). OFF면 cron은 무동작 — 운영자가 명시적으로 켜기 전엔
//   판매가·마진 기준 환율이 자동으로 바뀌지 않는다. ON이어도 게스트 표시 환율(fx-rates)과 동일 소스라 일관.
// ★ 저장 형식은 lib/pricing의 FX_VND_PER_KRW 파서(/^\d+(\.\d{1,4})?$/, 양수)와 호환.
import type { DbClient } from "./availability";
import { writeAuditLog } from "./audit-log";
import { FX_VND_PER_KRW_KEY } from "./pricing";
import { getDailyRates, type DailyRates } from "./fx-rates";

/** AppSetting 키 — 판매가 환율 자동 갱신 토글 ("on"=켬, 그 외/미설정=끔). */
export const FX_AUTO_UPDATE_KEY = "FX_AUTO_UPDATE";

/** 토글 값 해석 — 정확히 "on"일 때만 켬(보수적). 미설정·"off"·기타 = 끔. */
export function isFxAutoUpdateOn(value: string | null | undefined): boolean {
  return value === "on";
}

/**
 * VND-per-KRW 수치 → FX_VND_PER_KRW 저장 문자열.
 * 소수 4자리 반올림 + 뒤따르는 0/소수점 제거. 형식·양수 검증 실패 시 null(갱신 보류).
 * 예: 18.54325 → "18.5433", 18.5 → "18.5", 20.0 → "20".
 */
export function formatFxVndPerKrw(vndPerKrw: number): string | null {
  if (!Number.isFinite(vndPerKrw) || vndPerKrw <= 0) return null;
  let s = vndPerKrw.toFixed(4);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  // lib/pricing·validators와 동일한 파서로 최종 검증 (지수표기 등 비정상 차단)
  if (!/^\d+(\.\d{1,4})?$/.test(s) || Number(s) <= 0) return null;
  return s;
}

export type FxAutoUpdateStatus =
  | "skipped_off" // 토글 OFF — 무동작
  | "no_rate" // 외부 환율 조회 실패 (장애) — 기존 값 유지
  | "invalid" // 환율 수치가 저장 형식으로 변환 불가 — 기존 값 유지
  | "unchanged" // 새 값이 기존과 동일 — 쓰기·로그 생략
  | "updated"; // FX_VND_PER_KRW 갱신 + AuditLog 기록

export interface FxAutoUpdateResult {
  status: FxAutoUpdateStatus;
  oldValue?: string | null;
  newValue?: string;
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

/**
 * opt-in 환율 자동 갱신 1회 실행 (cron 진입점이 호출).
 * - 토글 OFF면 즉시 skipped_off.
 * - getRates(기본: lib/fx-rates getDailyRates, 일 1회 캐시·장애 폴백)에서 KRW vndPerUnit을 받아 변환.
 * - 기존 FX_VND_PER_KRW와 다를 때만 upsert + AuditLog(userId=null, 시스템). 동일하면 unchanged.
 * getRates 주입으로 외부 네트워크와 분리(단위 테스트 가능).
 */
export async function runFxAutoUpdate(
  db: FxAutoDbClient,
  opts?: {
    now?: Date;
    getRates?: () => Promise<DailyRates | null>;
  }
): Promise<FxAutoUpdateResult> {
  const toggle = await db.appSetting.findUnique({ where: { key: FX_AUTO_UPDATE_KEY } });
  if (!isFxAutoUpdateOn(toggle?.value)) return { status: "skipped_off" };

  const getRates = opts?.getRates ?? (() => getDailyRates(db, opts?.now ?? new Date()));
  const rates = await getRates();
  if (!rates) return { status: "no_rate" };

  const newValue = formatFxVndPerKrw(rates.vndPerUnit.KRW);
  if (!newValue) return { status: "invalid" };

  const existing = await db.appSetting.findUnique({ where: { key: FX_VND_PER_KRW_KEY } });
  const oldValue = existing?.value ?? null;
  if (oldValue === newValue) return { status: "unchanged", oldValue, newValue };

  await db.appSetting.upsert({
    where: { key: FX_VND_PER_KRW_KEY },
    create: { key: FX_VND_PER_KRW_KEY, value: newValue },
    update: { value: newValue },
  });

  // 감사 로그 — 데이터 변경 동시 기록(글로벌 절대 규칙). cron 시스템 처리이므로 userId=null.
  await writeAuditLog({
    userId: null,
    action: "UPDATE",
    entity: "AppSetting",
    entityId: FX_VND_PER_KRW_KEY,
    changes: { value: { old: oldValue, new: newValue }, source: { new: "fx-auto-update" } },
    db,
  });

  return { status: "updated", oldValue, newValue };
}
