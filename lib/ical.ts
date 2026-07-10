import {
  BlockSource,
  BookingStatus,
  VillaStatus,
  type PrismaClient,
} from "@prisma/client";
import { OCCUPYING_BOOKING_STATUSES, overlapsHalfOpen } from "@/lib/availability";
import { writeAuditLog } from "@/lib/audit-log";
import { safeFetch } from "@/lib/ssrf-guard";
import { parseUtcDateOnly, todayVnDateString } from "@/lib/date-vn";

/**
 * iCal 수신 동기화 단일 소스 (SPEC F2, 계약: docs/contracts/T1.6-ical-sync.md)
 *
 * Villa.icalImportUrls(외부 채널 export URL)를 30분 cron으로 fetch하여
 * VEVENT를 CalendarBlock(source=ICAL, icalUid)으로 멱등 upsert하고,
 * 피드에서 사라진 UID 블록을 삭제한다. 내부 점유 예약과 겹치면 충돌로 보고한다.
 *
 * 재고 보수 원칙:
 * - 1개 URL이라도 fetch·파싱 실패 시 해당 빌라의 삭제는 전부 스킵 (upsert만 수행)
 *   — 일시 장애로 재고가 열려 더블부킹 되는 사고 차단
 * - 삭제는 해당 빌라의 source=ICAL 블록만, MANUAL 블록 절대 불변
 * - 내부 예약과 충돌해도 블록은 생성(점유 우선) + 충돌 목록 보고, 해소는 ADMIN 수동
 *
 * 날짜 규약: @db.Date·half-open [startDate, endDate). 날짜는 이벤트 타임존 기준
 * 로컬 캘린더 날짜를 UTC 자정 Date로 저장한다 (T1.3 QA 권고 — UTC 자정 정규화).
 */

/** 빌라 소재 타임존 — Z(UTC 순간) 값의 로컬 캘린더 날짜 환산 기준 */
const VILLA_TIMEZONE = "Asia/Ho_Chi_Minh";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_ICS_BYTES = 5 * 1024 * 1024; // 5MB — SSRF·메모리 보호 (QA 조건 4)

// ===================== 순수 함수 층 (단위 테스트 대상) =====================

export interface IcalEvent {
  uid: string;
  /** UTC 자정 (포함) */
  startDate: Date;
  /** UTC 자정 (제외 — half-open) */
  endDate: Date;
  summary?: string;
}

export interface IcalParseResult {
  events: IcalEvent[];
  warnings: string[];
}

/** RFC 5545 라인 언폴딩 — 공백/탭으로 시작하는 줄은 직전 줄의 연속 */
export function unfoldIcsLines(ics: string): string[] {
  const out: string[] = [];
  for (const line of ics.split(/\r?\n/)) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else if (line.length > 0) {
      out.push(line);
    }
  }
  return out;
}

interface IcsProperty {
  name: string;
  params: Record<string, string>;
  value: string;
}

function parseProperty(line: string): IcsProperty | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1).trim();
  const segments = left.split(";");
  const name = segments[0].trim().toUpperCase();
  const params: Record<string, string> = {};
  for (const seg of segments.slice(1)) {
    const eq = seg.indexOf("=");
    if (eq > 0) {
      params[seg.slice(0, eq).trim().toUpperCase()] = seg
        .slice(eq + 1)
        .trim()
        .replace(/^"|"$/g, "");
    }
  }
  return { name, params, value };
}

/** UTC 순간을 지정 타임존의 벽시계 구성요소로 변환 (의존성 없음 — Intl) */
function instantToZonedParts(instant: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(instant)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return {
    y: Number(map.year),
    m: Number(map.month),
    d: Number(map.day),
    h: Number(map.hour),
    min: Number(map.minute),
    s: Number(map.second),
  };
}

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * DTSTART/DTEND 값 → UTC 자정 Date (계약 "날짜 결정 기준"):
 * - VALUE=DATE·yyyymmdd → 그 날짜 그대로
 * - TZID·floating DATE-TIME → 값의 날짜부 = 로컬 캘린더 날짜 (벽시계 직취)
 * - Z(UTC 순간) → Asia/Ho_Chi_Minh 로컬 날짜로 환산
 * - kind=end 이고 로컬 시간 성분이 자정이 아니면 +1일 올림 (재고 보수 — 언더블록 방지)
 * 해석 불가 시 null 반환 (호출측이 스킵+경고).
 */
