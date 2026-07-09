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

describe("buildNotificationText — VENDOR_PROPOSAL_RESULT (제안 결과, ko/vi)", () => {
  const base = {
    itemName: "마사지",
    villaName: "쏘나씨 V11",
    serviceDate: "2026-07-10",
    serviceTime: "14:00",
  };
  it("적용(vi 기본) — 확정 일정 표기", () => {
    const text = buildNotificationText(NotificationType.VENDOR_PROPOSAL_RESULT, {
      ...base,
      applied: true,
      locale: "vi",
    });
    expect(text).toContain("Đề xuất giờ đã được chấp nhận");
    expect(text).toContain("10/07/2026 14:00");
  });
  it("적용(ko 수신자)", () => {
    const text = buildNotificationText(NotificationType.VENDOR_PROPOSAL_RESULT, {
      ...base,
      applied: true,
      locale: "ko",
    });
    expect(text).toContain("시간 제안이 수락되었습니다");
  });
  it("무시 — 기존 일정 유지 안내", () => {
    const text = buildNotificationText(NotificationType.VENDOR_PROPOSAL_RESULT, {
      ...base,
      applied: false,
      locale: "vi",
    });
    expect(text).toContain("không được áp dụng");
    expect(text).toContain("Giữ lịch ban đầu");
  });
  it("누수 가드 — 판매가·마진 없음", () => {
    const text = buildNotificationText(NotificationType.VENDOR_PROPOSAL_RESULT, {
      ...base,
      applied: true,
      locale: "ko",
    });
    expect(text).not.toMatch(/priceKrw|priceVnd|margin|마진|판매가/i);
  });
});

// ===================== 알림 보강 (T-zalo-notify-enrichment) =====================

