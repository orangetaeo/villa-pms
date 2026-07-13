// S3 수신 파싱 순수 함수 단위 테스트 (ADR-0006 S3) — DB·zca-js 의존 없음
// + saveInboundMessage/saveOutboundEcho 대화별 멱등(복합키) 스코프 테스트 (prisma 모킹)
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, ZaloTranslateMode } from "@prisma/client";

// DB·부수효과 모듈 차단 — 저장 함수의 멱등 스코프/레이스 처리만 검증 (호출 인자 검증)
const prismaMock = vi.hoisted(() => ({
  zaloConversation: { upsert: vi.fn(), update: vi.fn() },
  zaloMessage: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/gemini", () => ({
  translateText: vi.fn(),
  transcribeVoice: vi.fn(),
  translateImage: vi.fn(),
}));
vi.mock("@/lib/zalo-webhook", () => ({ pushInboundToNike: vi.fn() }));
vi.mock("@/lib/realtime-notify", () => ({ notifyRealtime: vi.fn(async () => {}) }));

import {
  extractText,
  extractDisplayText,
  UNKNOWN_MESSAGE_FALLBACK,
  isPhoneLike,
  extractPhone,
  isEchoMessage,
  isSelfMessage,
  parseZaloTs,
  buildInboundKey,
  classifyInbound,
  isCallSystemText,
  buildCallDetail,
  saveInboundMessage,
  saveOutboundEcho,
} from "./zalo-inbound";

describe("extractText — content 타입별 안전 파싱 (버그 B)", () => {
  it("문자열 content는 그대로", () => {
    expect(extractText("Xin chào")).toBe("Xin chào");
  });

  it("객체 content는 캡션 후보(msg/title/description)만 추출 — msg 우선", () => {
    expect(extractText({ msg: "M", title: "T" })).toBe("M");
    expect(extractText({ title: "T" })).toBe("T");
    expect(extractText({ description: "D" })).toBe("D");
    expect(extractText({ caption: "C" })).toBe("C");
    expect(extractText({ text: "X" })).toBe("X");
  });

  it("리치/버블 메시지의 action/메서드 필드는 본문으로 새지 않는다", () => {
    // 핵심 회귀: content.action="sendBubbleMessage" 가 본문으로 노출되던 버그
    expect(extractText({ action: "sendBubbleMessage" })).toBe("");
    expect(extractText({ action: "sendBubbleMessage", href: "https://x", thumb: "t" })).toBe("");
    expect(extractText({ type: "recommend", action: "recommened.link" })).toBe("");
  });

  it("리치 메시지라도 사람이 쓴 캡션이 있으면 그 캡션만 추출(action 무시)", () => {
    expect(extractText({ action: "sendBubbleMessage", title: "공지 제목" })).toBe("공지 제목");
  });

  it("JSON 문자열 content는 파싱해 캡션만 — 메서드명 새지 않음", () => {
    expect(extractText('{"action":"sendBubbleMessage","title":"안녕"}')).toBe("안녕");
    expect(extractText('{"action":"sendBubbleMessage"}')).toBe("");
    // JSON 아닌 일반 텍스트는 그대로(중괄호 시작 아님)
    expect(extractText("그냥 텍스트")).toBe("그냥 텍스트");
    // 깨진 JSON은 원문 텍스트로 취급
    expect(extractText("{not json")).toBe("{not json");
  });

  it("params 내부 캡션(이미지/파일)도 추출", () => {
    expect(extractText({ thumb: "t", params: '{"caption":"사진 설명"}' })).toBe("사진 설명");
    expect(extractText({ params: { msg: "객체 params" } })).toBe("객체 params");
  });

  it("빈 캡션·공백 캡션은 건너뛰어 빈 문자열", () => {
    expect(extractText({ title: "   " })).toBe("");
    expect(extractText({ msg: "" })).toBe("");
  });

  it("추출 불가(빈 객체·null·숫자)는 빈 문자열", () => {
    expect(extractText({})).toBe("");
    expect(extractText(null)).toBe("");
    expect(extractText(123)).toBe("");
  });
});