export function parseIcsDate(
  prop: IcsProperty,
  kind: "start" | "end"
): Date | null {
  const v = prop.value;
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (prop.params.VALUE === "DATE" || dateOnly) {
    const m = dateOnly ?? /^(\d{4})(\d{2})(\d{2})/.exec(v);
    if (!m) return null;
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  }

  const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (!dt) return null;
  const [, y, mo, d, h, min, s, zulu] = dt;

  let local = {
    y: Number(y),
    m: Number(mo),
    d: Number(d),
    h: Number(h),
    min: Number(min),
    s: Number(s),
  };

  if (zulu === "Z") {
    const instant = new Date(
      Date.UTC(local.y, local.m - 1, local.d, local.h, local.min, local.s)
    );
    local = instantToZonedParts(instant, VILLA_TIMEZONE);
  } else if (prop.params.TZID && !isValidTimeZone(prop.params.TZID)) {
    // 미지원 TZID는 해석 불가 — 호출측에서 이벤트 스킵+경고
    return null;
  }
  // TZID·floating: 벽시계 날짜부가 곧 로컬 캘린더 날짜 — 변환 불필요

  const hasTime = local.h !== 0 || local.min !== 0 || local.s !== 0;
  const ceil = kind === "end" && hasTime ? 1 : 0;
  return new Date(Date.UTC(local.y, local.m - 1, local.d + ceil));
}

/**
 * ICS 텍스트 → 이벤트 목록. 프로젝트 필요 범위(UID/DTSTART/DTEND/STATUS/SUMMARY)만
 * 해석한다 (계약 합의 편차 — 전체 RFC 5545 미지원은 결함 아님).
 */
export function parseIcs(icsText: string): IcalParseResult {
  const warnings: string[] = [];
  const byUid = new Map<string, IcalEvent>();

  let inEvent = false;
  let props: IcsProperty[] = [];

  const flushEvent = () => {
    const get = (name: string) => props.find((p) => p.name === name);
    const uid = get("UID")?.value;
    const status = get("STATUS")?.value?.toUpperCase();
    const dtstart = get("DTSTART");
    const dtend = get("DTEND");
    const duration = get("DURATION");
    const summary = get("SUMMARY")?.value;

    if (status === "CANCELLED") return; // 취소 이벤트 제외 (계약)
    if (!uid) {
      warnings.push("UID 누락 이벤트 스킵");
      return;
    }
    if (!dtstart) {
      warnings.push(`DTSTART 누락 이벤트 스킵: ${uid}`);
      return;
    }
    const startDate = parseIcsDate(dtstart, "start");
    if (!startDate) {
      warnings.push(`DTSTART 해석 불가 이벤트 스킵: ${uid} (${dtstart.value})`);
      return;
    }

    let endDate: Date | null;
    if (dtend) {
      endDate = parseIcsDate(dtend, "end");
      if (!endDate) {
        warnings.push(`DTEND 해석 불가 이벤트 스킵: ${uid} (${dtend.value})`);
        return;
      }
    } else if (duration) {
      warnings.push(`DURATION 미지원 이벤트 스킵: ${uid}`);
      return;
    } else {
      // RFC 5545: 종일 이벤트 DTEND 누락 시 1일
      endDate = new Date(startDate.getTime() + 24 * 60 * 60 * 1000);
    }

    if (endDate.getTime() <= startDate.getTime()) {
      warnings.push(`endDate ≤ startDate 이상 이벤트 스킵: ${uid}`);
      return;
    }
    if (byUid.has(uid)) {
      warnings.push(`피드 내 UID 중복(마지막 채택): ${uid}`);
    }
    byUid.set(uid, { uid, startDate, endDate, summary });
  };

  for (const line of unfoldIcsLines(icsText)) {
    const prop = parseProperty(line);
    if (!prop) continue;
    if (prop.name === "BEGIN" && prop.value.toUpperCase() === "VEVENT") {
      inEvent = true;
      props = [];
    } else if (prop.name === "END" && prop.value.toUpperCase() === "VEVENT") {
      if (inEvent) flushEvent();
      inEvent = false;
      props = [];
    } else if (inEvent) {
      if (prop.name === "RRULE") {
        warnings.push("RRULE(반복 일정) 미지원 — 단일 발생만 반영");
      }
      props.push(prop);
    }
  }

  return { events: [...byUid.values()], warnings };
}

export interface ExistingIcalBlock {
  id: string;
  icalUid: string | null;
  startDate: Date;
  endDate: Date;
}

export interface IcalDiff {
  toCreate: IcalEvent[];
  toUpdate: { blockId: string; event: IcalEvent }[];
  /** 피드에서 사라진 UID (icalUid=null 고아 ICAL 블록 포함) */
  toDelete: ExistingIcalBlock[];
}

