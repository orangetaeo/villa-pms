// [SHARED-MODULE] from Nike src/lib/zalo-pool.ts (v1.x) — 단순 이식 (ADR-0006 S3)
/**
 * Zalo 봇 수신 리스너 핸들러 (S3).
 *
 * 책임 분리(테스트 가능성):
 *  - 순수 파싱 함수(extractText / isPhoneLike / extractPhone / isEchoMessage / buildInboundKey):
 *    부수효과 없음 → vitest 단위 테스트 대상. DB·zca-js 의존 없음.
 *  - saveInboundMessage: 위 순수 함수 결과를 받아 ZaloConversation/ZaloMessage upsert·저장 + 전화번호 매칭.
 *  - handleInboundMessage: zca-js UserMessage → 순수 파싱 → saveInboundMessage (리스너에서 호출).
 *
 * villa-pms는 봇 1:N 텍스트 위주 — 그룹·음성STT·리액션·undo는 제외(Nike 대비 대폭 단순화).
 * 봇 본인 발신(isSelf 에코)은 저장 스킵 — S4 발송이 이미 OUTBOUND를 미러 기록하므로 중복 방지.
 *
 * 보안: credential·세션 객체를 본 파일에서 다루지 않는다(리스너가 넘기는 메시지 데이터만).
 *       마진·판매가·원가는 수신 본문엔 애초에 없으나, 저장 텍스트는 사용자 입력 그대로 — 가공 없음.
 */
import {
  ZaloMessageDirection,
  ZaloMessageSource,
  ZaloMessageStatus,
  Role,
  type ZaloTranslateMode,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { translateText, transcribeVoice } from "@/lib/gemini";
// S5 A6-3 — STT 결과(translatedText) 채운 뒤 동일 메시지를 Nike로 1회 재push(멱등 zaloMsgId).
// zalo-webhook은 prisma만 의존 → 순환 import 없음.
import { pushInboundToNike } from "@/lib/zalo-webhook";

// ===================== 순수 함수 층 (단위 테스트 대상) =====================

/**
 * 본문을 못 뽑았을 때 표시할 폴백 — zca-js 내부 타입/메서드명("sendBubbleMessage" 등)
 * 노출 금지(버그 B). 운영자가 "비텍스트 수신"임을 알 수 있는 중립 문구.
 */
export const UNKNOWN_MESSAGE_FALLBACK = "[알 수 없는 메시지]";

/**
 * content 객체에서 사람이 읽을 캡션/본문 후보 필드만 안전 추출.
 * **action/type/href 등 메타·메서드 필드는 절대 보지 않는다** — 버그 B 재발 방지.
 * (zca-js 리치/버블/공유 메시지의 content.action 값 "sendBubbleMessage"가
 *  본문으로 새던 문제 차단). 캡션 후보가 비문자열·빈문자열이면 건너뛴다.
 */
function pickCaptionField(o: Record<string, unknown>): string | null {
  // 사람이 작성한 본문/캡션이 들어오는 필드만 화이트리스트로 한정.
  for (const key of ["msg", "title", "description", "caption", "text"] as const) {
    const v = o[key];
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  // params 안에 캡션이 중첩된 경우(이미지/파일 캡션) — 문자열이면 JSON 파싱 시도.
  const params = o.params;
  if (params) {
    let p: unknown = params;
    if (typeof params === "string") {
      try {
        p = JSON.parse(params);
      } catch {
        p = null;
      }
    }
    if (p && typeof p === "object") {
      const po = p as Record<string, unknown>;
      const cand = po.caption ?? po.msg;
      if (typeof cand === "string" && cand.trim().length > 0) return cand;
    }
  }
  return null;
}

/**
 * zca-js UserMessage.data.content → 표시 텍스트 추출 (타입별 안전 파싱, 버그 B 수정).
 *
 * content는 zca-js 타입상 `string | TAttachmentContent | TOtherContent`이며,
 * 리치/버블/공유(business)·첨부 메시지는 객체로 온다. 과거 구현은 title/description/msg만
 * 봐서, 그 필드가 없는 객체에선 ""을 반환했고, 일부 직렬화 경로에서 action 값
 * "sendBubbleMessage"가 본문처럼 새는 문제가 있었다.
 *
 * 처리:
 *  - string: JSON처럼 보이면(앞이 '{') 파싱해 캡션 추출 시도, 아니면 그대로 본문.
 *  - object: 캡션 후보(msg/title/description/caption/text/params.caption)만 화이트리스트 추출.
 *  - 추출 실패: "" 반환(첨부 전용 메시지). 호출부는 빈 문자열이면 폴백 처리(아래 extractDisplayText).
 *
 * ★ action/type/href/thumb 등 메타 필드는 절대 본문으로 쓰지 않는다.
 */
export function extractText(content: unknown): string {
  if (typeof content === "string") {
    const trimmed = content.trim();
    // JSON 문자열(파일·연락처·리치)이면 파싱해 캡션만 — 메서드/액션명 새는 것 방지.
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") {
          return pickCaptionField(parsed as Record<string, unknown>) ?? "";
        }
      } catch {
        /* JSON 아님 — 일반 텍스트로 취급 */
      }
    }
    return content;
  }
  if (content && typeof content === "object") {
    return pickCaptionField(content as Record<string, unknown>) ?? "";
  }
  return "";
}