describe("buildNotificationText — 보강 필드", () => {
  it("BOOKING_HOLD — 예약번호(#뒤6자리 대문자)·예약자명 표기, 구 payload는 줄 생략", () => {
    const text = buildNotificationText(NotificationType.BOOKING_HOLD, {
      ...BASE_PAYLOAD,
      bookingId: "clx123abc456",
      guestName: "김학태",
      holdExpiresAt: "2026-07-01T03:00:00.000Z",
    });
    expect(text).toContain("Mã đặt phòng: #ABC456");
    expect(text).toContain("Tên khách: 김학태");
    // 구 payload(추가 필드 없음) — 예약번호는 bookingId(bk1<6자)로 생략, 예약자 줄 없음
    const legacy = buildNotificationText(NotificationType.BOOKING_HOLD, {
      ...BASE_PAYLOAD,
      bookingId: "bk1",
      holdExpiresAt: "2026-07-01T03:00:00.000Z",
    });
    expect(legacy).not.toContain("Mã đặt phòng");
    expect(legacy).not.toContain("Tên khách");
  });

  it("BOOKING_CONFIRMED — 조식 true일 때만 표기", () => {
    const withBreakfast = buildNotificationText(NotificationType.BOOKING_CONFIRMED, {
      ...BASE_PAYLOAD,
      breakfastIncluded: true,
    });
    expect(withBreakfast).toContain("Bao gồm bữa sáng");
    const without = buildNotificationText(NotificationType.BOOKING_CONFIRMED, {
      ...BASE_PAYLOAD,
      breakfastIncluded: false,
    });
    expect(without).not.toContain("bữa sáng");
  });

  it("BOOKING_MODIFIED — 날짜 변경 시 전→후 비교, 인원 변경 시 (trước:) 병기", () => {
    const text = buildNotificationText(NotificationType.BOOKING_MODIFIED, {
      ...BASE_PAYLOAD,
      prevCheckIn: "2026-06-28",
      prevCheckOut: "2026-07-02",
      prevGuestCount: 2,
    });
    expect(text).toContain("Lịch cũ: 28/06/2026 → 02/07/2026");
    expect(text).toContain("Lịch mới: 01/07/2026 → 04/07/2026");
    expect(text).toContain("Số khách: 4 (trước: 2)");
    // 날짜 동일하면 비교 줄 없이 기존 형식
    const same = buildNotificationText(NotificationType.BOOKING_MODIFIED, {
      ...BASE_PAYLOAD,
      prevCheckIn: BASE_PAYLOAD.checkIn,
      prevCheckOut: BASE_PAYLOAD.checkOut,
      prevGuestCount: 4,
    });
    expect(same).not.toContain("Lịch cũ");
    expect(same).toContain("Nhận phòng: 01/07/2026");
  });

  it("CLEANING_REQUEST — 다음 체크인 있으면 긴급도 안내 줄 추가", () => {
    const text = buildNotificationText(NotificationType.CLEANING_REQUEST, {
      villaName: "쏘나씨 V12",
      dueDate: "2026-07-04",
      nextCheckIn: "2026-07-05",
    });
    expect(text).toContain("Khách tiếp theo nhận phòng: 05/07/2026");
    const none = buildNotificationText(NotificationType.CLEANING_REQUEST, {
      villaName: "쏘나씨 V12",
      dueDate: "2026-07-04",
      nextCheckIn: null,
    });
    expect(none).not.toContain("Khách tiếp theo");
  });

  it("ROSTER_REMINDER — 판매 채널(파트너명·연락처) 표기, 직접판매는 줄 생략", () => {
    const text = buildNotificationText(NotificationType.ROSTER_REMINDER, {
      ...BASE_PAYLOAD,
      guestName: "하나투어 김대리",
      partnerName: "하나투어",
      partnerPhone: "0212345678",
    });
    expect(text).toContain("판매 채널: 하나투어 (0212345678)");
    const direct = buildNotificationText(NotificationType.ROSTER_REMINDER, {
      ...BASE_PAYLOAD,
      guestName: "김학태",
      partnerName: null,
    });
    expect(direct).not.toContain("판매 채널");
  });

  it("SUPPLIER_DIRECT_BOOKING — 공급자명·예약자·예약번호 표기 (금액 없음)", () => {
    const text = buildNotificationText(NotificationType.SUPPLIER_DIRECT_BOOKING, {
      ...BASE_PAYLOAD,
      bookingId: "clxdirect9999xy",
      supplierName: "Tyy",
      guestName: "Nguyễn Văn A",
    });
    expect(text).toContain("공급자: Tyy");
    expect(text).toContain("예약자: Nguyễn Văn A · 예약번호 #9999XY");
    expect(text).not.toMatch(/salePrice|₫|KRW|마진/);
  });

  it("RATE_CHANGED_DURING_PROPOSAL — 한국어 전환 + 전→후 원가·영향 제안 수", () => {
    const text = buildNotificationText(NotificationType.RATE_CHANGED_DURING_PROPOSAL, {
      villaName: "쏘나씨 V12",
      season: "HIGH",
      oldCostVnd: "5000000",
      newCostVnd: "6500000",
      proposalCount: 2,
    });
    expect(text).toContain("견적 진행 중 원가 변경: 쏘나씨 V12");
    expect(text).toContain("성수기: 5.000.000₫ → 6.500.000₫");
    expect(text).toContain("유효한 제안 2건에 영향");
    // 기간 삭제(newCost null)
    const removed = buildNotificationText(NotificationType.RATE_CHANGED_DURING_PROPOSAL, {
      villaName: "V",
      season: "PEAK",
      oldCostVnd: "7000000",
      newCostVnd: null,
    });
    expect(removed).toContain("극성수기: 7.000.000₫ (기간 삭제됨)");
  });

  it("VILLA_PENDING_REVIEW — 규모 요약(단지·침실·사진 수), 구 payload는 생략", () => {
    const text = buildNotificationText(NotificationType.VILLA_PENDING_REVIEW, {
      villaName: "썬셋 A3",
      supplierName: "Tyy",
      resubmitted: false,
      complex: "썬셋 단지",
      bedrooms: 3,
      bathrooms: 2,
      maxGuests: 6,
      photoCount: 14,
    });
    expect(text).toContain("단지 썬셋 단지 · 침실 3 · 욕실 2 · 최대 6인 · 사진 14장");
    const legacy = buildNotificationText(NotificationType.VILLA_PENDING_REVIEW, {
      villaName: "썬셋 A3",
      supplierName: "Tyy",
      resubmitted: false,
    });
    expect(legacy).not.toContain("침실");
  });

  it("VENDOR_PO — 옵션 라벨·이행 시각·정산액(자기 원가) 표기, 판매가 없음", () => {
    const text = buildNotificationText(NotificationType.VENDOR_PO, {
      villaName: "쏘나씨 V12",
      itemName: "Body massage 60p",
      quantity: 2,
      serviceDate: "2026-07-02",
      serviceTime: "14:00",
      optionLabels: ["Dầu dừa", "Tại villa"],
      costVnd: "500000",
      guestNote: "2 người",
    });
    expect(text).toContain("Tùy chọn: Dầu dừa · Tại villa");
    expect(text).toContain("Ngày: 02/07/2026 14:00");
    expect(text).toContain("Thanh toán cho bạn: 500.000₫");
    expect(text).not.toMatch(/priceKrw|salePrice|margin/i);
    // costVnd null(미확정 0)이면 금액 줄 생략
    const noCost = buildNotificationText(NotificationType.VENDOR_PO, {
      villaName: "V",
      itemName: "I",
      quantity: 1,
      costVnd: null,
    });
    expect(noCost).not.toContain("Thanh toán cho bạn");
  });

  it("VENDOR_PO_RESPONSE — 수락/거절/완료에 발주 요약(일정·수량·발주액) 병기", () => {
    const base = {
      vendorName: "에이스마사지",
      itemName: "Body massage 60p",
      villaName: "쏘나씨 V12",
      serviceDate: "2026-07-02",
      serviceTime: "14:00",
      quantity: 2,
      costVnd: "500000",
    };
    const accepted = buildNotificationText(NotificationType.VENDOR_PO_RESPONSE, {
      ...base,
      accepted: true,
      action: "accept",
    });
    expect(accepted).toContain("일정: 02/07/2026 14:00 · 수량 x2 · 발주액 500.000₫");
    const complete = buildNotificationText(NotificationType.VENDOR_PO_RESPONSE, {
      ...base,
      action: "complete",
    });
    expect(complete).toContain("공급자 서비스 완료");
    expect(complete).toContain("발주액 500.000₫");
    // 구 payload(요약 필드 없음) — 한 줄 형식 유지
    const legacy = buildNotificationText(NotificationType.VENDOR_PO_RESPONSE, {
      vendorName: "V",
      itemName: "I",
      villaName: "W",
      accepted: true,
      action: "accept",
    });
    expect(legacy).toBe("✅ 공급자 수락: V — I (W)");
  });
});
