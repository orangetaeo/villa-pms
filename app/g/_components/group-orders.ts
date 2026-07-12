// app/g/_components/group-orders.ts — 게스트 신청 내역 품목별 그룹핑 (순수 함수, 단위 테스트 대상)
//   ★배경(테오): 구분별로 주문이 분리 저장되어 같은 티켓 품목이 여러 줄로 흩어짐 → 품목 기준으로 묶는다.
//   그룹 키 = catalogItemId(품목 식별자). 없으면 type 폴백(레거시·운영자 입력 주문).
//   ★누수 0: 판매가(VND)만 다루고 원가·마진 없음(GuestRequestedOrder 자체가 판매가만 담음).
import type { GuestRequestedOrder } from "./types";

export interface GuestOrderGroup {
  /** 그룹 식별 키 = catalogItemId ?? type. */
  key: string;
  /** 품목명(그룹 대표 — 같은 품목이라 첫 주문 명칭과 동일). */
  name: string;
  /** 그룹 내 주문 수량 합. */
  totalQuantity: number;
  /** 그룹 내 모든 주문의 이용일이 동일하면 그 날짜, 아니면 null(줄마다 개별 표기). */
  serviceDate: string | null;
  /** 그룹에 속한 주문 라인(입력 순서 = 최신 생성 우선 유지). */
  orders: GuestRequestedOrder[];
}

/**
 * 주문 배열 → 품목별 그룹 배열. 순수·부작용 없음.
 *   - 그룹 키: catalogItemId ?? type.
 *   - 그룹 정렬: 이용일(그룹 내 최소 serviceDate) 오름차순 → 동률이면 최신 생성 우선.
 *     입력은 createdAt desc 정렬 가정(로더) → 먼저 등장한 그룹이 더 최신이므로 firstIndex 오름차순으로 tie-break.
 *   - null 이용일 그룹은 날짜 있는 그룹보다 뒤로.
 * @param orders 로더가 createdAt desc로 넘긴 주문 배열.
 */
export function groupGuestOrders(orders: GuestRequestedOrder[]): GuestOrderGroup[] {
  const map = new Map<string, { group: GuestOrderGroup; firstIndex: number }>();

  orders.forEach((o, index) => {
    const key = o.catalogItemId ?? o.type;
    const existing = map.get(key);
    if (existing) {
      existing.group.orders.push(o);
      existing.group.totalQuantity += o.quantity;
    } else {
      map.set(key, {
        firstIndex: index,
        group: {
          key,
          name: o.name,
          totalQuantity: o.quantity,
          serviceDate: null, // 아래에서 확정
          orders: [o],
        },
      });
    }
  });

  const entries = [...map.values()];

  // 그룹별 대표 이용일: 모든 주문이 같은(비어있지 않은) 날짜면 그 날짜, 아니면 null.
  for (const e of entries) {
    const dates = e.group.orders.map((o) => o.serviceDate);
    const first = dates[0] ?? null;
    e.group.serviceDate =
      first != null && dates.every((d) => d === first) ? first : null;
  }

  // 정렬 키(이용일 오름차순): 그룹 내 최소 serviceDate. null(미지정)은 맨 뒤로.
  const minDate = (g: GuestOrderGroup): string | null => {
    let m: string | null = null;
    for (const o of g.orders) {
      if (o.serviceDate == null) continue;
      if (m == null || o.serviceDate < m) m = o.serviceDate;
    }
    return m;
  };

  return entries
    .sort((a, b) => {
      const da = minDate(a.group);
      const db = minDate(b.group);
      if (da !== db) {
        if (da == null) return 1; // 날짜 없는 그룹은 뒤로
        if (db == null) return -1;
        return da < db ? -1 : 1; // 이용일 오름차순
      }
      return a.firstIndex - b.firstIndex; // 동률 → 최신 생성 우선(입력 desc)
    })
    .map((e) => e.group);
}