/**
 * 표시용 텍스트 — extractText 결과가 비면 첨부/리치 메시지로 보고 중립 폴백.
 * (extractText는 "본문 없음"을 ""로 구분 반환; 저장·표시 단계에서 폴백 적용)
 * 이미지/파일 등 첨부 수신은 본문이 비어도 폴백 문구로 수신 흔적을 남긴다(버그 B).
 */
export function extractDisplayText(content: unknown): string {
  const text = extractText(content);
  return text.trim().length > 0 ? text : UNKNOWN_MESSAGE_FALLBACK;
}

// ===================== 수신 메시지 타입 분류 (Nike parseMessageContent 이식) =====================

/**
 * ZaloMessage.msgType 컨벤션값 — 수신 분류 결과.
 * 발송측 별도 값(villa_share/proposal_share/settlement_share)은 share route가 직접 지정하므로 여기 없음.
 * 스키마가 String이라 값 추가는 자유 — FE는 미상(unknown) 폴백으로 안전 렌더.
 */
export type InboundMsgType =
  | "text"
  | "photo"
  | "file"
  | "sticker"
  | "voice"
  | "contact"
  | "call"
  | "video"
  | "location"
  | "unknown";

/** classifyInbound 결과 — 저장(msgType·text·attachmentUrls)에 그대로 전달. */
export interface ClassifiedInbound {
  msgType: InboundMsgType;
  /** 표시·저장용 본문. 텍스트=원문, 파일=파일명, 연락처=연락처명, 비텍스트(스티커/음성/통화/위치)=빈 문자열(FE 라벨). */
  text: string;
  /** 첨부 URL 목록(이미지/파일/스티커/음성/영상). 본문 전용 메시지는 빈 배열. */
  attachmentUrls: string[];
}

/** 문서/비이미지 파일로 보이는 확장자 (chat.photo로 와도 문서면 file로 분류 — Nike 패턴). */
const DOC_FILE_RE = /\.(pdf|docx?|xlsx?|pptx?|csv|txt|zip|rar|7z|hwp|mp4|avi|mov)(\?|$)/i;

/** content 객체에서 첫 번째로 존재하는 문자열 필드 추출. 없으면 "". */
function pickStringField(o: Record<string, unknown>, keys: readonly string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return "";
}

/** params(문자열 JSON 또는 객체)에서 caption/msg 추출. 없으면 "". */
function pickParamsCaption(params: unknown): string {
  let p: unknown = params;
  if (typeof params === "string") {
    try {
      p = JSON.parse(params);
    } catch {
      return "";
    }
  }
  if (p && typeof p === "object") {
    const po = p as Record<string, unknown>;
    const cand = po.caption ?? po.msg;
    if (typeof cand === "string" && cand.trim().length > 0) return cand;
  }
  return "";
}

/**
 * 수신 메시지 타입 분류 (Nike parseMessageContent 정본 이식 — villa-pms 1:N 단순화).
 *
 * zca-js TMessage.msgType("chat.photo"·"chat.voice"·"chat.sticker"·"chat.recommend"·"chat.video"·
 * "share.file"·통화 등) + content를 받아 { msgType(컨벤션값)·text·attachmentUrls } 반환.
 *
 * 분기:
 *  - 텍스트(string·JSON캡션) → "text", text=본문
 *  - 사진(chat.photo, 이미지) → "photo", attachmentUrls=[url] (캡션은 text)
 *  - 문서(chat.photo지만 문서 확장자 / chat.file / share.file) → "file", text=파일명, attachmentUrls=[url]
 *  - 영상(chat.video / share.video) → "video", attachmentUrls=[url]
 *  - 스티커(chat.sticker) → "sticker", attachmentUrls=[webp/정적 url]
 *  - 음성(chat.voice) → "voice", attachmentUrls=[url], text="" (FE "음성" 라벨)
 *  - 연락처/네임카드(chat.recommend/chat.todo/phone·qrCodeUrl·gUid) → "contact", text=연락처명, attachmentUrls=[qrCodeUrl?]
 *  - 통화(call/voip 류) → "call", text="" (FE "통화" 라벨)
 *  - 위치(chat.location/location/gps) → "location", text=주소(있으면), attachmentUrls=[지도url?]
 *  - 그 외 본문 없음 → "unknown" (FE 폴백)
 *
 * ★ extractText와 동일 원칙: action/메서드명 등 메타 필드는 절대 본문으로 새지 않는다(버그 B).
 *   본문이 잡히면 "text"가 아니어도 캡션으로만 쓰고, 미상 본문은 빈 문자열로 둔다.
 */