/** UID 기준 생성/날짜변경/소멸 분류 — 멱등 동기화의 단일 판정 */
export function diffIcalEvents(
  existing: ExistingIcalBlock[],
  events: IcalEvent[]
): IcalDiff {
  const existingByUid = new Map<string, ExistingIcalBlock>();
  const toDelete: ExistingIcalBlock[] = [];
  for (const block of existing) {
    if (block.icalUid === null) {
      toDelete.push(block); // source=ICAL인데 uid 없음 — 관리 불가 고아, 정리 대상
    } else {
      existingByUid.set(block.icalUid, block);
    }
  }

  const toCreate: IcalEvent[] = [];
  const toUpdate: { blockId: string; event: IcalEvent }[] = [];
  for (const event of events) {
    const block = existingByUid.get(event.uid);
    if (!block) {
      toCreate.push(event);
    } else {
      existingByUid.delete(event.uid);
      if (
        block.startDate.getTime() !== event.startDate.getTime() ||
        block.endDate.getTime() !== event.endDate.getTime()
      ) {
        toUpdate.push({ blockId: block.id, event });
      }
    }
  }
  toDelete.push(...existingByUid.values());

  return { toCreate, toUpdate, toDelete };
}

export interface OccupyingBookingRange {
  id: string;
  status: BookingStatus;
  checkIn: Date;
  checkOut: Date;
}

export interface IcalConflict {
  uid: string;
  startDate: Date;
  endDate: Date;
  bookingId: string;
  bookingStatus: BookingStatus;
  checkIn: Date;
  checkOut: Date;
}

/** iCal 이벤트 × 점유 예약(HOLD/CONFIRMED/CHECKED_IN) half-open 겹침 — 더블부킹 경보 소스 */
export function findEventBookingConflicts(
  events: IcalEvent[],
  bookings: OccupyingBookingRange[]
): IcalConflict[] {
  const conflicts: IcalConflict[] = [];
  for (const event of events) {
    for (const booking of bookings) {
      if (
        overlapsHalfOpen(
          event.startDate,
          event.endDate,
          booking.checkIn,
          booking.checkOut
        )
      ) {
        conflicts.push({
          uid: event.uid,
          startDate: event.startDate,
          endDate: event.endDate,
          bookingId: booking.id,
          bookingStatus: booking.status,
          checkIn: booking.checkIn,
          checkOut: booking.checkOut,
        });
      }
    }
  }
  return conflicts;
}

// ===================== DB 래퍼 층 =====================

export type FetchLike = typeof fetch;

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * iCal 텍스트 가져오기 — SSRF 가드(safeFetch) 경유 (보안 P0-8).
 * 프로토콜 http/https 한정 + 내부 IP·DNS 리바인딩 차단 + 리다이렉트 수동 추적(매 홉 재검증)
 * + 타임아웃 + 본문 상한. 위반 시 throw → 해당 URL 실패 처리(삭제는 스킵, QA 조건).
 */
async function fetchIcsText(url: string, fetchFn: FetchLike): Promise<string> {
  // 주입 fetch(테스트)는 실네트워크를 안 타므로 도메인 DNS resolve를 생략한다.
  // 프로덕션은 전역 fetch라 SSRF 가드(내부IP·리바인딩) 완전 적용. IP리터럴/프로토콜 검사는 항상 유지.
  const skipDnsCheck = fetchFn !== globalThis.fetch;
  const res = await safeFetch(url, { fetchFn, timeoutMs: FETCH_TIMEOUT_MS, skipDnsCheck });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_ICS_BYTES) {
    throw new Error(`응답 크기 초과 (${MAX_ICS_BYTES} bytes)`);
  }
  return text;
}

export interface VillaForIcalSync {
  id: string;
  name: string;
  icalImportUrls: string[];
}

export interface VillaIcalSyncResult {
  villaId: string;
  villaName: string;
  created: number;
  updated: number;
  deleted: number;
  /** URL 일부 실패로 삭제를 스킵했는가 (재고 보수 — QA 합의 조건 1) */
  deletionSkipped: boolean;
  conflicts: IcalConflict[];
  warnings: string[];
  errors: string[];
}

/**
 * 단일 빌라 iCal 동기화.
 * 모든 URL fetch+파싱 성공 시에만 전체 피드 UID 합집합 기준으로 소멸 블록을 삭제한다.
 * @param fetchFn 테스트 주입용 — 기본 global fetch
 */