describe("extractDisplayText — 본문 없으면 중립 폴백(메서드명 노출 금지)", () => {
  it("실제 본문은 그대로", () => {
    expect(extractDisplayText("Xin chào")).toBe("Xin chào");
    expect(extractDisplayText({ title: "제목" })).toBe("제목");
  });

  it("첨부/리치(본문 없음)는 폴백 문구 — 'sendBubbleMessage' 등 절대 노출 안 함", () => {
    expect(extractDisplayText({ action: "sendBubbleMessage" })).toBe(UNKNOWN_MESSAGE_FALLBACK);
    expect(extractDisplayText({})).toBe(UNKNOWN_MESSAGE_FALLBACK);
    expect(extractDisplayText(null)).toBe(UNKNOWN_MESSAGE_FALLBACK);
    expect(extractDisplayText('{"action":"sendBubbleMessage"}')).toBe(UNKNOWN_MESSAGE_FALLBACK);
  });
});

describe("extractPhone / isPhoneLike — 전화번호 추출 (T3.7)", () => {
  it("베트남 로컬 번호 그대로", () => {
    expect(extractPhone("0901234567")).toBe("0901234567");
    expect(isPhoneLike("0901234567")).toBe(true);
  });

  it("하이픈·공백·점·괄호 정규화", () => {
    expect(extractPhone("090-123-4567")).toBe("0901234567");
    expect(extractPhone("090 123 4567")).toBe("0901234567");
    expect(extractPhone("(090) 123.4567")).toBe("0901234567");
  });

  it("+84 / 0084 / 84 국가코드 → 0 로컬 표기로 환원", () => {
    expect(extractPhone("+84901234567")).toBe("0901234567");
    expect(extractPhone("0084901234567")).toBe("0901234567");
    expect(extractPhone("84901234567")).toBe("0901234567");
  });

  it("번호 외 잡문이 섞이면 매칭 안 함(과매칭 방지)", () => {
    expect(extractPhone("제 번호는 0901234567 입니다")).toBeNull();
    expect(extractPhone("Xin chào")).toBeNull();
    expect(isPhoneLike("Xin chào")).toBe(false);
  });

  it("길이 범위 밖(너무 짧거나 긴)은 null", () => {
    expect(extractPhone("12345")).toBeNull();
    expect(extractPhone("1234567890123456")).toBeNull();
  });

  it("빈 값·비문자열 안전", () => {
    expect(extractPhone("")).toBeNull();
    expect(extractPhone("   ")).toBeNull();
    expect(extractPhone(undefined as unknown as string)).toBeNull();
  });
});

describe("isSelfMessage — 본인 발신 판정(OUTBOUND 분기)", () => {
  it("isSelf=true는 본인 발신", () => {
    expect(isSelfMessage({ isSelf: true, senderId: "x" }, "bot1")).toBe(true);
  });

  it("발신자 id가 봇 ownId와 일치하면 본인 발신", () => {
    expect(isSelfMessage({ isSelf: false, senderId: "bot1" }, "bot1")).toBe(true);
  });

  it("상대 발신(다른 id, isSelf 아님)은 본인 발신 아님(INBOUND)", () => {
    expect(isSelfMessage({ isSelf: false, senderId: "supplier1" }, "bot1")).toBe(false);
  });

  it("봇 ownId 미상(null)이면 senderId 비교 생략 — isSelf만 신뢰", () => {
    expect(isSelfMessage({ isSelf: false, senderId: "bot1" }, null)).toBe(false);
    expect(isSelfMessage({ isSelf: true, senderId: "bot1" }, null)).toBe(true);
  });

  it("isEchoMessage 별칭은 isSelfMessage와 동일", () => {
    expect(isEchoMessage).toBe(isSelfMessage);
    expect(isEchoMessage({ isSelf: true, senderId: "x" }, "bot1")).toBe(true);
  });
});

describe("parseZaloTs — zca-js 타임스탬프 → Date(정렬 보존)", () => {
  it("ms epoch 문자열을 Date로", () => {
    const d = parseZaloTs("1718506800000");
    expect(d).toBeInstanceOf(Date);
    expect(d!.getTime()).toBe(1718506800000);
  });

  it("ms epoch 숫자도 처리", () => {
    expect(parseZaloTs(1718506800000)!.getTime()).toBe(1718506800000);
  });

  it("없거나 비정상(빈문자열·0·음수·NaN)이면 null → 호출부에서 now", () => {
    expect(parseZaloTs("")).toBeNull();
    expect(parseZaloTs(undefined)).toBeNull();
    expect(parseZaloTs(0)).toBeNull();
    expect(parseZaloTs(-1)).toBeNull();
    expect(parseZaloTs("abc")).toBeNull();
  });
});

