// lib/ticket-order-validation.ts — TICKET 이용자 선택 스냅샷 검증 공유 로직 (ADR-0036)
//   게스트(/api/g/[token]/service-orders)·운영자(/api/bookings/[id]/service-orders) 두 생성 경로가 공유한다.
//   ★ 동작 정본: 명단 대조·수량·중복·규칙 재검증 순서를 여기 한 곳에서만 정의한다(회귀 금지 — 오류 코드·순서 불변).
//   ★ 누수 경계: 스냅샷 허용 필드는 name·birthDate·heightCm 3개뿐(ticket-guests 매퍼와 동일). 여권번호 등 유입 차단.
//   ★ prisma 미의존(순수) — 체크인 확정본 조회는 호출측이 loadConfirmedGuests 콜백으로 주입(늦은 평가로
//     "명단 미제공 시 체크인 조회조차 안 함" 기존 동작을 보존한다).

import { ruleHasAny, validateGuestForVariant, type VariantRule } from "@/lib/ticket-variant-rules";
import { ticketGuestKey, type TicketGuest } from "@/lib/ticket-guests";

/** 요청 본문에서 온 이용자 스냅샷 1건(정규화 전). heightCm은 자가신고(선택). */
export interface TicketGuestSubmission {
  name: string | null;
  birthDate: string | null;
  heightCm?: number | null;
}

export type TicketGuestValidationError =
  | "TICKET_GUESTS_REQUIRED"
  | "TICKET_GUEST_COUNT_MISMATCH"
  | "TICKET_GUEST_DUPLICATE"
  | "TICKET_GUEST_MISMATCH"
  | "TICKET_GUEST_RULE_MISMATCH";

export type TicketGuestValidationResult =
  | { ok: true; snapshot: TicketGuest[] | null }
  | { ok: false; error: TicketGuestValidationError };

export interface ValidateTicketGuestsArgs {
  /** 품목 type — "TICKET"이 아니면 스냅샷 대상 아님(무시). */
  itemType: string;
  /** 제출 variantKey의 정규화 규칙(TICKET + variantKey일 때만 non-null). 규칙 없으면 검증·명단 강제 없음. */
  variantRule: VariantRule | null;
  /** 요청 본문 ticketGuests(없거나 빈 배열이면 스냅샷 없음). */
  ticketGuests: TicketGuestSubmission[] | undefined | null;
  /** 발권 수량(서버 재계산 pricing.quantity) — 선택 인원 수와 정합해야 함. */
  quantity: number;
  /** 이용일 "YYYY-MM-DD"(만나이 판정 기준). 미상이면 빈 문자열 허용(만나이 규칙은 관용 통과). */
  serviceDateOnly: string;
  /** 체크인 확정본 명단 지연 로더 — 스냅샷 대조 단계에서만 호출(prisma 주입). */
  loadConfirmedGuests: () => Promise<TicketGuest[]>;
}

/**
 * TICKET 이용자 스냅샷 검증(게스트·운영자 공용). 순서·오류 코드는 기존 게스트 라우트와 동일:
 *   1) 규칙 variant인데 명단 생략 → TICKET_GUESTS_REQUIRED (가격 조작 우회 차단)
 *   2) 비TICKET·명단 미제공 → 스냅샷 없음(ok, snapshot=null) — loadConfirmedGuests 미호출
 *   3) 인원 수 ≠ quantity → TICKET_GUEST_COUNT_MISMATCH
 *   4) 주문 내 (name+birthDate) 중복 → TICKET_GUEST_DUPLICATE
 *   5) 체크인 확정본에 없는 인원 → TICKET_GUEST_MISMATCH (PII 주입 방지)
 *   6) 규칙 variant 위반 → TICKET_GUEST_RULE_MISMATCH (출생년도·만나이·신장)
 *   통과 시 정규화 스냅샷(name·birthDate·heightCm?) 반환.
 */
export async function validateTicketGuests(
  args: ValidateTicketGuestsArgs
): Promise<TicketGuestValidationResult> {
  const { itemType, variantRule, ticketGuests, quantity, serviceDateOnly, loadConfirmedGuests } = args;
  const ruleActive = variantRule != null && ruleHasAny(variantRule);

  // 1) 규칙 있는 variant(child/free/senior 등)는 이용자 명단이 필수 — 명단 없이 규칙 단가로 POST 차단.
  if (ruleActive && (!ticketGuests || ticketGuests.length === 0)) {
    return { ok: false, error: "TICKET_GUESTS_REQUIRED" };
  }

  // 2) TICKET 품목 + 명단 제공(비어있지 않음)일 때만 스냅샷 검증·저장. 그 외는 스냅샷 없음(관용).
  if (itemType !== "TICKET" || !ticketGuests || ticketGuests.length === 0) {
    return { ok: true, snapshot: null };
  }

  // 3) 수량 일치 — 선택 인원 수 = 발권 수량(variant별 분리 주문이라 그룹 인원수와 정합).
  if (ticketGuests.length !== quantity) {
    return { ok: false, error: "TICKET_GUEST_COUNT_MISMATCH" };
  }

  // 정규화 — 허용 필드 name·birthDate·heightCm만(신장은 있을 때만 부착).
  const clean: TicketGuest[] = ticketGuests.map((g) => ({
    name: g.name ?? null,
    birthDate: g.birthDate ?? null,
    ...(typeof g.heightCm === "number" ? { heightCm: g.heightCm } : {}),
  }));

  // 4) 주문 내 중복 인원 방지 — 같은 name+birthDate 쌍이 2회 이상이면 거부.
  const dupKeys = clean.map(ticketGuestKey);
  if (new Set(dupKeys).size !== dupKeys.length) {
    return { ok: false, error: "TICKET_GUEST_DUPLICATE" };
  }

  // 5) PII 주입 방지 — 각 원소가 체크인 확정본 명단에 정확히 존재(name+birthDate 쌍).
  const confirmed = await loadConfirmedGuests();
  const confirmedKeys = new Set(confirmed.map(ticketGuestKey));
  if (!clean.every((g) => confirmedKeys.has(ticketGuestKey(g)))) {
    return { ok: false, error: "TICKET_GUEST_MISMATCH" };
  }

  // 6) 구분(variant) 규칙 재검증(가격 조작 방지) — 출생년도·만나이는 birthDate null이면 통과(자가신고 폴백),
  //    신장 규칙이면 heightCm 필수+상한 미만. 규칙 없는 기본(성인) variant는 검증 없음.
  if (ruleActive && variantRule) {
    const bad = clean.some(
      (g) =>
        !validateGuestForVariant(variantRule, {
          birthDate: g.birthDate,
          heightCm: typeof g.heightCm === "number" ? g.heightCm : null,
          serviceDate: serviceDateOnly,
        })
    );
    if (bad) return { ok: false, error: "TICKET_GUEST_RULE_MISMATCH" };
  }

  return { ok: true, snapshot: clean };
}