export async function syncVillaIcal(
  db: PrismaClient,
  villa: VillaForIcalSync,
  fetchFn: FetchLike = fetch
): Promise<VillaIcalSyncResult> {
  const warnings: string[] = [];
  const errors: string[] = [];
  const mergedByUid = new Map<string, IcalEvent>();
  let allUrlsSucceeded = true;

  for (const url of villa.icalImportUrls) {
    try {
      const text = await fetchIcsText(url, fetchFn);
      const { events, warnings: parseWarnings } = parseIcs(text);
      warnings.push(...parseWarnings.map((w) => `${url}: ${w}`));
      for (const event of events) {
        if (mergedByUid.has(event.uid)) {
          warnings.push(`피드 간 UID 중복(마지막 채택): ${event.uid}`);
        }
        mergedByUid.set(event.uid, event);
      }
    } catch (e) {
      allUrlsSucceeded = false;
      errors.push(`${url}: ${errorMessage(e)}`);
    }
  }

  const events = [...mergedByUid.values()];

  const existing = await db.calendarBlock.findMany({
    where: { villaId: villa.id, source: BlockSource.ICAL },
    select: { id: true, icalUid: true, startDate: true, endDate: true },
  });

  const diff = diffIcalEvents(existing, events);
  const toDelete = allUrlsSucceeded ? diff.toDelete : [];

  // 충돌 감지 — 현재 피드의 전체 이벤트 vs 점유 예약 (신규 여부 무관, 미해결 충돌 의미)
  let conflicts: IcalConflict[] = [];
  if (events.length > 0) {
    const minStart = new Date(
      Math.min(...events.map((e) => e.startDate.getTime()))
    );
    const maxEnd = new Date(Math.max(...events.map((e) => e.endDate.getTime())));
    const occupying = await db.booking.findMany({
      where: {
        villaId: villa.id,
        status: { in: [...OCCUPYING_BOOKING_STATUSES] },
        checkIn: { lt: maxEnd },
        checkOut: { gt: minStart },
      },
      select: { id: true, status: true, checkIn: true, checkOut: true },
    });
    conflicts = findEventBookingConflicts(events, occupying);
  }

  // 변경 적용 — 트랜잭션 (충돌이어도 블록은 생성: 점유 우선·보수적)
  const created = await db.$transaction(async (tx) => {
    const createdBlocks: { id: string; event: IcalEvent }[] = [];
    for (const event of diff.toCreate) {
      const block = await tx.calendarBlock.create({
        data: {
          villaId: villa.id,
          startDate: event.startDate,
          endDate: event.endDate,
          source: BlockSource.ICAL,
          icalUid: event.uid,
          note: event.summary ?? null,
        },
        select: { id: true },
      });
      createdBlocks.push({ id: block.id, event });
    }
    for (const { blockId, event } of diff.toUpdate) {
      await tx.calendarBlock.update({
        where: { id: blockId },
        data: {
          startDate: event.startDate,
          endDate: event.endDate,
          note: event.summary ?? null,
        },
      });
    }
    if (toDelete.length > 0) {
      await tx.calendarBlock.deleteMany({
        where: {
          id: { in: toDelete.map((b) => b.id) },
          source: BlockSource.ICAL, // MANUAL 불변 — 심층 방어
        },
      });
    }
    return createdBlocks;
  });

  // 감사 로그 — 커밋 성공 후 기록 (롤백 시 유령 로그 방지). userId=null=시스템(cron)
  for (const { id, event } of created) {
    await writeAuditLog({
      userId: null,
      action: "CREATE",
      entity: "CalendarBlock",
      entityId: id,
      changes: {
        source: { new: "ICAL" },
        icalUid: { new: event.uid },
        startDate: { new: event.startDate.toISOString() },
        endDate: { new: event.endDate.toISOString() },
      },
    });
  }
  for (const { blockId, event } of diff.toUpdate) {
    const before = existing.find((b) => b.id === blockId);
    await writeAuditLog({
      userId: null,
      action: "UPDATE",
      entity: "CalendarBlock",
      entityId: blockId,
      changes: {
        startDate: {
          old: before?.startDate.toISOString(),
          new: event.startDate.toISOString(),
        },
        endDate: {
          old: before?.endDate.toISOString(),
          new: event.endDate.toISOString(),
        },
      },
    });
  }
  for (const block of toDelete) {
    await writeAuditLog({
      userId: null,
      action: "DELETE",
      entity: "CalendarBlock",
      entityId: block.id,
      changes: { icalUid: { old: block.icalUid } },
    });
  }

  return {
    villaId: villa.id,
    villaName: villa.name,
    created: created.length,
    updated: diff.toUpdate.length,
    deleted: toDelete.length,
    deletionSkipped: !allUrlsSucceeded,
    conflicts,
    warnings,
    errors,
  };
}