describe("classifyInbound — 수신 메시지 타입 분류 (Nike parseMessageContent 이식)", () => {
  it("문자열 → text, 본문 보존", () => {
    const r = classifyInbound("Xin chào", "webchat");
    expect(r.msgType).toBe("text");
    expect(r.text).toBe("Xin chào");
    expect(r.attachmentUrls).toEqual([]);
  });

  it("text 타입 미상(msgType 없음)도 문자열은 text", () => {
    expect(classifyInbound("hello", undefined).msgType).toBe("text");
  });

  it("chat.photo(이미지) → photo, url 추출 + 캡션은 text", () => {
    const r = classifyInbound(
      { href: "https://cdn/x.jpg", description: "수영장 사진", thumb: "https://cdn/t.jpg" },
      "chat.photo"
    );
    expect(r.msgType).toBe("photo");
    expect(r.text).toBe("수영장 사진");
    expect(r.attachmentUrls).toEqual(["https://cdn/x.jpg"]);
  });

  it("chat.photo지만 문서 확장자 → file, 파일명=text", () => {
    const r = classifyInbound(
      { href: "https://cdn/계약서.pdf", title: "계약서.pdf" },
      "chat.photo"
    );
    expect(r.msgType).toBe("file");
    expect(r.text).toBe("계약서.pdf");
    expect(r.attachmentUrls).toEqual(["https://cdn/계약서.pdf"]);
  });

  it("chat.file → file, 파일명 NFC 정규화", () => {
    const r = classifyInbound({ href: "https://cdn/doc.docx", title: "견적.docx" }, "chat.file");
    expect(r.msgType).toBe("file");
    expect(r.text).toBe("견적.docx");
    expect(r.attachmentUrls).toEqual(["https://cdn/doc.docx"]);
  });

  it("chat.sticker → sticker, webp url 우선 + text 빈 문자열", () => {
    const r = classifyInbound(
      { stickerWebpUrl: "https://cdn/s.webp", stickerUrl: "https://cdn/s.png" },
      "chat.sticker"
    );
    expect(r.msgType).toBe("sticker");
    expect(r.text).toBe("");
    expect(r.attachmentUrls).toEqual(["https://cdn/s.webp"]);
  });

  it("chat.voice → voice, voiceUrl + text 빈 문자열(FE 라벨)", () => {
    const r = classifyInbound({ voiceUrl: "https://cdn/v.m4a", duration: 3000 }, "chat.voice");
    expect(r.msgType).toBe("voice");
    expect(r.text).toBe("");
    expect(r.attachmentUrls).toEqual(["https://cdn/v.m4a"]);
  });

  it("chat.voice params 폴백(m4aUrl): top-level URL 없어도 params JSON에서 추출", () => {
    // 앱에서 전달·에코된 음성 — top-level URL 필드 부재, params 안에만 존재.
    const r = classifyInbound({ params: '{"m4aUrl":"https://cdn/v.m4a"}' }, "chat.voice");
    expect(r.msgType).toBe("voice");
    expect(r.attachmentUrls).toEqual(["https://cdn/v.m4a"]);
  });

  it("chat.voice params 폴백(href): params 내 href도 음성 URL로 추출", () => {
    const r = classifyInbound({ params: '{"href":"https://cdn/v.aac"}' }, "chat.voice");
    expect(r.msgType).toBe("voice");
    expect(r.attachmentUrls).toEqual(["https://cdn/v.aac"]);
  });

  it("chat.voice URL 전무: voice + 빈 첨부(기존 동작 회귀 없음)", () => {
    const r = classifyInbound({}, "chat.voice");
    expect(r.msgType).toBe("voice");
    expect(r.attachmentUrls).toEqual([]);
  });

  it("chat.voice params 비JSON 문자열: throw 없이 voice + 빈 첨부", () => {
    const r = classifyInbound({ params: "not-json" }, "chat.voice");
    expect(r.msgType).toBe("voice");
    expect(r.attachmentUrls).toEqual([]);
  });

  it("chat.recommend(네임카드) → contact, 이름=text(전화번호는 본문에 안 넣음)", () => {
    const r = classifyInbound(
      { name: "Nguyen Van A", phone: "0901234567", qrCodeUrl: "https://cdn/qr.png" },
      "chat.recommend"
    );
    expect(r.msgType).toBe("contact");
    expect(r.text).toBe("Nguyen Van A");
    expect(r.attachmentUrls).toEqual(["https://cdn/qr.png"]);
  });

  it("연락처 JSON 문자열도 contact로 파싱", () => {
    const r = classifyInbound(
      JSON.stringify({ name: "Tran B", phone: "0907654321" }),
      undefined
    );
    expect(r.msgType).toBe("contact");
    expect(r.text).toBe("Tran B");
  });

  it("통화(call) → call, content 없어도 타입만으로 판정", () => {
    expect(classifyInbound("", "chat.call.message").msgType).toBe("call");
    expect(classifyInbound(null, "voip").msgType).toBe("call");
  });

  // ── 통화 버블(zca-js 메서드 토큰 "sendBubbleMessage") — 실관측 오분류 회귀 ──
  it("메서드 토큰 버블(gUid 동반) → call, 토큰이 연락처명·본문으로 새지 않음", () => {
    // 과거: gUid로 contact 분기, title=토큰이 contact name으로 노출됨
    const r = classifyInbound({ title: "sendBubbleMessage", gUid: "g123" }, "chat.recommended");
    expect(r.msgType).toBe("call");
    expect(r.text).toBe("");
    expect(r.attachmentUrls).toEqual([]);
  });

  it("이름/제목 필드가 토큰인 버블 → call (캡션 없음)", () => {
    expect(classifyInbound({ title: "sendBubbleMessage" }, undefined).msgType).toBe("call");
    expect(classifyInbound({ name: "sendBubbleMessage" }, undefined).msgType).toBe("call");
  });

  it("action만 토큰인 일반 비즈니스 버블(이름·캡션 없음)은 call 아님 → 기존대로 unknown", () => {
    // action="sendBubbleMessage"는 캡션 있는 공유/공지 버블에도 붙음 → 통화로 오판하지 않는다.
    expect(classifyInbound({ action: "sendBubbleMessage" }, "chat.business").msgType).toBe(
      "unknown"
    );
  });

  it("캡션 있는 정상 버블(action=토큰 + 실제 title)은 call이 아니라 text 보존", () => {
    const r = classifyInbound({ action: "sendBubbleMessage", title: "공지 제목" }, undefined);
    expect(r.msgType).toBe("text");
    expect(r.text).toBe("공지 제목");
  });

  it("진짜 연락처(이름+전화)는 여전히 contact (토큰 아님)", () => {
    const r = classifyInbound({ name: "홍길동", phone: "0901234567" }, "chat.recommended");
    expect(r.msgType).toBe("contact");
    expect(r.text).toBe("홍길동");
  });

  // ── 통화 텍스트 휴리스틱 (zca-js는 통화를 본문 text="Cuộc gọi"로 보냄) ──
  it("통화 텍스트 'Cuộc gọi'(text 타입) → call, text·attachmentUrls 비움", () => {
    const r = classifyInbound("Cuộc gọi", "webchat");
    expect(r.msgType).toBe("call");
    expect(r.text).toBe("");
    expect(r.attachmentUrls).toEqual([]);
  });

  it("'Cuộc gọi nhỡ'(부재중) / 'Cuộc gọi thoại' / 'Cuộc gọi video' → call", () => {
    expect(classifyInbound("Cuộc gọi nhỡ", undefined).msgType).toBe("call");
    expect(classifyInbound("Cuộc gọi thoại", "webchat").msgType).toBe("call");
    expect(classifyInbound("Cuộc gọi video", "webchat").msgType).toBe("call");
  });

  it("앞뒤 공백이 있어도 trim 후 통화 패턴이면 call", () => {
    expect(classifyInbound("  Cuộc gọi  ", undefined).msgType).toBe("call");
  });

  it("문장 중간에 'Cuộc gọi'가 섞이면 통화로 오판하지 않음 → text(본문 보존)", () => {
    const r = classifyInbound("Cuộc gọi 잘 받았어요", "webchat");
    expect(r.msgType).toBe("text");
    expect(r.text).toBe("Cuộc gọi 잘 받았어요");
  });

  it("'Cuộc gọi' 단어가 본문 안쪽에 있는 일반 대화도 text", () => {
    const r = classifyInbound("Tôi sẽ Cuộc gọi cho bạn", undefined);
    expect(r.msgType).toBe("text");
    expect(r.text).toBe("Tôi sẽ Cuộc gọi cho bạn");
  });

  // ── zca-js 실제 타입 문자열 보정 (getClientMessageType 기준) ──
  it("chat.recommended(zca-js 실제 타입) → contact", () => {
    const r = classifyInbound(
      { name: "Le C", phone: "0903334444", qrCodeUrl: "https://cdn/qr2.png" },
      "chat.recommended"
    );
    expect(r.msgType).toBe("contact");
    expect(r.text).toBe("Le C");
    expect(r.attachmentUrls).toEqual(["https://cdn/qr2.png"]);
  });

  it("chat.gif → photo(이미지류), url 추출", () => {
    const r = classifyInbound({ href: "https://cdn/anim.gif" }, "chat.gif");
    expect(r.msgType).toBe("photo");
    expect(r.attachmentUrls).toEqual(["https://cdn/anim.gif"]);
  });

  it("chat.doodle(URL 있음) → photo / (URL 없음) → unknown", () => {
    const withUrl = classifyInbound({ href: "https://cdn/draw.png" }, "chat.doodle");
    expect(withUrl.msgType).toBe("photo");
    expect(withUrl.attachmentUrls).toEqual(["https://cdn/draw.png"]);
    const noUrl = classifyInbound({ params: "{}" }, "chat.doodle");
    expect(noUrl.msgType).toBe("unknown");
    expect(noUrl.attachmentUrls).toEqual([]);
  });

  it("chat.link(URL 보유) → link 카드, 제목=text·URL=attachmentUrls[0] (메타 필드 노출 금지)", () => {
    const r = classifyInbound(
      { title: "푸꾸옥 빌라", href: "https://example.com/v", action: "recommendLink" },
      "chat.link"
    );
    // 리치 링크 카드: 제목은 text(첫 줄), URL은 attachmentUrls[0](카드 클릭 시 열기).
    expect(r.msgType).toBe("link");
    expect(r.text).toContain("푸꾸옥 빌라");
    expect(r.attachmentUrls[0]).toBe("https://example.com/v");
    // 메타/메서드 필드(action)는 본문·URL 어디에도 새지 않는다(버그 B 원칙 유지).
    expect(r.text).not.toContain("recommendLink");
    expect(r.attachmentUrls.join(" ")).not.toContain("recommendLink");
  });

  it("chat.video.msg(zca-js 실제 타입) → video", () => {
    const r = classifyInbound({ href: "https://cdn/clip.mp4" }, "chat.video.msg");
    expect(r.msgType).toBe("video");
    expect(r.attachmentUrls).toEqual(["https://cdn/clip.mp4"]);
  });

  it("chat.location.new(zca-js 실제 타입) → location", () => {
    const r = classifyInbound({ address: "Phu Quoc", lat: 10.2, lon: 103.9 }, "chat.location.new");
    expect(r.msgType).toBe("location");
    expect(r.text).toBe("Phu Quoc");
  });

  it("chat.video → video, url 추출", () => {
    const r = classifyInbound({ href: "https://cdn/clip.mp4" }, "chat.video");
    expect(r.msgType).toBe("video");
    expect(r.attachmentUrls).toEqual(["https://cdn/clip.mp4"]);
  });

  it("위치(location) → location, 주소가 있으면 text", () => {
    const r = classifyInbound({ address: "Phu Quoc", lat: 10.2, lon: 103.9 }, "chat.location");
    expect(r.msgType).toBe("location");
    expect(r.text).toBe("Phu Quoc");
  });

  it("미상(본문·첨부 없는 리치/액션) → unknown, action 메서드명 절대 노출 안 함", () => {
    const r = classifyInbound({ action: "sendBubbleMessage" }, "chat.bubble");
    expect(r.msgType).toBe("unknown");
    expect(r.text).toBe("");
  });

  it("미상 객체라도 사람이 쓴 캡션이 있으면 text로 회수(action 무시)", () => {
    const r = classifyInbound({ action: "sendBubbleMessage", title: "공지" }, "chat.bubble");
    expect(r.msgType).toBe("text");
    expect(r.text).toBe("공지");
  });
});

