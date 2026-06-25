// [SHARED-MODULE] Zalo OA 발송 패턴 (Nike 프로젝트 계보)
import { describe, expect, it } from "vitest";
import { NotificationType } from "@prisma/client";
import {
  ERROR_NO_ZALO_LINK,
  ERROR_TOKEN_NOT_SET,
  MAX_SEND_ATTEMPTS,
  buildNotificationText,
  buildStatementAttachment,
  extractAttachmentUrls,
  getAttemptCount,
  isRetryableFailure,
  withAttempt,
} from "./zalo";
import { buildSendPayload, type BotAttachment } from "./zalo-runtime";

// ===================== buildNotificationText — 9종 vi 템플릿 =====================

const BASE_PAYLOAD = {
  bookingId: "bk1",
  villaId: "v1",
  villaName: "쏘나씨 V12",
  checkIn: "2026-07-01",
  checkOut: "2026-07-04",
  guestCount: 4,
};

describe("buildNotificationText", () => {
  it("BOOKING_HOLD — 빌라명·날짜(DD/MM/YYYY)·인원·홀드 만료(VN 시각) 포함", () => {
    const text = buildNotificationText(NotificationType.BOOKING_HOLD, {
      ...BASE_PAYLOAD,
      holdExpiresAt: "2026-07-01T03:00:00.000Z", // VN(UTC+7) = 10:00 01/07/2026
    });
    expect(text).toContain("Giữ chỗ mới");
    expect(text).toContain("쏘나씨 V12");
    expect(text).toContain("01/07/2026");
    expect(text).toContain("04/07/2026");
    expect(text).toContain("Số khách: 4");
    expect(text).toContain("10:00 01/07/2026");
  });

  it("BOOKING_CONFIRMED — 용어 사전 '확정=Đã đặt' 사용", () => {
    const text = buildNotificationText(NotificationType.BOOKING_CONFIRMED, BASE_PAYLOAD);
    expect(text).toContain("Đã đặt");
    expect(text).toContain("쏘나씨 V12");
    expect(text).toContain("01/07/2026");
  });

  it("HOLD_EXPIRED — 만료 안내 + 공실(Trống) 복귀", () => {
    const text = buildNotificationText(NotificationType.HOLD_EXPIRED, BASE_PAYLOAD);
    expect(text).toContain("hết hạn");
    expect(text).toContain("Trống");
    expect(text).toContain("쏘나씨 V12");
  });

  it("BOOKING_CANCELLED — 취소 안내 + 공실 복귀", () => {
    const text = buildNotificationText(NotificationType.BOOKING_CANCELLED, BASE_PAYLOAD);
    expect(text).toContain("hủy");
    expect(text).toContain("Trống");
  });

  it("CLEANING_REQUEST — 청소=Dọn dẹp(vệ sinh 금지), 기한·사진 업로드 안내", () => {
    const text = buildNotificationText(NotificationType.CLEANING_REQUEST, {
      cleaningTaskId: "ct1",
      villaId: "v1",
      villaName: "썬셋 사나토 A3",
      dueDate: "2026-07-04",
    });
    expect(text.toLowerCase()).toContain("dọn dẹp");
    expect(text.toLowerCase()).not.toContain("vệ sinh");
    expect(text).toContain("썬셋 사나토 A3");
    expect(text).toContain("Hạn: 04/07/2026");
    expect(text).toContain("tải ảnh");
  });

  it("CLEANING_REQUEST(정기) — dueDate 없이 periodic 문구", () => {
    const text = buildNotificationText(NotificationType.CLEANING_REQUEST, {
      cleaningTaskId: "ct2",
      villaName: "쏘나씨 V12",
      periodic: true,
    });
    expect(text).toContain("định kỳ");
    expect(text).not.toContain("Hạn:");
  });

  it("CLEANING_APPROVED — 승인=duyệt", () => {
    const text = buildNotificationText(NotificationType.CLEANING_APPROVED, {
      villaName: "쏘나씨 V12",
    });
    expect(text).toContain("duyệt");
    expect(text).toContain("쏘나씨 V12");
  });

  it("CLEANING_REJECTED — 반려=từ chối, 반려 사유 포함", () => {
    const text = buildNotificationText(NotificationType.CLEANING_REJECTED, {
      villaName: "쏘나씨 V12",
      rejectNote: "Phòng tắm chưa sạch",
    });
    expect(text).toContain("từ chối");
    expect(text).toContain("Phòng tắm chưa sạch");
  });

  it("TAMTRU_PASSPORT — 여권·임시거주신고(tạm trú)·고객명", () => {
    const text = buildNotificationText(NotificationType.TAMTRU_PASSPORT, {
      villaName: "쏘나씨 V12",
      guestName: "KIM MINSU",
      checkIn: "2026-07-01",
    });
    expect(text).toContain("Hộ chiếu");
    expect(text).toContain("tạm trú");
    expect(text).toContain("KIM MINSU");
    expect(text).toContain("01/07/2026");
  });

  it("SETTLEMENT_READY — 월·VND 점 구분 표기 (자기 정산액만)", () => {
    const text = buildNotificationText(NotificationType.SETTLEMENT_READY, {
      yearMonth: "2026-07",
      totalVnd: "15000000", // Json 직렬화로 BigInt는 문자열/숫자로 들어옴
    });
    expect(text).toContain("2026-07");
    expect(text).toContain("15.000.000₫");
  });

  it("SETTLEMENT_READY — 금액 누락 시 금액 줄 생략 (undefined 노출 금지)", () => {
    const text = buildNotificationText(NotificationType.SETTLEMENT_READY, {
      yearMonth: "2026-07",
    });
    expect(text).not.toContain("Tổng:");
    expect(text).not.toContain("undefined");
  });

  it("ROSTER_REMINDER — 운영자 대상 한국어, 빌라·게스트 표시 (가격 없음)", () => {
    const text = buildNotificationText(NotificationType.ROSTER_REMINDER, {
      villaName: "쏘나씨 V11",
      checkIn: "2026-07-10",
      guestName: "김학태",
      guestCount: 4,
    });
    expect(text).toContain("쏘나씨 V11");
    expect(text).toContain("김학태");
    expect(text).toContain("투숙객 명단");
  });

  it("마진 비공개 — payload에 판매가·마진이 섞여 들어와도 본문에 절대 미노출", () => {
    const polluted = {
      ...BASE_PAYLOAD,
      totalSaleKrw: 1500000,
      salePriceKrw: 500000,
      marginValue: 30,
      supplierCostVnd: "8000000",
    };
    for (const type of Object.values(NotificationType)) {
      const text = buildNotificationText(type, polluted);
      expect(text).not.toContain("1500000");
      expect(text).not.toContain("500000");
      expect(text).not.toContain("KRW");
      expect(text).not.toContain("₩");
      expect(text).not.toContain("8000000");
      expect(text).not.toContain("8.000.000");
    }
  });

  it("필드 누락 안전 — 빈 payload여도 undefined/null/NaN 미노출, 9종 모두 비어있지 않음", () => {
    for (const type of Object.values(NotificationType)) {
      for (const payload of [{}, null, undefined]) {
        const text = buildNotificationText(type, payload as Record<string, unknown> | null);
        expect(text.length).toBeGreaterThan(0);
        expect(text).not.toContain("undefined");
        expect(text).not.toContain("null");
        expect(text).not.toContain("NaN");
      }
    }
  });

  it("호칭 규칙 — anh/chị 하드코딩 금지 (단어 경계 검사 — i18n 교훈)", () => {
    for (const type of Object.values(NotificationType)) {
      const text = buildNotificationText(type, BASE_PAYLOAD);
      expect(text).not.toMatch(/\banh\b/i);
      expect(text).not.toMatch(/\bchị\b/i);
    }
  });
});

