// 마케팅 콘텐츠 하드 삭제 판정 — 운영자 지시(2026-07-23): PUBLISHING·PUBLISHED는 삭제 금지.
import { describe, it, expect } from "vitest";
import { IgPostStatus, YtShortStatus } from "@prisma/client";
import {
  BULK_DELETE_MAX,
  canDeleteMarketingStatus,
  partitionDeletable,
  UNDELETABLE_MARKETING_STATUSES,
} from "@/lib/marketing/deletable";

describe("canDeleteMarketingStatus — 삭제 차단 상태", () => {
  it("업로드 진행 중(PUBLISHING)은 삭제할 수 없다 (중복발행 방지 락 보호)", () => {
    expect(canDeleteMarketingStatus("PUBLISHING")).toBe(false);
  });

  it("발행 완료(PUBLISHED)는 삭제할 수 없다 (플랫폼에 살아있는 콘텐츠의 유일한 기록)", () => {
    expect(canDeleteMarketingStatus("PUBLISHED")).toBe(false);
  });

  it("승인 대기·초안·승인됨·실패·반려는 삭제할 수 있다", () => {
    for (const s of ["DRAFT", "PENDING_APPROVAL", "QUEUED", "FAILED", "CANCELLED"]) {
      expect(canDeleteMarketingStatus(s)).toBe(true);
    }
  });

  it("인스타·유튜브 두 enum의 모든 값이 판정 대상에 빠짐없이 들어간다", () => {
    // enum 값이 추가되면 여기서 드러난다(기본은 삭제 가능 — 보호가 필요하면 목록에 명시).
    const all = [...Object.values(IgPostStatus), ...Object.values(YtShortStatus)];
    const blocked = all.filter((s) => !canDeleteMarketingStatus(s));
    expect([...new Set(blocked)].sort()).toEqual([...UNDELETABLE_MARKETING_STATUSES].sort());
  });
});

describe("partitionDeletable — 요청 묶음 분리", () => {
  it("삭제 가능분만 남기고 차단분은 따로 돌려준다(부분 성공)", () => {
    const rows = [
      { id: "a", status: "PENDING_APPROVAL" },
      { id: "b", status: "PUBLISHED" },
      { id: "c", status: "CANCELLED" },
      { id: "d", status: "PUBLISHING" },
    ];
    const { deletable, blocked } = partitionDeletable(rows);
    expect(deletable.map((r) => r.id)).toEqual(["a", "c"]);
    expect(blocked.map((r) => r.id)).toEqual(["b", "d"]);
  });

  it("전부 차단이면 삭제 대상이 비어 있다 (삭제 0건으로 끝나야 함)", () => {
    const { deletable, blocked } = partitionDeletable([
      { id: "a", status: "PUBLISHED" },
      { id: "b", status: "PUBLISHING" },
    ]);
    expect(deletable).toHaveLength(0);
    expect(blocked).toHaveLength(2);
  });

  it("빈 입력은 빈 결과", () => {
    expect(partitionDeletable([])).toEqual({ deletable: [], blocked: [] });
  });
});

describe("BULK_DELETE_MAX", () => {
  it("한 번에 삭제 가능한 건수 상한이 있다(오폭·타임아웃 방지)", () => {
    expect(BULK_DELETE_MAX).toBeGreaterThan(0);
    expect(BULK_DELETE_MAX).toBeLessThanOrEqual(100);
  });
});