describe("isCallSystemText — Zalo 통화 시스템 텍스트 판정(오판 최소화)", () => {
  it("베트남어 통화 텍스트는 시작 매칭으로 true", () => {
    expect(isCallSystemText("Cuộc gọi")).toBe(true);
    expect(isCallSystemText("Cuộc gọi nhỡ")).toBe(true);
    expect(isCallSystemText("Cuộc gọi thoại")).toBe(true);
    expect(isCallSystemText("Cuộc gọi video")).toBe(true);
    expect(isCallSystemText("cuộc gọi")).toBe(true); // 대소문자 무시
    expect(isCallSystemText("  Cuộc gọi  ")).toBe(true); // trim
  });

  it("문장 중간/안쪽에 'Cuộc gọi'가 섞이면 false(과매칭 방지)", () => {
    expect(isCallSystemText("Cuộc gọi 잘 받았어요")).toBe(false);
    expect(isCallSystemText("Tôi sẽ Cuộc gọi cho bạn")).toBe(false);
    expect(isCallSystemText("Cuộc gọihello")).toBe(false); // 단어 경계 없음
  });

  it("명백한 단독 다국어 라벨은 정확 매칭으로 true", () => {
    expect(isCallSystemText("통화")).toBe(true);
    expect(isCallSystemText("영상 통화")).toBe(true);
    expect(isCallSystemText("Missed call")).toBe(true);
    expect(isCallSystemText("call")).toBe(true);
  });

  it("일반 대화·빈 값·비문자열은 false", () => {
    expect(isCallSystemText("Xin chào")).toBe(false);
    expect(isCallSystemText("통화 잘 했어요")).toBe(false); // 정확 매칭이라 false
    expect(isCallSystemText("")).toBe(false);
    expect(isCallSystemText("   ")).toBe(false);
    expect(isCallSystemText(null)).toBe(false);
    expect(isCallSystemText(123)).toBe(false);
  });
});

