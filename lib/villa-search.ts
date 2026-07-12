// 빌라 검색 필터 공용 lib — /villas 운영자 목록의 searchParams 파싱 + Prisma where 구성 로직을
// 단일 소스로 추출한다(동작 불변). 예약 생성 폼용 GET /api/villas/bookable 도 이 파서를 재사용해
// "빌라관리 검색 필터 == 예약 검색 필터" 정합을 보장한다(T-admin-manual-booking 후속 확장).
//
// ⚠ 이 lib은 상태(status)·페이지네이션·날짜별 공실(freeIds) 결합을 다루지 않는다 —
//   그 3자 결합은 호출부(page.tsx / route.ts)가 담당한다(검색 조건과 상태 필터의 분리 유지).
import type { BedType, Prisma } from "@prisma/client";
import { BED_TYPES } from "@/lib/bedding";
import { FEATURE_ITEMS } from "@/lib/features";
import { parseUtcDateOnly } from "@/lib/date-vn";

/** 사전 화이트리스트 — URL로 들어온 임의 태그 키 주입 차단 (셀링포인트 featureKey만 허용) */
const VALID_FEATURE_KEYS = new Set(
  Object.values(FEATURE_ITEMS).flat().map((f) => f.featureKey)
);

/** 양수 정수만 통과(그 외 undefined) — minBedrooms·minGuests·beach 파싱 */
function toPosInt(v?: string): number | undefined {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * 빌라 검색 필터 — searchParams 파싱 결과.
 * 텍스트/스칼라 조건은 buildVillaSearchWhere가 where로 변환하고,
 * 날짜(checkIn/checkOut·dateRangeValid)는 호출부가 findFreeVillaIds로 별도 결합한다.
 */
export interface VillaSearchFilters {
  /** 텍스트 검색 — 빌라명·베트남명·단지·주소·공급자명 부분일치(대소문자 무시) */
  q?: string;
  /** 지역 = 단지명(complex) 정확 일치 */
  area?: string;
  /** 공급자 id 정확 일치 */
  supplierId?: string;
  minBedrooms?: number;
  minGuests?: number;
  pool: boolean;
  breakfast: boolean;
  /** "판매가능만" — isSellable=true. freeIds requireSellable 토글로도 쓰인다. */
  sellable: boolean;
  smoking: boolean;
  pets: boolean;
  party: boolean;
  extraBed: boolean;
  bedType?: BedType;
  /** 해변거리 상한(m). null(미입력) 빌라는 lte가 자동 제외 */
  beach?: number;
  /** 셀링포인트 태그 featureKey 목록(화이트리스트 통과분만) */
  tags: string[];
  /** 체크인일(@db.Date, UTC 자정) — 무효 형식이면 null */
  checkIn: Date | null;
  /** 체크아웃일(@db.Date, UTC 자정) — 무효 형식이면 null */
  checkOut: Date | null;
  /** checkIn·checkOut 둘 다 유효하고 checkIn<checkOut 일 때만 true (한쪽만·역전이면 false) */
  dateRangeValid: boolean;
}

/**
 * searchParams(Record<string, string|undefined>) → VillaSearchFilters.
 * /villas page.tsx 인라인 파싱과 바이트 동일 규칙:
 *   - boolean 토글은 값 "1" 일 때만 true
 *   - 정수 필터(minBedrooms·minGuests·beach)는 양수 정수만, 그 외 무시
 *   - tags 는 쉼표분리 후 화이트리스트 통과 키만
 *   - bedType 은 BED_TYPES 목록에 있을 때만
 *   - 날짜는 YYYY-MM-DD(parseUtcDateOnly), 무효는 null
 * 잘못된 파라미터는 조용히 무시(400 남발 금지) — 기존 /villas 관례.
 */
export function parseVillaSearchFilters(
  params: Record<string, string | undefined>
): VillaSearchFilters {
  const q = params.q?.trim() || undefined;
  const area = params.area?.trim() || undefined;
  const supplierId = params.supplier?.trim() || undefined;
  const bedType =
    params.bedType && (BED_TYPES as readonly string[]).includes(params.bedType)
      ? (params.bedType as BedType)
      : undefined;
  const tags =
    params.tags
      ?.split(",")
      .map((s) => s.trim())
      .filter((k) => VALID_FEATURE_KEYS.has(k)) ?? [];
  const checkIn = params.ci ? parseUtcDateOnly(params.ci) : null;
  const checkOut = params.co ? parseUtcDateOnly(params.co) : null;
  const dateRangeValid = !!(checkIn && checkOut && checkIn.getTime() < checkOut.getTime());

  return {
    q,
    area,
    supplierId,
    minBedrooms: toPosInt(params.minBedrooms),
    minGuests: toPosInt(params.minGuests),
    pool: params.pool === "1",
    breakfast: params.breakfast === "1",
    sellable: params.sellable === "1",
    smoking: params.smoking === "1",
    pets: params.pets === "1",
    party: params.party === "1",
    extraBed: params.extraBed === "1",
    bedType,
    beach: toPosInt(params.beach),
    tags,
    checkIn,
    checkOut,
    dateRangeValid,
  };
}

/**
 * VillaSearchFilters → Prisma.VillaWhereInput (검색 조건만 — 상태·날짜공실 제외).
 * /villas page.tsx 의 searchWhere 와 조건 형태 동일:
 *   공급자(정확 id) + 지역(complex) + 상세 스칼라 필터 + 셀링포인트 태그(AND, 모두 보유) + 텍스트 OR.
 * 날짜별 공실(freeIds)·상태 탭(status)은 이 where 에 접어 넣지 않는다(호출부 담당).
 */
export function buildVillaSearchWhere(filters: VillaSearchFilters): Prisma.VillaWhereInput {
  return {
    ...(filters.supplierId ? { supplierId: filters.supplierId } : {}),
    ...(filters.area ? { complex: filters.area } : {}),
    ...(filters.minBedrooms ? { bedrooms: { gte: filters.minBedrooms } } : {}),
    ...(filters.minGuests ? { maxGuests: { gte: filters.minGuests } } : {}),
    ...(filters.pool ? { hasPool: true } : {}),
    ...(filters.breakfast ? { breakfastAvailable: true } : {}),
    // "판매가능만" — 날짜 무관하게도 판매가능(검수 게이트 통과) 빌라만. isSellable=true는 ACTIVE에서만 참.
    ...(filters.sellable ? { isSellable: true } : {}),
    // 이용규칙 4종 — 수영장/조식과 동일 패턴(true만 필터)
    ...(filters.smoking ? { smokingAllowed: true } : {}),
    ...(filters.pets ? { petsAllowed: true } : {}),
    ...(filters.party ? { partyAllowed: true } : {}),
    ...(filters.extraBed ? { extraBedAvailable: true } : {}),
    ...(filters.bedType ? { bedroomDetails: { some: { bedType: filters.bedType } } } : {}),
    ...(filters.beach ? { beachDistanceM: { lte: filters.beach } } : {}),
    // 셀링포인트 태그 — 각각 features some (다중 AND, 모두 보유한 빌라만)
    ...(filters.tags.length
      ? { AND: filters.tags.map((k) => ({ features: { some: { featureKey: k } } })) }
      : {}),
    ...(filters.q
      ? {
          OR: [
            { name: { contains: filters.q, mode: "insensitive" as const } },
            { nameVi: { contains: filters.q, mode: "insensitive" as const } },
            { complex: { contains: filters.q, mode: "insensitive" as const } },
            { address: { contains: filters.q, mode: "insensitive" as const } },
            { supplier: { is: { name: { contains: filters.q, mode: "insensitive" as const } } } },
          ],
        }
      : {}),
  };
}

/** 검색 조건이 하나라도 활성인가 — 빈 결과 문구 분기용(날짜 유효 범위 포함) */
export function hasAnyVillaSearchFilter(filters: VillaSearchFilters): boolean {
  return Boolean(
    filters.area ||
      filters.q ||
      filters.supplierId ||
      filters.minBedrooms ||
      filters.minGuests ||
      filters.pool ||
      filters.breakfast ||
      filters.sellable ||
      filters.smoking ||
      filters.pets ||
      filters.party ||
      filters.extraBed ||
      filters.bedType ||
      filters.beach ||
      filters.tags.length ||
      filters.dateRangeValid
  );
}