export function classifyInbound(content: unknown, zaloMsgType?: string): ClassifiedInbound {
  const type = (zaloMsgType ?? "").toLowerCase();

  // ── 통화: content 유무와 무관하게 타입만으로 판정(본문 없음) ──
  if (type.includes("call") || type.includes("voip")) {
    return { msgType: "call", text: "", attachmentUrls: [] };
  }

  // ── 문자열 content: JSON(연락처/리치)이면 파싱 후 재분류, 아니면 텍스트 ──
  if (typeof content === "string") {
    const trimmed = content.trim();
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") {
          const po = parsed as Record<string, unknown>;
          // 연락처 JSON(phone/qrCodeUrl/gUid) — 객체 분기와 동일 처리
          if (po.phone || po.qrCodeUrl || po.gUid) {
            return classifyInbound(parsed, type || "chat.recommend");
          }
          // 그 외 객체는 객체 경로로 재분류(캡션만 안전 추출)
          return classifyInbound(parsed, type);
        }
      } catch {
        /* JSON 아님 — 일반 텍스트 */
      }
    }
    return { msgType: "text", text: content, attachmentUrls: [] };
  }

  // ── 비객체(null/숫자 등): 타입 힌트만으로 판정, 아니면 텍스트 폴백 ──
  if (!content || typeof content !== "object") {
    if (type === "chat.sticker") return { msgType: "sticker", text: "", attachmentUrls: [] };
    if (type === "chat.voice") return { msgType: "voice", text: "", attachmentUrls: [] };
    if (type.includes("location")) return { msgType: "location", text: "", attachmentUrls: [] };
    // 타입은 비텍스트인데 content가 없으면 흔적만 — unknown
    if (type && type !== "webchat" && type !== "chat.text") {
      return { msgType: "unknown", text: "", attachmentUrls: [] };
    }
    return { msgType: "text", text: "", attachmentUrls: [] };
  }

  const o = content as Record<string, unknown>;

  // ── 스티커 ──
  if (type === "chat.sticker") {
    const url = pickStringField(o, ["stickerWebpUrl", "stickerUrl", "url"]);
    return { msgType: "sticker", text: "", attachmentUrls: url ? [url] : [] };
  }

  // ── 음성 ──
  if (type === "chat.voice") {
    const url = pickStringField(o, ["voiceUrl", "m4aUrl", "href", "url"]);
    return { msgType: "voice", text: "", attachmentUrls: url ? [url] : [] };
  }

  // ── 사진/문서 (chat.photo는 문서도 실어옴) ──
  if (type === "chat.photo") {
    const href = pickStringField(o, ["href", "hdUrl", "normalUrl", "originUrl", "url"]);
    const nameField = pickStringField(o, ["title", "description", "fileName"]);
    const nameToCheck = nameField || href;
    if (DOC_FILE_RE.test(nameToCheck)) {
      const fileName = (nameField || href.split("/").pop()?.split("?")[0] || "").normalize("NFC");
      return { msgType: "file", text: fileName, attachmentUrls: href ? [href] : [] };
    }
    // 실제 이미지 — 캡션만 본문으로(메서드/action 금지)
    let caption = pickStringField(o, ["description", "title", "msg", "caption"]);
    if (!caption && o.params) caption = pickParamsCaption(o.params);
    const url = href || pickStringField(o, ["thumb"]);
    return { msgType: "photo", text: caption, attachmentUrls: url ? [url] : [] };
  }

  // ── 영상 ──
  if (
    type === "chat.video" ||
    type === "share.video" ||
    type.includes(".video")
  ) {
    let url = pickStringField(o, ["href", "url", "fileUrl"]);
    if (!url && o.params) {
      const fromParams = pickStringField(
        (() => {
          try {
            return typeof o.params === "string" ? JSON.parse(o.params) : (o.params as Record<string, unknown>);
          } catch {
            return {};
          }
        })(),
        ["href", "url"]
      );
      url = fromParams;
    }
    return { msgType: "video", text: "", attachmentUrls: url ? [url] : [] };
  }

  // ── 파일(비이미지) ──
  if (type === "chat.file" || type === "share.file" || type.includes(".file")) {
    const fileName = pickStringField(o, ["title", "description", "fileName"]).normalize("NFC");
    let url = pickStringField(o, ["href", "url", "fileUrl"]);
    if (!url && o.params) {
      const fromParams = pickStringField(
        (() => {
          try {
            return typeof o.params === "string" ? JSON.parse(o.params) : (o.params as Record<string, unknown>);
          } catch {
            return {};
          }
        })(),
        ["href", "url"]
      );
      url = fromParams;
    }
    return { msgType: "file", text: fileName, attachmentUrls: url ? [url] : [] };
  }

  // ── 위치 ──
  if (type.includes("location") || (typeof o.lat !== "undefined" && typeof o.lon !== "undefined")) {
    const label = pickStringField(o, ["address", "title", "description"]);
    const url = pickStringField(o, ["href", "url"]);
    return { msgType: "location", text: label, attachmentUrls: url ? [url] : [] };
  }

  // ── 연락처/네임카드 ──
  if (type === "chat.recommend" || type === "chat.todo" || o.phone || o.qrCodeUrl || o.gUid) {
    // 운영자 수신 표시용 — 저장은 이름 위주(phone은 표시용으로만 본문에 넣지 않음).
    const contactName = pickStringField(o, ["name", "displayName", "title", "zaloName"]);
    const qrCodeUrl = pickStringField(o, ["qrCodeUrl"]);
    return {
      msgType: "contact",
      text: contactName,
      attachmentUrls: qrCodeUrl ? [qrCodeUrl] : [],
    };
  }

  // ── 본문 없는 href(타입 미상) — 확장자로 이미지/파일 구분 ──
  if (typeof o.href === "string" && o.href.length > 0 && !type) {
    const href = o.href;
    if (/\.(jpe?g|png|gif|webp)/i.test(href)) {
      const caption = pickStringField(o, ["description"]);
      return { msgType: "photo", text: caption, attachmentUrls: [href] };
    }
    const fileName = pickStringField(o, ["title", "description", "fileName"]).normalize("NFC");
    return { msgType: "file", text: fileName, attachmentUrls: [href] };
  }

  // ── 마지막: 캡션 후보(extractText 화이트리스트)만 본문으로. 잡히면 text, 아니면 unknown ──
  const caption = extractText(o);
  if (caption.trim().length > 0) {
    return { msgType: "text", text: caption, attachmentUrls: [] };
  }
  return { msgType: "unknown", text: "", attachmentUrls: [] };
}