describe("buildInboundKey — 멱등 키(zaloMsgId)", () => {
  it("문자열 msgId 그대로", () => {
    expect(buildInboundKey({ msgId: "abc123" })).toBe("abc123");
  });

  it("숫자 msgId는 문자열화", () => {
    expect(buildInboundKey({ msgId: 987654321 })).toBe("987654321");
  });

  it("없거나 빈 값은 null(멱등 불가)", () => {
    expect(buildInboundKey({})).toBeNull();
    expect(buildInboundKey({ msgId: "" })).toBeNull();
    expect(buildInboundKey({ msgId: undefined })).toBeNull();
  });
});

describe("buildCallDetail — 통화 params → 구조화 텍스트", () => {
  const call = (params: Record<string, unknown>) =>
    buildCallDetail({ title: "sendBubbleMessage", action: "sendBubbleMessage", params });

  it("발신 완료(reason 없음, duration>0) → CALL:out:done:N:audio", () => {
    expect(call({ duration: 3, isCaller: 1, calltype: 0 })).toBe("CALL:out:done:3:audio");
  });

  it("수신 완료(isCaller=0) → CALL:in:done:N:audio", () => {
    expect(call({ duration: 12, isCaller: 0, calltype: 0 })).toBe("CALL:in:done:12:audio");
  });

  it("취소/미응답(reason=4) → missed, duration 0", () => {
    expect(call({ duration: 0, reason: 4, isCaller: 1, calltype: 0 })).toBe(
      "CALL:out:missed:0:audio"
    );
  });

  it("거절(reason=3) — 수신/발신 모두 rejected", () => {
    expect(call({ duration: 0, reason: 3, isCaller: 0, calltype: 0 })).toBe(
      "CALL:in:rejected:0:audio"
    );
    expect(call({ duration: 0, reason: 3, isCaller: 1, calltype: 0 })).toBe(
      "CALL:out:rejected:0:audio"
    );
  });

  it("영상통화(calltype!=0) → video", () => {
    expect(call({ duration: 5, isCaller: 1, calltype: 1 })).toBe("CALL:out:done:5:video");
  });

  it("params를 JSON 문자열로 줘도 파싱", () => {
    expect(
      buildCallDetail({ params: JSON.stringify({ duration: 7, isCaller: 0, calltype: 0 }) })
    ).toBe("CALL:in:done:7:audio");
  });

  it("params 없거나 통화 신호(calltype/duration) 없으면 '' (일반 통화 폴백)", () => {
    expect(buildCallDetail({ title: "x" })).toBe("");
    expect(buildCallDetail("Cuộc gọi")).toBe("");
    expect(buildCallDetail(null)).toBe("");
  });

  it("classifyInbound 통화 버블 → text에 CALL 상세 포함", () => {
    const out = classifyInbound(
      { title: "sendBubbleMessage", params: { duration: 3, reason: 4, isCaller: 1, calltype: 0 } },
      "chat.recommended"
    );
    expect(out.msgType).toBe("call");
    expect(out.text).toBe("CALL:out:missed:0:audio");
  });
});