// ===================== 재시도 판정 — payload._attempt =====================

describe("extractAttachmentUrls (T3.6 — 전달 증빙)", () => {
  it("passportPhotoUrls 문자열 배열만 추출", () => {
    expect(
      extractAttachmentUrls({ passportPhotoUrls: ["/api/passports/a.jpg", "/api/passports/b.jpg"] })
    ).toEqual(["/api/passports/a.jpg", "/api/passports/b.jpg"]);
  });

  it("오염·누락 값은 빈 배열 (다른 알림 8종 영향 없음)", () => {
    expect(extractAttachmentUrls({})).toEqual([]);
    expect(extractAttachmentUrls(null)).toEqual([]);
    expect(extractAttachmentUrls({ villaName: "쏘나씨 V12" })).toEqual([]);
    expect(extractAttachmentUrls({ passportPhotoUrls: "not-array" })).toEqual([]);
    expect(extractAttachmentUrls({ passportPhotoUrls: ["/a.jpg", 123, null] })).toEqual(["/a.jpg"]);
  });
});

describe("getAttemptCount", () => {
  it("정상 _attempt 추출", () => {
    expect(getAttemptCount({ _attempt: 2 })).toBe(2);
  });

  it("누락·오염 값은 0 폴백", () => {
    expect(getAttemptCount({})).toBe(0);
    expect(getAttemptCount(null)).toBe(0);
    expect(getAttemptCount(undefined)).toBe(0);
    expect(getAttemptCount({ _attempt: "3" })).toBe(0);
    expect(getAttemptCount({ _attempt: -1 })).toBe(0);
    expect(getAttemptCount({ _attempt: 1.5 })).toBe(0);
    expect(getAttemptCount([1, 2])).toBe(0);
  });
});