/**
 * 베트남/한국 전화번호로 보이는 문자열인지 (전화번호 매칭 T3.7 후보 판정).
 * 공백·하이픈·점·괄호·국가코드(+84/0084)를 제거한 뒤 8~15자리 숫자면 true.
 */
export function isPhoneLike(text: string): boolean {
  return extractPhone(text) !== null;
}

/**
 * 본문에서 전화번호 후보를 정규화해 추출. 없으면 null.
 * 반환: 숫자만(선두 0 보존). 국가코드 +84/0084는 0으로 환원(베트남 로컬 표기 일치용).
 */
export function extractPhone(text: string): string | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  // 전화번호 외 잡문이 섞이면 매칭 대상 아님 — 본문 전체가 번호여야 함(과매칭 방지)
  if (!/^[+()\d\s.\-]+$/.test(trimmed)) return null;
  let digits = trimmed.replace(/[^\d]/g, "");
  if (digits.length === 0) return null;
  // +84 / 0084 / 84 (베트남) → 0 로컬 표기로 환원
  if (digits.startsWith("0084")) digits = "0" + digits.slice(4);
  else if (digits.startsWith("84") && digits.length >= 11) digits = "0" + digits.slice(2);
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

/**
 * 봇 본인 발신인지 판정.
 * 1) zca-js isSelf 플래그 우선, 2) 보강: 발신자 id(uidFrom/userId)가 봇 ownId와 일치.
 *
 * **용도 변경(2026-06)**: 과거엔 "에코 → 스킵" 판정용이었으나,
 * 이제 본인 발신(앱·프로그램 모두)을 OUTBOUND 동기화하기 위한 **방향 분기** 판정에 쓴다.
 * true면 OUTBOUND 경로(saveOutboundEcho), false면 INBOUND 경로(saveInboundMessage).
 */
export function isSelfMessage(
  opts: { isSelf?: boolean; senderId?: string | null },
  botOwnId: string | null
): boolean {
  if (opts.isSelf === true) return true;
  if (botOwnId && opts.senderId && String(opts.senderId) === String(botOwnId)) return true;
  return false;
}

/**
 * @deprecated isSelfMessage로 대체 — 호환 유지용 별칭. 신규 코드는 isSelfMessage 사용.
 */
export const isEchoMessage = isSelfMessage;

/**
 * zca-js 메시지 타임스탬프(data.ts, ms epoch 문자열/숫자) → Date. 없거나 비정상이면 null.
 * 앱에서 직접 보낸 메시지의 발생 시각을 보존해 정렬 꼬임을 막는다.
 */