// ===================== 대화별 멱등(복합키) 저장 스코프 (2026-07-13) =====================
// 배경: zaloMsgId 전역 @unique 때문에 같은 그룹 메시지가 다계정(소유자) 대화에 각각 저장되지 못하고
//       첫 저장 외 유실됐다. 멱등을 (conversationId, zaloMsgId) 복합키로 전환 + create P2002 무해화.

/** upsert가 특정 conversationId를 반환하도록 세팅(대화 스코프 시뮬레이션). */
function mockConversation(id: string) {
  prismaMock.zaloConversation.upsert.mockResolvedValue({
    id,
    userId: null,
    displayName: null,
    translateMode: ZaloTranslateMode.OFF,
    groupMembers: null,
  });
}

/** 라이브 복합 UNIQUE 위반과 동형인 Prisma P2002 에러. */
function p2002() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });
}

const inbound = (over: Record<string, unknown> = {}) =>
  ({
    ownerAdminId: "admin-1",
    isSystemBot: false,
    senderZaloUserId: "grp-123",
    text: "hello",
    zaloMsgId: "grp-msg-1",
    displayName: null,
    senderPhone: null,
    threadType: "GROUP" as const,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

const outbound = (over: Record<string, unknown> = {}) =>
  ({
    ownerAdminId: "admin-1",
    senderZaloUserId: "grp-123",
    text: "reply",
    zaloMsgId: "grp-msg-1",
    createdAt: new Date("2026-07-13T10:00:00Z"),
    displayName: null,
    threadType: "GROUP" as const,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.zaloConversation.update.mockResolvedValue({});
  prismaMock.zaloMessage.update.mockResolvedValue({});
});

describe("saveInboundMessage — 대화별 멱등(복합키) 스코프", () => {
  it("멱등 조회를 (conversationId, zaloMsgId) 복합키로 호출한다", async () => {
    mockConversation("conv-A");
    prismaMock.zaloMessage.findUnique.mockResolvedValue(null);
    prismaMock.zaloMessage.create.mockResolvedValue({ id: "m-db-1" });

    const res = await saveInboundMessage(inbound({ zaloMsgId: "grp-msg-1" }));

    expect(res).toMatchObject({ saved: true, duplicated: false, messageId: "m-db-1" });
    expect(prismaMock.zaloMessage.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { conversationId_zaloMsgId: { conversationId: "conv-A", zaloMsgId: "grp-msg-1" } },
      })
    );
  });

  it("같은 zaloMsgId라도 conversationId가 다르면(타 소유자 대화) 저장이 스킵되지 않는다", async () => {
    // 타 소유자 대화(conv-OTHER)에는 이미 같은 zaloMsgId가 있지만, 내 대화(conv-A)에는 없음.
    prismaMock.zaloMessage.findUnique.mockImplementation(
      async ({ where }: { where: { conversationId_zaloMsgId: { conversationId: string } } }) =>
        where.conversationId_zaloMsgId.conversationId === "conv-OTHER" ? { id: "other-row" } : null
    );
    prismaMock.zaloMessage.create.mockResolvedValue({ id: "m-A" });
    mockConversation("conv-A");

    const res = await saveInboundMessage(inbound({ zaloMsgId: "grp-msg-1" }));

    expect(res).toMatchObject({ saved: true, duplicated: false, messageId: "m-A" });
    expect(prismaMock.zaloMessage.create).toHaveBeenCalledTimes(1);
  });

  it("같은 대화에 같은 zaloMsgId 재수신은 duplicated=true, create 미호출", async () => {
    mockConversation("conv-A");
    prismaMock.zaloMessage.findUnique.mockResolvedValue({ id: "existing" });

    const res = await saveInboundMessage(inbound());

    expect(res).toMatchObject({ saved: false, duplicated: true, messageId: null });
    expect(prismaMock.zaloMessage.create).not.toHaveBeenCalled();
  });

  it("create가 P2002(동일 대화 레이스)를 던지면 throw 없이 duplicated=true 반환", async () => {
    mockConversation("conv-A");
    prismaMock.zaloMessage.findUnique.mockResolvedValue(null);
    prismaMock.zaloMessage.create.mockRejectedValue(p2002());

    const res = await saveInboundMessage(inbound());

    expect(res).toMatchObject({ saved: false, duplicated: true, messageId: null });
  });

  it("create가 P2002 외 에러면 그대로 rethrow(무해화 금지)", async () => {
    mockConversation("conv-A");
    prismaMock.zaloMessage.findUnique.mockResolvedValue(null);
    prismaMock.zaloMessage.create.mockRejectedValue(new Error("db down"));

    await expect(saveInboundMessage(inbound())).rejects.toThrow("db down");
  });
});