export interface IcalSyncSummary {
  villaCount: number;
  created: number;
  updated: number;
  deleted: number;
  conflictCount: number;
  errorCount: number;
  results: VillaIcalSyncResult[];
}

/**
 * 전체 동기화 — status=ACTIVE이고 icalImportUrls가 있는 빌라 순회.
 * 빌라 단위 실패 격리: 한 빌라의 예외가 전체 cron을 중단시키지 않는다.
 */
export async function runIcalSync(
  db: PrismaClient,
  fetchFn: FetchLike = fetch
): Promise<IcalSyncSummary> {
  const villas = await db.villa.findMany({
    where: { status: VillaStatus.ACTIVE, icalImportUrls: { isEmpty: false } },
    select: { id: true, name: true, icalImportUrls: true },
  });

  const results: VillaIcalSyncResult[] = [];
  for (const villa of villas) {
    try {
      results.push(await syncVillaIcal(db, villa, fetchFn));
    } catch (e) {
      results.push({
        villaId: villa.id,
        villaName: villa.name,
        created: 0,
        updated: 0,
        deleted: 0,
        deletionSkipped: true,
        conflicts: [],
        warnings: [],
        errors: [errorMessage(e)],
      });
    }
  }

  return {
    villaCount: villas.length,
    created: results.reduce((n, r) => n + r.created, 0),
    updated: results.reduce((n, r) => n + r.updated, 0),
    deleted: results.reduce((n, r) => n + r.deleted, 0),
    conflictCount: results.reduce((n, r) => n + r.conflicts.length, 0),
    errorCount: results.reduce((n, r) => n + r.errors.length, 0),
    results,
  };
}

export interface UnresolvedIcalConflict {
  villaId: string;
  villaName: string;
  blockId: string;
  icalUid: string | null;
  blockStart: Date;
  blockEnd: Date;
  bookingId: string;
  bookingStatus: BookingStatus;
  checkIn: Date;
  checkOut: Date;
}

/**
 * 미해결 iCal 더블부킹 충돌 조회 — F7 대시보드 경보 배너(T2.6)의 단일 소스.
 * **ADMIN 전용 소비 전제** — 전체 재고를 조망하므로 호출하는 route/화면이
 * 반드시 ADMIN role 검사를 먼저 수행할 것 (재고 비공개 원칙).
 * @param from 이 시점 이후로 끝나는 충돌만 (기본: 오늘 UTC 자정)
 */
export async function findUnresolvedIcalConflicts(
  db: PrismaClient,
  from?: Date
): Promise<UnresolvedIcalConflict[]> {
  const now = new Date();
  // 기본 하한은 VN 캘린더 오늘을 UTC 자정으로(@db.Date 비교 규약 일치) — UTC 일로 잡으면
  // 17:00~23:59 UTC에 충돌 알림 창이 하루 어긋난다(알림 배너 전용이라 영향은 경미).
  const since = from ?? parseUtcDateOnly(todayVnDateString(now))!;

  const blocks = await db.calendarBlock.findMany({
    where: { source: BlockSource.ICAL, endDate: { gt: since } },
    select: {
      id: true,
      villaId: true,
      icalUid: true,
      startDate: true,
      endDate: true,
      villa: { select: { name: true } },
    },
  });
  if (blocks.length === 0) return [];

  const villaIds = [...new Set(blocks.map((b) => b.villaId))];
  const bookings = await db.booking.findMany({
    where: {
      villaId: { in: villaIds },
      status: { in: [...OCCUPYING_BOOKING_STATUSES] },
      checkOut: { gt: since },
    },
    select: {
      id: true,
      villaId: true,
      status: true,
      checkIn: true,
      checkOut: true,
    },
  });

  const conflicts: UnresolvedIcalConflict[] = [];
  for (const block of blocks) {
    for (const booking of bookings) {
      if (
        booking.villaId === block.villaId &&
        overlapsHalfOpen(
          block.startDate,
          block.endDate,
          booking.checkIn,
          booking.checkOut
        )
      ) {
        conflicts.push({
          villaId: block.villaId,
          villaName: block.villa.name,
          blockId: block.id,
          icalUid: block.icalUid,
          blockStart: block.startDate,
          blockEnd: block.endDate,
          bookingId: booking.id,
          bookingStatus: booking.status,
          checkIn: booking.checkIn,
          checkOut: booking.checkOut,
        });
      }
    }
  }
  return conflicts;
}
