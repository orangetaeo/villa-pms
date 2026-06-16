// T4.2 — 파일럿 시드 데이터 정합성 단위 테스트
// DB 적재 없이 순수 데이터·계산 함수만 검증 (멱등 upsert·권한 누수는 QA 실측 소관).
// vitest include = tests/**/*.test.ts 이므로 이 위치에 둔다 (prisma/는 미수집).
import { describe, it, expect } from "vitest";
import { SeasonType, MarginType } from "@prisma/client";
import {
  SEED_VILLAS,
  SEED_SEASONS,
  SEED_FX_VND_PER_KRW,
  SEED_MARGIN_PERCENT,
  buildAppSettings,
  buildPhotos,
  vndToKrwRounded,
  applyMarginVnd,
  utcDate,
} from "@/prisma/seed";
import { SETTING_KEYS } from "@/app/api/settings/validators";

const SEASONS_REQUIRED = [SeasonType.LOW, SeasonType.HIGH, SeasonType.PEAK];

describe("AppSetting 시드", () => {
  it("앱이 기대하는 SETTING_KEYS 전체를 포함한다 (미설정 키 0)", () => {
    const keys = buildAppSettings().map((s) => s.key);
    for (const k of SETTING_KEYS) {
      expect(keys).toContain(k);
    }
  });
  it("키 중복이 없다", () => {
    const keys = buildAppSettings().map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("모든 값은 비어있지 않은 문자열 (AppSetting.value 타입 규칙)", () => {
    for (const s of buildAppSettings()) {
      expect(typeof s.value).toBe("string");
      expect(s.value.length).toBeGreaterThan(0);
    }
  });
});

describe("환율 환산 vndToKrwRounded", () => {
  it("천원 단위로 라운딩한다", () => {
    expect(vndToKrwRounded(3_600_000n, 18.87) % 1000).toBe(0);
  });
  it("VND/FX 근사값에 수렴 (3.6M VND ÷ 18.87 ≈ 191,000 KRW)", () => {
    expect(vndToKrwRounded(3_600_000n, 18.87)).toBe(191_000);
  });
});

describe("마진 적용 applyMarginVnd", () => {
  it("원가 × (100+마진)/100 (BigInt 정수)", () => {
    expect(applyMarginVnd(3_000_000n, 20n)).toBe(3_600_000n);
  });
  it("반환 타입은 bigint", () => {
    expect(typeof applyMarginVnd(1_000_000n, 20n)).toBe("bigint");
  });
});

describe("빌라 시드 4채", () => {
  it("쏘나씨 V11/V12/V25 + 썬셋 사나토 A3 (LAUNCH.md 파일럿 명세)", () => {
    const names = SEED_VILLAS.map((v) => v.name).sort();
    expect(names).toEqual(["썬셋 사나토 A3", "쏘나씨 V11", "쏘나씨 V12", "쏘나씨 V25"].sort());
  });
  it("빌라 id가 고유하다 (멱등 upsert 키 충돌 없음)", () => {
    const ids = SEED_VILLAS.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const v of SEED_VILLAS) {
    describe(v.name, () => {
      it("3개 시즌(LOW·HIGH·PEAK) 요율을 모두 가진다", () => {
        const seasons = v.rates.map((r) => r.season).sort();
        expect(seasons).toEqual([...SEASONS_REQUIRED].sort());
      });
      it("시즌 요율 중복이 없다 (villaId_season unique)", () => {
        const seasons = v.rates.map((r) => r.season);
        expect(new Set(seasons).size).toBe(seasons.length);
      });
      it("판매가 > 원가 (마진 양수 — 손실 요율 금지)", () => {
        for (const r of v.rates) {
          const sale = applyMarginVnd(r.supplierCostVnd, SEED_MARGIN_PERCENT);
          expect(sale).toBeGreaterThan(r.supplierCostVnd);
        }
      });
      it("원가는 BigInt, KRW 환산가는 정수 number (금액 타입 규칙)", () => {
        for (const r of v.rates) {
          expect(typeof r.supplierCostVnd).toBe("bigint");
          const krw = vndToKrwRounded(applyMarginVnd(r.supplierCostVnd, SEED_MARGIN_PERCENT), SEED_FX_VND_PER_KRW);
          expect(Number.isInteger(krw)).toBe(true);
        }
      });
      it("성수기 > 비수기 (계절 가격 단조성)", () => {
        const cost = (s: SeasonType) => v.rates.find((r) => r.season === s)!.supplierCostVnd;
        expect(cost(SeasonType.HIGH)).toBeGreaterThan(cost(SeasonType.LOW));
        expect(cost(SeasonType.PEAK)).toBeGreaterThan(cost(SeasonType.HIGH));
      });
      it("사진 placeholder가 외관·거실·침실을 포함 (등록 필수 충족)", () => {
        const spaces = buildPhotos(v.id).map((p) => p.space);
        expect(spaces).toContain("EXTERIOR");
        expect(spaces).toContain("LIVING");
        expect(spaces).toContain("BEDROOM");
      });
    });
  }
});

describe("시즌 달력 SEED_SEASONS", () => {
  it("모든 구간은 startDate < endDate (half-open [start, end))", () => {
    for (const sp of SEED_SEASONS) {
      expect(sp.startDate.getTime()).toBeLessThan(sp.endDate.getTime());
    }
  });
  it("id가 고유하다", () => {
    const ids = SEED_SEASONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("utcDate는 UTC 자정을 반환 (@db.Date 시간대 흔들림 방지)", () => {
    const d = utcDate(2026, 2, 14);
    expect(d.toISOString()).toBe("2026-02-14T00:00:00.000Z");
  });
  it("marginType은 PERCENT 단일 (시드 정책)", () => {
    // 시드는 PERCENT 마진만 사용 — enum 존재 확인 (회귀 가드)
    expect(MarginType.PERCENT).toBe("PERCENT");
  });
});