export function parseZaloTs(ts: unknown): Date | null {
  let ms: number | null = null;
  if (typeof ts === "string" && ts.length > 0) ms = Number(ts);
  else if (typeof ts === "number") ms = ts;
  if (ms === null || !Number.isFinite(ms) || ms <= 0) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * 멱등 키 — zca-js msgId(서버 메시지 id)를 ZaloMessage.zaloMsgId로 사용.
 * 없으면 null(멱등 불가 — 저장은 하되 중복 가드 없음).
 */
export function buildInboundKey(data: { msgId?: unknown }): string | null {
  const raw = data?.msgId;
  if (typeof raw === "string" && raw.length > 0) return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return null;
}

/**
 * zca-js cliMsgId 추출 (ADR-0009 개정3 R3-1) — 리액션·답글 대상 식별자.
 * data.cliMsgId(문자열/숫자)를 문자열로 정규화. 없으면 null.
 * 리액션(addReaction)·답글(SendMessageQuote)은 zaloMsgId(서버 id) + cliMsgId 둘 다 요구하므로
 * 수신·발신 양쪽에서 함께 저장한다(없는 과거 메시지엔 리액션·답글 불가 — R3-4).
 */
export function buildCliMsgId(data: { cliMsgId?: unknown }): string | null {
  const raw = data?.cliMsgId;
  if (typeof raw === "string" && raw.length > 0) return raw;
  if (typeof raw === "number" && Number.isFinite(raw) && raw !== 0) return String(raw);
  return null;
}

/** 파싱된 인용(답글) 스냅샷 — ZaloMessage.quoted* 저장용. */
export interface ParsedQuote {
  /** 인용 원본 메시지 zaloMsgId (참조 힌트, FK 아님). 없으면 null */
  quotedMsgId: string | null;
  /** 인용 본문 스냅샷 (표시용) */
  quotedText: string | null;
  /** 인용 발신자 표시명 스냅샷 */
  quotedSender: string | null;
}

/**
 * 수신 메시지 data.quote → 인용 스냅샷 추출 (ADR-0009 R3-1, Nike extractQuote 패턴).
 * zca-js TQuote: { msg(본문)·attach(첨부)·fromD(발신자명)·globalMsgId(원본 서버 id)·cliMsgType }.
 *  - quote.msg → quotedText. 본문 없고 attach만 있으면 "[첨부]"로 표기.
 *  - quote.fromD → quotedSender.
 *  - quote.globalMsgId → quotedMsgId(문자열 정규화).
 * quote 자체가 없으면(일반 메시지) null. 본문·발신자 둘 다 없으면 인용 아님으로 간주(undefined→null).
 */
export function extractQuote(data: { quote?: unknown }): ParsedQuote | null {
  const quote = data?.quote as
    | {
        msg?: string;
        attach?: string;
        fromD?: string;
        globalMsgId?: string | number;
      }
    | undefined
    | null;
  if (!quote || typeof quote !== "object") return null;

  let quotedText: string | null =
    typeof quote.msg === "string" && quote.msg.trim().length > 0 ? quote.msg : null;
  if (!quotedText && typeof quote.attach === "string" && quote.attach.length > 0) {
    quotedText = "[첨부]";
  }
  const quotedSender =
    typeof quote.fromD === "string" && quote.fromD.trim().length > 0 ? quote.fromD : null;
  const quotedMsgId =
    quote.globalMsgId != null && quote.globalMsgId !== ""
      ? String(quote.globalMsgId)
      : null;

  // 본문·발신자·원본id 전부 없으면 인용 데이터로 보지 않음.
  if (!quotedText && !quotedSender && !quotedMsgId) return null;
  return { quotedMsgId, quotedText, quotedSender };
}

// ===================== 파싱된 수신 (핸들러 ↔ 저장 경계) =====================

export interface ParsedInbound {
  /** 이 메시지를 받은 관리자 userId — ZaloConversation 귀속 복합키 (ADR-0007 D3) */
  ownerAdminId: string;
  /** 시스템봇 인스턴스 수신 여부 — true일 때만 전화번호 매칭(전역 온보딩, D4) */
  isSystemBot: boolean;
  /** 발신 상대(공급자)의 Zalo id */
  senderZaloUserId: string;
  text: string;
  /** 분류된 메시지 타입 (classifyInbound 결과). 미지정 시 "text"로 저장(하위호환). */
  msgType?: InboundMsgType;
  /** 첨부 URL 목록 (이미지/파일/스티커/음성/영상). 없으면 빈 배열. */
  attachmentUrls?: string[];
  /** zca-js 서버 msgId — ZaloMessage.zaloMsgId(멱등). 없으면 null */
  zaloMsgId: string | null;
  /** 발신자 표시명(있으면 ZaloConversation.displayName 보강용) */
  displayName: string | null;
  /** zca-js가 메시지에 실어 보낸 발신자 전화번호(있으면). 없으면 null */
  senderPhone: string | null;
  /** zca-js cliMsgId — 리액션·답글 대상 식별 (ADR-0009 R3-1). 없으면 null */
  cliMsgId?: string | null;
  /** 수신 메시지의 인용(답글) 스냅샷 (ADR-0009 R3-1). 없으면 null */
  quote?: ParsedQuote | null;
}

// ===================== DB 저장 + 전화번호 매칭 =====================

/**
 * 수신 메시지 1건 저장 (ADR-0007 — 관리자별 귀속).
 *  1) (ownerAdminId, zaloUserId) 복합키로 ZaloConversation upsert (관리자별 격리)
 *  2) zaloMsgId 멱등 — 이미 존재하면 저장 스킵(중복 0)
 *  3) ZaloMessage(INBOUND·USER·text) 생성
 *  4) conversation.lastMessageAt·lastInboundAt=now, unreadCount+1
 *  5) 전화번호 매칭: **시스템봇 수신(isSystemBot)만** (전역 온보딩, D4).
 *     개인 계정 수신은 User.zaloUserId를 건드리지 않는다(전역 오염 방지).
 *
 * 예외 안전: 호출부(handleInboundEvent)에서 try/catch — 여기선 throw 가능.
 */
export async function saveInboundMessage(parsed: ParsedInbound): Promise<{
  saved: boolean;
  duplicated: boolean;
  matchedUserId: string | null;
  /** 저장된 INBOUND 메시지 id (수신 자동번역 대상). 중복/미저장 시 null. */
  messageId: string | null;
  /** 대화 번역모드 (수신 자동번역 분기 — OFF면 번역 안 함, ADR-0009 D7.4). */
  translateMode: ZaloTranslateMode;
}> {
  const {
    ownerAdminId,
    isSystemBot,
    senderZaloUserId,
    text,
    msgType,
    attachmentUrls,
    zaloMsgId,
    displayName,
    senderPhone,
    cliMsgId,
    quote,
  } = parsed;
  const now = new Date();

  // 1) 대화 upsert (관리자×상대 복합키 — 없으면 생성)
  const conversation = await prisma.zaloConversation.upsert({
    where: { ownerAdminId_zaloUserId: { ownerAdminId, zaloUserId: senderZaloUserId } },
    update: {},
    create: {
      ownerAdminId,
      zaloUserId: senderZaloUserId,
      displayName: displayName ?? undefined,
    },
    select: { id: true, userId: true, displayName: true, translateMode: true },
  });

  // 2) 멱등 — 동일 zaloMsgId 이미 있으면 스킵
  if (zaloMsgId) {
    const existing = await prisma.zaloMessage.findUnique({
      where: { zaloMsgId },
      select: { id: true },
    });
    if (existing) {
      return {
        saved: false,
        duplicated: true,
        matchedUserId: conversation.userId,
        messageId: null,
        translateMode: conversation.translateMode,
      };
    }
  }

  // 3) 메시지 생성 (cliMsgId·인용 스냅샷 함께 저장 — ADR-0009 R3-1)
  const created = await prisma.zaloMessage.create({
    data: {
      conversationId: conversation.id,
      direction: ZaloMessageDirection.INBOUND,
      source: ZaloMessageSource.USER,
      msgType: msgType ?? "text",
      text: text || null,
      attachmentUrls: attachmentUrls ?? [],
      zaloMsgId,
      cliMsgId: cliMsgId ?? null,
      quotedMsgId: quote?.quotedMsgId ?? null,
      quotedText: quote?.quotedText ?? null,
      quotedSender: quote?.quotedSender ?? null,
      status: ZaloMessageStatus.SENT,
    },
    select: { id: true },
  });

  // 4) 대화 메타 갱신 (+ displayName 보강)
  await prisma.zaloConversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: now,
      lastInboundAt: now,
      unreadCount: { increment: 1 },
      ...(displayName && !conversation.displayName ? { displayName } : {}),
    },
  });

  // 5) 전화번호 매칭 (T3.7) — 시스템봇 수신만(전역 온보딩, D4) + 아직 User 미연결인 대화만.
  //    개인 계정 수신은 User.zaloUserId(전역) 오염 방지 위해 매칭 스킵.
  let matchedUserId = conversation.userId;
  if (isSystemBot && !conversation.userId) {
    const phone = senderPhone ?? extractPhone(text);
    if (phone) {
      matchedUserId = await tryMatchSupplierByPhone(
        conversation.id,
        senderZaloUserId,
        phone
      );
    }
  }

  return {
    saved: true,
    duplicated: false,
    matchedUserId,
    messageId: created.id,
    translateMode: conversation.translateMode,
  };
}