describe("withAttempt", () => {
  it("기존 payload 보존 + _attempt 갱신 (스키마 변경 없이 Json 안에 기록)", () => {
    const next = withAttempt({ villaName: "쏘나씨 V12", _attempt: 1 }, 2) as Record<
      string,
      unknown
    >;
    expect(next.villaName).toBe("쏘나씨 V12");
    expect(next._attempt).toBe(2);
  });

  it("비객체 payload도 안전 처리", () => {
    expect((withAttempt(null, 1) as Record<string, unknown>)._attempt).toBe(1);
  });
});

describe("isRetryableFailure", () => {
  it("NO_ZALO_LINK — 영구 실패, attempt 무관 재시도 제외", () => {
    expect(isRetryableFailure(ERROR_NO_ZALO_LINK, 0)).toBe(false);
    expect(isRetryableFailure(ERROR_NO_ZALO_LINK, 2)).toBe(false);
  });

  it("ZALO_TOKEN_NOT_SET — 항상 재시도 대상 (토큰 입력 후 자동 회복)", () => {
    expect(isRetryableFailure(ERROR_TOKEN_NOT_SET, 0)).toBe(true);
    expect(isRetryableFailure(ERROR_TOKEN_NOT_SET, MAX_SEND_ATTEMPTS + 5)).toBe(true);
  });

  it("일반 실패(타임아웃·API 오류) — 3회 미만만 재시도", () => {
    expect(isRetryableFailure("TIMEOUT", 0)).toBe(true);
    expect(isRetryableFailure("ZALO_-213: user not follow", 2)).toBe(true);
    expect(isRetryableFailure("TIMEOUT", MAX_SEND_ATTEMPTS)).toBe(false);
    expect(isRetryableFailure("HTTP_500", MAX_SEND_ATTEMPTS + 1)).toBe(false);
  });

  it("error null(이전 기록 없음) — attempt 기준만 적용", () => {
    expect(isRetryableFailure(null, 0)).toBe(true);
    expect(isRetryableFailure(undefined, MAX_SEND_ATTEMPTS)).toBe(false);
  });
});

// ===================== 정산서 파일 첨부 (Zalo) =====================

describe("buildSendPayload — 발송 payload 구성", () => {
  const att: BotAttachment = { data: Buffer.from("PDF"), filename: "quyet-toan-2026-07.pdf", totalSize: 3 };

  it("멘션·첨부 없으면 plain string(기존 동작 불변)", () => {
    expect(buildSendPayload("xin chào")).toBe("xin chào");
    expect(buildSendPayload("a", [], [])).toBe("a");
  });

  it("첨부 있으면 MessageContent로 zca-js 형태 매핑(metadata.totalSize)", () => {
    const p = buildSendPayload("Bảng thanh toán", undefined, [att]);
    expect(typeof p).toBe("object");
    if (typeof p === "object") {
      expect(p.msg).toBe("Bảng thanh toán");
      expect(p.attachments).toEqual([
        { data: att.data, filename: "quyet-toan-2026-07.pdf", metadata: { totalSize: 3 } },
      ]);
      expect(p.mentions).toBeUndefined();
    }
  });

  it("멘션만 있으면 mentions 포함(첨부 없음)", () => {
    const p = buildSendPayload("@all", [{ pos: 0, uid: "-1", len: 4 }]);
    if (typeof p === "object") {
      expect(p.mentions).toHaveLength(1);
      expect(p.attachments).toBeUndefined();
    }
  });
});

describe("buildStatementAttachment — 정산서 첨부", () => {
  it("파일명 quyet-toan-{YYYY-MM}.pdf + totalSize=버퍼 길이", () => {
    const buf = Buffer.from("%PDF-1.7 ...");
    const a = buildStatementAttachment(buf, "2026-07");
    expect(a.filename).toBe("quyet-toan-2026-07.pdf");
    expect(a.totalSize).toBe(buf.length);
    expect(a.data).toBe(buf);
  });

  it("yearMonth 비정상 문자 제거, 비면 statement 폴백", () => {
    expect(buildStatementAttachment(Buffer.from("x"), "2026/07!!").filename).toBe(
      "quyet-toan-202607.pdf"
    );
    expect(buildStatementAttachment(Buffer.from("x"), "").filename).toBe(
      "quyet-toan-statement.pdf"
    );
  });
});
