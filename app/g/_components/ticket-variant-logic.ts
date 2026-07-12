// app/g/_components/ticket-variant-logic.ts — 티켓 인원별 구분(variant) 배정·그룹 분리 순수 로직 (ADR-0036 개정)
//   게스트 폼에서 선택된 사람마다 최종 variant를 결정(자동 판정 우선, 안 되면 수동 폴백)하고,
//   variantKey별로 그룹핑해 "그룹당 1 주문"으로 제출한다(가격이 다른 연령/신장 구분을 분리 구매).
//   ★ 서버가 가격을 재계산하는 것이 정본 — 여기 합계는 표시용.
import {
  classifyVariant,
  anyVariantHasRule,
  type VariantRule,
} from "@/lib/ticket-variant-rules";
import { resolveOrderPricing, ServiceSelectionError, type CatalogOptions } from "@/lib/service-catalog";

export interface ResolvedPerson {
  idx: number;
  name: string | null;
  birthDate: string | null;
  /** 소비자 자가신고 신장(cm) — 신장 규칙 판정·현장 검표용. 미입력이면 null. */
  heightCm: number | null;
  /** 최종 variant key. null = 미배정(수동 선택 필요/제출 차단). */
  key: string | null;
  /** true = 자동 판정(소비자 변경 불가). false = 수동 선택(순수 수동 모드 또는 자동 실패 폴백). */
  auto: boolean;
}

/**
 * 선택된 사람들의 최종 variant 배정. 순수.
 *   - 규칙이 하나도 없는 품목(순수 수동 모드): 수동값(manualByIdx) 또는 기본(첫 variant).
 *   - 규칙 있는 품목(자동 모드): classifyVariant로 자동 판정. 실패 시 수동값 또는 null.
 *   serviceDate·heightByIdx가 바뀌면 재판정(호출측이 재계산).
 */
export function resolveSelectedPeople(
  idxs: number[],
  guests: { name: string | null; birthDate: string | null }[],
  rules: VariantRule[],
  manualByIdx: Record<number, string>,
  heightByIdx: Record<number, number>,
  serviceDate: string,
  defaultKey: string | null
): ResolvedPerson[] {
  const auto = anyVariantHasRule(rules);
  return idxs.map((idx) => {
    const g = guests[idx] ?? { name: null, birthDate: null };
    const heightCm = heightByIdx[idx] ?? null;
    if (!auto) {
      // 순수 수동 모드 — 규칙 미설정 다품목(예: 케이블카 성인/어린이 가격만). 기본=첫 variant.
      return { idx, name: g.name, birthDate: g.birthDate, heightCm, key: manualByIdx[idx] ?? defaultKey, auto: false };
    }
    const key = classifyVariant(rules, { birthDate: g.birthDate, heightCm, serviceDate });
    if (key) return { idx, name: g.name, birthDate: g.birthDate, heightCm, key, auto: true };
    // 자동 판정 실패(기본 variant 없음 + 매칭 없음) — 수동 폴백. 미선택이면 null → 제출 차단.
    return { idx, name: g.name, birthDate: g.birthDate, heightCm, key: manualByIdx[idx] ?? null, auto: false };
  });
}

export interface TicketVariantGroup {
  variantKey: string;
  guests: { name: string | null; birthDate: string | null; heightCm?: number }[];
}

/** 사람별 최종 variantKey → variantKey별 그룹 목록(제출용). key null인 사람은 제외(호출측이 사전 차단).
 *  안정적 순서: 사람 idx 오름차순 순회, variant 첫 등장 순. heightCm은 값 있을 때만 부착. 순수. */
export function groupPeopleByVariant(people: ResolvedPerson[]): TicketVariantGroup[] {
  const order: string[] = [];
  const byKey = new Map<string, TicketVariantGroup["guests"]>();
  for (const p of [...people].sort((a, b) => a.idx - b.idx)) {
    if (!p.key) continue;
    if (!byKey.has(p.key)) {
      byKey.set(p.key, []);
      order.push(p.key);
    }
    byKey.get(p.key)!.push(
      p.heightCm != null
        ? { name: p.name, birthDate: p.birthDate, heightCm: p.heightCm }
        : { name: p.name, birthDate: p.birthDate }
    );
  }
  return order.map((k) => ({ variantKey: k, guests: byKey.get(k)! }));
}

export interface TicketVariantSubtotal {
  variantKey: string;
  /** 이 구분에 배정된 인원 수. */
  count: number;
  /** 서버 동형 재계산 소계(단가×인원). 규칙 위반·미배정은 0. */
  subtotalVnd: bigint;
}

/** variant-person 그룹별 소계 목록(카드 "구분별 소계 줄" 표시용). 라벨은 호출측이 variant에서 해석.
 *  ticketGroupsTotalVnd와 동일 재계산이되 그룹 단위로 분해해 반환. 순수. */
export function ticketGroupSubtotals(
  groups: TicketVariantGroup[],
  base: { priceVnd: bigint | null },
  options: CatalogOptions,
  addonKeys: string[],
  modifierKeys: string[]
): TicketVariantSubtotal[] {
  return groups.map((grp) => {
    let subtotalVnd = 0n;
    try {
      subtotalVnd = resolveOrderPricing(base, options, {
        variantKey: grp.variantKey,
        addonKeys,
        modifierKeys,
        quantity: grp.guests.length,
      }).totalPriceVnd;
    } catch (e) {
      if (!(e instanceof ServiceSelectionError)) throw e;
    }
    return { variantKey: grp.variantKey, count: grp.guests.length, subtotalVnd };
  });
}

/** variant-person 그룹들의 총 VND(서버 동형 재계산 합, 표시용). 규칙 위반·미배정은 0 기여. 순수. */
export function ticketGroupsTotalVnd(
  groups: TicketVariantGroup[],
  base: { priceVnd: bigint | null },
  options: CatalogOptions,
  addonKeys: string[],
  modifierKeys: string[]
): bigint {
  let vnd = 0n;
  for (const grp of groups) {
    try {
      vnd += resolveOrderPricing(base, options, {
        variantKey: grp.variantKey,
        addonKeys,
        modifierKeys,
        quantity: grp.guests.length,
      }).totalPriceVnd;
    } catch (e) {
      if (!(e instanceof ServiceSelectionError)) throw e;
    }
  }
  return vnd;
}