/**
 * 수신 메시지 자동 번역 (ADR-0009 D7.4) — best-effort, 리스너 외부 fire-and-forget.
 * 모드가 OFF면 호출 자체를 건너뛴다(Gemini 호출 0). VI/EN이면 수신 본문을 항상 ko로 번역해
 * ZaloMessage.translatedText에 저장(운영자가 읽음). 실패는 조용히 무시(translatedText null 유지).
 *
 * 주의: 이 함수는 saveInboundMessage 저장 완료 후에만 호출한다(메시지 id 필요).
 *       번역은 네트워크 호출이므로 수신 핸들러를 블로킹하지 않도록 await 없이 띄운다.
 */
export async function maybeTranslateInbound(
  messageId: string,
  text: string,
  translateMode: ZaloTranslateMode
): Promise<void> {
  if (translateMode === "OFF") return; // 번역 끔 — Gemini 호출 0
  const trimmed = text.trim();
  if (trimmed.length === 0) return;
  try {
    // 수신은 항상 ko 타깃(ADMIN 기준 언어). 소스 언어는 모델 자동감지.
    const translated = await translateText(trimmed, "ko");
    if (!translated) return;
    await prisma.zaloMessage.update({
      where: { id: messageId },
      data: { translatedText: translated },
    });
  } catch (err) {
    // 본문 에코 방지 — 상태/메시지만 (개인정보·credential 무관)
    console.error(
      "[zalo-inbound] 수신 자동번역 실패:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

/**
 * 수신 음성 메시지 STT (S5 A6-3) — best-effort, 리스너 외부 fire-and-forget.
 * 모드가 OFF면 호출 자체를 건너뛴다(Gemini 호출 0 — maybeTranslateInbound와 일관).
 * VI/EN이면: voiceUrl GET → base64 → transcribeVoice(받아쓰기) → translateText(stt,"ko")
 *   → ZaloMessage.translatedText에 저장(운영자가 음성 내용을 ko로 읽음 — 동일 필드·동일 의미).
 * 저장 성공 후 동일 메시지를 Nike로 1회 재push(멱등 zaloMsgId — Nike가 STT 텍스트 실시간 반영).
 *
 * 전체 try/catch — 1건 실패(CDN 무응답·STT 실패·번역 실패·키 미설정)가 리스너·메시지에
 * 영향 0(translatedText null 유지, 메시지 자체는 이미 저장됨, 흔적 손실 0).
 *
 * 개인정보 주의: 오디오 base64·STT 결과를 console에 기록하지 않는다(상태/메시지만).
 */
export async function maybeTranscribeVoice(
  messageId: string,
  voiceUrl: string | null | undefined,
  translateMode: ZaloTranslateMode
): Promise<void> {
  if (translateMode === "OFF") return; // 받아쓰기 끔 — Gemini 호출 0
  if (!voiceUrl) return; // 음성 URL 없으면 받아쓸 대상 없음
  try {
    // 1) 음성 파일 다운로드 (15s 타임아웃 — Nike processVoiceAutoTranslate 패턴, CDN 무응답 보호)
    const res = await fetch(voiceUrl, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return; // CDN 실패 — 흔적 없이 스킵(상태/메시지만, 본문 에코 없음)
    const arrayBuf = await res.arrayBuffer();
    if (arrayBuf.byteLength === 0) return;
    const audioBase64 = Buffer.from(arrayBuf).toString("base64");
    const mimeType = res.headers.get("content-type") || "audio/mpeg";

    // 2) 받아쓰기(원문) → 3) ko 번역(운영자용). 둘 중 빈 결과면 저장 스킵.
    const stt = await transcribeVoice(audioBase64, mimeType);
    if (!stt || stt.trim().length === 0) return;
    const translated = await translateText(stt, "ko");
    if (!translated || translated.trim().length === 0) return;

    // 4) translatedText UPDATE (maybeTranslateInbound와 동일 필드·동일 패턴)
    await prisma.zaloMessage.update({
      where: { id: messageId },
      data: { translatedText: translated },
    });

    // 5) STT 완료 후 동일 메시지 1회 재push (멱등 zaloMsgId — Nike update). 테오 스코프 확인 겸 조회.
    const conv = await prisma.zaloMessage.findUnique({
      where: { id: messageId },
      select: { conversation: { select: { ownerAdminId: true, zaloUserId: true } } },
    });
    if (conv?.conversation) {
      pushInboundToNike({
        ref: { id: messageId },
        threadId: conv.conversation.zaloUserId,
        ownerAdminId: conv.conversation.ownerAdminId,
      });
    }
  } catch (err) {
    // 오디오·STT 결과 에코 방지 — 상태/메시지만 (실패는 swallow, 리스너 영향 0)
    console.error(
      "[zalo-inbound] 수신 음성 STT 실패:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

// ===================== 본인 발신 동기화 (OUTBOUND echo) =====================

export interface ParsedOutbound {
  /** 발신 주체 ADMIN userId(인스턴스 소유자) — ZaloConversation 귀속 복합키. */
  ownerAdminId: string;
  /** 대화 상대(수신자)의 Zalo id — self 메시지의 threadId. */
  senderZaloUserId: string;
  text: string;
  /** 분류된 메시지 타입 (앱에서 보낸 비텍스트 동기화 시). 미지정 시 "text". */
  msgType?: InboundMsgType;
  /** 첨부 URL 목록. 없으면 빈 배열. */
  attachmentUrls?: string[];
  /** zca-js 서버 msgId — 멱등 키. 프로그램(S4) 발신이 이미 저장한 것과 중복 방지. */
  zaloMsgId: string | null;
  /** 발신 시각(zca-js data.ts). 없으면 호출부에서 now 전달. 순서 꼬임 방지. */
  createdAt: Date;
  /** 상대 표시명(있으면 displayName 보강용). 없으면 null. */
  displayName: string | null;
  /** zca-js cliMsgId — 내가 보낸 메시지의 리액션·답글 대상 식별 (ADR-0009 R3-1). 없으면 null */
  cliMsgId?: string | null;
  /** 내가 보낸 답글의 인용 스냅샷 (앱 발신 동기화 시). 없으면 null */
  quote?: ParsedQuote | null;
}

/**
 * 본인 발신 메시지 동기화 저장 (앱/프로그램 모두 message 이벤트 isSelf=true로 들어옴, selfListen).
 *
 * INBOUND(saveInboundMessage)와의 차이:
 *  - direction OUTBOUND, source CHAT (사람이 직접 보낸 것 — 수동 발신과 동일 의미)
 *  - unreadCount **증가 안 함** (내가 보낸 것)
 *  - 전화번호 매칭 **안 함** (수신만 매칭 — D4)
 *  - lastInboundAt **갱신 안 함**, lastMessageAt만 갱신
 *  - createdAt = zca-js 타임스탬프(있으면) — 앱 발신 정렬 보존
 *
 * 멱등(필수): zaloMsgId가 이미 ZaloMessage에 있으면 스킵 —
 *   프로그램(S4 dispatchOne SYSTEM 미러 / b14 CHAT 발송)이 이미 같은 msgId로 저장한 경우 중복 방지.
 *
 * 예외 안전: 호출부(handleInboundEvent)에서 try/catch — 여기선 throw 가능.
 */
export async function saveOutboundEcho(parsed: ParsedOutbound): Promise<{
  saved: boolean;
  duplicated: boolean;
}> {
  const {
    ownerAdminId,
    senderZaloUserId,
    text,
    msgType,
    attachmentUrls,
    zaloMsgId,
    createdAt,
    displayName,
    cliMsgId,
    quote,
  } = parsed;

  // 1) 대화 upsert (관리자×상대 복합키 — 없으면 생성)
  const conversation = await prisma.zaloConversation.upsert({
    where: { ownerAdminId_zaloUserId: { ownerAdminId, zaloUserId: senderZaloUserId } },
    update: {},
    create: {
      ownerAdminId,
      zaloUserId: senderZaloUserId,
      displayName: displayName ?? undefined,
    },
    select: { id: true, displayName: true },
  });

  // 2) 멱등 — 프로그램이 이미 같은 zaloMsgId로 저장했으면 스킵 (중복 0)
  if (zaloMsgId) {
    const existing = await prisma.zaloMessage.findUnique({
      where: { zaloMsgId },
      select: { id: true },
    });
    if (existing) {
      return { saved: false, duplicated: true };
    }
  }

  // 3) OUTBOUND·CHAT 메시지 생성. sentBy 미상(앱 발신은 발송자 식별 불가) → null.
  //    cliMsgId·인용 스냅샷 함께 저장 — 내가 앱에서 보낸 메시지도 리액션·답글 대상이 되게 (ADR-0009 R3-1).
  await prisma.zaloMessage.create({
    data: {
      conversationId: conversation.id,
      direction: ZaloMessageDirection.OUTBOUND,
      source: ZaloMessageSource.CHAT,
      msgType: msgType ?? "text",
      text: text || null,
      attachmentUrls: attachmentUrls ?? [],
      zaloMsgId,
      cliMsgId: cliMsgId ?? null,
      quotedMsgId: quote?.quotedMsgId ?? null,
      quotedText: quote?.quotedText ?? null,
      quotedSender: quote?.quotedSender ?? null,
      status: ZaloMessageStatus.SENT,
      createdAt,
    },
  });

  // 4) 대화 메타 — lastMessageAt만 갱신(unread·lastInboundAt 미변경). displayName 보강.
  await prisma.zaloConversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: createdAt,
      ...(displayName && !conversation.displayName ? { displayName } : {}),
    },
  });

  return { saved: true, duplicated: false };
}

/**
 * 전화번호로 SUPPLIER User 조회 → 매칭 시 User.zaloUserId + ZaloConversation.userId 연결.
 * 자동 매칭 실패(미발견·이미 다른 zaloUserId 점유·충돌)는 무시 — ADMIN 수동 매칭(T1.8) fallback.
 * @returns 매칭된 userId 또는 null
 */
async function tryMatchSupplierByPhone(
  conversationId: string,
  senderZaloUserId: string,
  phone: string
): Promise<string | null> {
  // 동일 번호의 SUPPLIER 후보 (정확 일치). phone @unique이므로 0~1건.
  const candidate = await prisma.user.findFirst({
    where: { role: Role.SUPPLIER, phone, isActive: true },
    select: { id: true, zaloUserId: true },
  });
  if (!candidate) return null;
  // 이미 다른 Zalo 계정에 연결된 사용자면 자동 덮어쓰기 금지(충돌 → 수동 처리)
  if (candidate.zaloUserId && candidate.zaloUserId !== senderZaloUserId) return null;

  try {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: candidate.id },
        data: { zaloUserId: senderZaloUserId },
      }),
      prisma.zaloConversation.update({
        where: { id: conversationId },
        data: { userId: candidate.id },
      }),
    ]);
    return candidate.id;
  } catch {
    // zaloUserId/userId @unique 경합 등 — 자동 매칭 실패는 조용히 무시(수동 fallback)
    return null;
  }
}