describe("saveOutboundEcho — 대화별 멱등(복합키) 스코프", () => {
  it("멱등 조회를 (conversationId, zaloMsgId) 복합키로 호출한다", async () => {
    mockConversation("conv-A");
    prismaMock.zaloMessage.findUnique.mockResolvedValue(null);
    prismaMock.zaloMessage.create.mockResolvedValue({ id: "e-db-1" });

    const res = await saveOutboundEcho(outbound({ zaloMsgId: "grp-msg-1" }));

    expect(res).toMatchObject({ saved: true, duplicated: false, messageId: "e-db-1" });
    expect(prismaMock.zaloMessage.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { conversationId_zaloMsgId: { conversationId: "conv-A", zaloMsgId: "grp-msg-1" } },
      })
    );
  });

  it("같은 zaloMsgId라도 conversationId가 다르면 저장이 스킵되지 않는다", async () => {
    prismaMock.zaloMessage.findUnique.mockImplementation(
      async ({ where }: { where: { conversationId_zaloMsgId: { conversationId: string } } }) =>
        where.conversationId_zaloMsgId.conversationId === "conv-OTHER"
          ? { id: "other-row", globalMsgId: null, cliMsgId: null }
          : null
    );
    prismaMock.zaloMessage.create.mockResolvedValue({ id: "e-A" });
    mockConversation("conv-A");

    const res = await saveOutboundEcho(outbound({ zaloMsgId: "grp-msg-1" }));

    expect(res).toMatchObject({ saved: true, duplicated: false, messageId: "e-A" });
    expect(prismaMock.zaloMessage.create).toHaveBeenCalledTimes(1);
  });

  it("같은 대화에 이미 저장됐으면 duplicated=true, create 미호출", async () => {
    mockConversation("conv-A");
    prismaMock.zaloMessage.findUnique.mockResolvedValue({
      id: "existing",
      globalMsgId: null,
      cliMsgId: null,
    });

    const res = await saveOutboundEcho(outbound());

    expect(res).toMatchObject({ saved: false, duplicated: true, messageId: null });
    expect(prismaMock.zaloMessage.create).not.toHaveBeenCalled();
  });

  it("create가 P2002(동일 대화 레이스)를 던지면 throw 없이 duplicated=true 반환", async () => {
    mockConversation("conv-A");
    prismaMock.zaloMessage.findUnique.mockResolvedValue(null);
    prismaMock.zaloMessage.create.mockRejectedValue(p2002());

    const res = await saveOutboundEcho(outbound());

    expect(res).toMatchObject({ saved: false, duplicated: true, messageId: null });
  });

  it("create가 P2002 외 에러면 그대로 rethrow", async () => {
    mockConversation("conv-A");
    prismaMock.zaloMessage.findUnique.mockResolvedValue(null);
    prismaMock.zaloMessage.create.mockRejectedValue(new Error("db down"));

    await expect(saveOutboundEcho(outbound())).rejects.toThrow("db down");
  });
});
