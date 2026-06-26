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
  ZaloThreadType,
  Prisma,
  Role,
  type ZaloTranslateMode,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { translateText, transcribeVoice, translateImage } from "@/lib/gemini";
// S5 A6-3 — STT 결과(translatedText) 채운 뒤 동일 메시지를 Nike로 1회 재push(멱등 zaloMsgId).
// zalo-webhook은 prisma만 의존 → 순환 import 없음.
import { pushInboundToNike } from "@/lib/zalo-webhook";
// 실시간(SSE) — 신규 수신 저장 후 ownerAdminId 채널로 "inbound" 신호 발행(인박스 즉시 갱신).
import { publish as publishRealtime } from "@/lib/realtime-bus";

// ===================== 순수 함수 층 (단위 테스트 대상) =====================

/**
 * 본문을 못 뽑았을 때 표시할 폴백 — zca-js 내부 타입/메서드명("sendBubbleMessage" 등)
 * 노출 금지(버그 B). 운영자가 "비텍스트 수신"임을 알 수 있는 중립 문구.
 */
export const UNKNOWN_MESSAGE_FALLBACK = "[알 수 없는 메시지]";

/**
 * zca-js 내부 메서드/액션 토큰 — 사람이 읽을 본문·이름이 절대 아니다.
 * 통화 기록은 별도 msgType 없이 버블 객체로 오는데, 캡션 대신 title/name/action 등에
 * 이 토큰("sendBubbleMessage")만 담겨 온다(실관측 2026-06-22 — 연락처로 오분류 + 토큰이
 * 본문으로 노출되던 버그). 이 토큰만 있는 버블은 통화로 인식한다(classifyInbound).
 */
const BENIGN_METHOD_TOKENS = new Set(["sendBubbleMessage"]);

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
  | "link" // 링크/구글지도/장소 공유 — 썸네일+제목+설명+URL을 리치 카드로(FE LinkPreviewCard)
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
 * Zalo 통화 시스템 텍스트인지 판정 (실데이터 휴리스틱).
 *
 * zca-js/Zalo는 통화 기록을 별도 msgType 없이 본문 text로 보낸다(베트남어):
 *  - "Cuộc gọi"(통화), "Cuộc gọi nhỡ"(부재중), "Cuộc gọi thoại"(음성통화), "Cuộc gọi video"(영상통화) 등.
 *
 * 오판 최소화 원칙(매우 보수적):
 *  - **trim 전체가** 통화 패턴일 때만 true. 일반 대화가 우연히 "Cuộc gọi"로 시작하는 경우
 *    ("Cuộc gọi 잘 받았어요")까지 통화로 보면 안 되므로, 열린 시작 매칭(prefix)이 아니라
 *    **알려진 통화 라벨의 정확(trim 전체) 매칭 + 단독 "Cuộc gọi" + 알려진 접미사 변형**만 인정한다.
 *  - 베트남어(실데이터): "Cuộc gọi"(통화), "Cuộc gọi nhỡ"(부재중), "Cuộc gọi đi"(발신),
 *    "Cuộc gọi đến"(수신), "Cuộc gọi thoại"(음성), "Cuộc gọi video"(영상), "Cuộc gọi không thành công"
 *    /"Cuộc gọi bị nhỡ"(실패·부재) 등 — 알려진 변형 목록(정확 매칭).
 *  - 다국어 대비는 명백한 단독 케이스만(과확장 금지): 한국어 "통화"/"영상 통화"/"음성 통화"/
 *    "부재중 통화", 영어 "Call"/"Missed call"/"Voice call"/"Video call".
 */
const CALL_SYSTEM_LABELS = new Set<string>([
  // ── 베트남어 (실데이터) ──
  "cuộc gọi",
  "cuộc gọi nhỡ",
  "cuộc gọi đi",
  "cuộc gọi đến",
  "cuộc gọi thoại",
  "cuộc gọi video",
  "cuộc gọi bị nhỡ",
  "cuộc gọi không thành công",
  // ── 한국어 ──
  "통화",
  "영상 통화",
  "음성 통화",
  "부재중 통화",
  // ── 영어 ──
  "call",
  "missed call",
  "voice call",
  "video call",
]);

export function isCallSystemText(text: unknown): boolean {
  if (typeof text !== "string") return false;
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  return CALL_SYSTEM_LABELS.has(trimmed.toLowerCase());
}

/**
 * 수신 메시지 타입 분류 (Nike parseMessageContent 정본 이식 — villa-pms 1:N 단순화).
 *
 * zca-js TMessage.msgType(실제값: "chat.photo"·"chat.voice"·"chat.sticker"·"chat.recommended"·
 * "chat.video.msg"·"chat.location.new"·"chat.gif"·"chat.doodle"·"chat.link"·"share.file" 등 —
 * node_modules/zca-js/dist/utils.js getClientMessageType 기준) + content를 받아
 * { msgType(컨벤션값)·text·attachmentUrls } 반환.
 *
 * ※ 통화(call/voip)는 zca-js가 message 이벤트로 보내지 않는다(Listener 이벤트·msgType에 부재).
 *   call 분기는 혹시 모를 변형 타입 대비 방어적으로만 유지 — 실수신은 기대하지 않는다.
 *
 * 분기:
 *  - 텍스트(string·JSON캡션) → "text", text=본문
 *  - 사진(chat.photo, 이미지) → "photo", attachmentUrls=[url] (캡션은 text)
 *  - GIF/낙서(chat.gif/chat.doodle) → "photo"(이미지류로 표시). doodle은 URL 없으면 unknown 폴백.
 *  - 문서(chat.photo지만 문서 확장자 / chat.file / share.file) → "file", text=파일명, attachmentUrls=[url]
 *  - 영상(chat.video.msg / share.video) → "video", attachmentUrls=[url]
 *  - 스티커(chat.sticker) → "sticker", attachmentUrls=[webp/정적 url]
 *  - 음성(chat.voice) → "voice", attachmentUrls=[url], text="" (FE "음성" 라벨)
 *  - 링크(chat.link) → "text", text=제목+URL (extractText 화이트리스트 범위 내)
 *  - 연락처/네임카드(chat.recommended/chat.todo/phone·qrCodeUrl·gUid) → "contact", text=연락처명, attachmentUrls=[qrCodeUrl?]
 *  - 통화(call/voip 류) → "call", text="" (방어용 — zca-js는 message로 통화를 보내지 않음)
 *  - 위치(chat.location.new/location/gps) → "location", text=주소(있으면), attachmentUrls=[지도url?]
 *  - 그 외 본문 없음 → "unknown" (FE 폴백)
 *
 * ★ extractText와 동일 원칙: action/메서드명 등 메타 필드는 절대 본문으로 새지 않는다(버그 B).
 *   본문이 잡히면 "text"가 아니어도 캡션으로만 쓰고, 미상 본문은 빈 문자열로 둔다.
 */

/**
 * 통화 버블 content.params에서 구조화 통화 상세 텍스트 생성(없으면 "").
 *
 * params(JSON): duration(초)·reason·isCaller·calltype. 실측 매핑(2026-06-25, 테오↔조윤희 5종 통화):
 *   - reason 없음 + duration>0 → done(완료), reason=3 → rejected(거절), reason=4 → missed(취소/미응답)
 *   - isCaller=1 → out(발신), 0 → in(수신). calltype=0 → audio(음성), 그 외 → video(영상)
 *
 * 형식: "CALL:<out|in>:<done|missed|rejected|unknown>:<durSec>:<audio|video>"
 *   Nike(adaptVillaMessage→parseCallMessage)가 파싱해 방향·결과·시간·음/영상 카드를 렌더한다.
 *   villa 자체 UI는 msgType="call"로 렌더(이 text 미사용)하며, inbox 미리보기는 call 타입을
 *   라벨로 치환해 원시 토큰 노출을 막는다(previewText). params 없으면 ""(일반 통화 폴백).
 */
export function buildCallDetail(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  const o = content as Record<string, unknown>;
  let p: Record<string, unknown> | null = null;
  const pv = o.params;
  if (pv && typeof pv === "object") p = pv as Record<string, unknown>;
  else if (typeof pv === "string") {
    try {
      const j = JSON.parse(pv);
      if (j && typeof j === "object") p = j as Record<string, unknown>;
    } catch {
      /* params 비JSON — 상세 불가 */
    }
  }
  if (!p || (p.calltype == null && p.duration == null)) return "";
  const durSec = Math.max(0, Math.floor(Number(p.duration) || 0));
  const reason = p.reason == null ? null : Number(p.reason);
  const dir = Number(p.isCaller) === 1 ? "out" : "in";
  const vtype = Number(p.calltype) !== 0 ? "video" : "audio";
  let status: "done" | "missed" | "rejected" | "unknown";
  if (reason == null) status = durSec > 0 ? "done" : "missed";
  else if (reason === 3) status = "rejected";
  else if (reason === 4) status = "missed";
  else status = "unknown";
  // 연결 안 된 통화(missed/rejected)는 통화시간 없음 — params.duration은 벨 울린 시간일 뿐이므로 0으로 정규화.
  const outDur = status === "missed" || status === "rejected" ? 0 : durSec;
  return `CALL:${dir}:${status}:${outDur}:${vtype}`;
}

/**
 * 링크/구글지도/장소 공유 → "link" 카드 분류 (FE LinkPreviewCard용).
 * 인코딩(스키마 변경 없이 text·attachmentUrls만 사용):
 *  - attachmentUrls[0] = 링크 URL(항상, 카드 클릭 시 열기 — 모바일은 지도/브라우저 앱). [1] = 썸네일(있으면).
 *  - text = "제목"(+ 줄바꿈 + "설명"). 제목=장소명, 설명=별점·카테고리 등(있을 때, 제목과 다를 때만).
 * 제목이 비면 URL을 제목 자리로(렌더 폴백). 인박스 미리보기는 text 첫 줄(제목)을 그대로 보여준다.
 */
function makeLinkCard(
  title: string,
  description: string,
  url: string,
  thumb: string
): ClassifiedInbound {
  const cleanTitle = title.trim();
  const cleanDesc =
    description.trim() && description.trim() !== cleanTitle ? description.trim() : "";
  const textLines = [cleanTitle || url, ...(cleanDesc ? [cleanDesc] : [])];
  const urls = [url];
  if (thumb && /^https?:\/\//i.test(thumb) && thumb !== url) urls.push(thumb);
  return { msgType: "link", text: textLines.join("\n"), attachmentUrls: urls };
}

export function classifyInbound(content: unknown, zaloMsgType?: string): ClassifiedInbound {
  const type = (zaloMsgType ?? "").toLowerCase();

  // ── 통화: content 유무와 무관하게 타입만으로 판정 ──
  //   객체 content면 params에서 방향·결과·시간 상세를 구조화 텍스트로 보존(Nike 카드용).
  if (type.includes("call") || type.includes("voip")) {
    return { msgType: "call", text: buildCallDetail(content), attachmentUrls: [] };
  }

  // ── 통화 텍스트 휴리스틱 (실데이터: zca-js는 통화를 별도 msgType 없이 본문 text="Cuộc gọi"로 보냄) ──
  //    문자열 content의 trim 전체가 알려진 Zalo 통화 시스템 라벨일 때만 call로 분류(오판 최소화).
  //    "Cuộc gọi", "Cuộc gọi nhỡ"(부재중), "Cuộc gọi thoại"/"Cuộc gọi video"(음성/영상) 등 →
  //    isCallSystemText가 알려진 라벨 정확(trim 전체) 매칭만 수행. 문장 중간/시작에 "Cuộc gọi"가
  //    섞인 일반 대화("Cuộc gọi 잘 받았어요")는 통화로 보지 않음.
  //    call로 분류되면 text=""·attachmentUrls=[]로 반환해 chat-pane이 통화 아이콘+라벨을 렌더한다.
  if (typeof content === "string" && isCallSystemText(content)) {
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
          // zca-js 실제 타입은 "chat.recommended"(getClientMessageType 38) — recommended로 폴백.
          if (po.phone || po.qrCodeUrl || po.gUid) {
            return classifyInbound(parsed, type || "chat.recommended");
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

  // ── 통화 버블(zca-js 메서드 토큰) ──
  // 통화 기록은 별도 msgType 없이 버블 객체로 오며, 사람이 읽을 캡션 대신 title/name/action에
  // 내부 메서드 토큰("sendBubbleMessage")만 담겨 온다(실관측). gUid가 함께 와서 연락처로
  // 오분류되고 토큰이 본문으로 새던 문제를, contact 분기보다 먼저 통화로 잡아 차단한다.
  // 신호는 **이름/제목 필드(name·displayName·title·zaloName)가 토큰**인 경우다(통화 시 contactName으로
  // 새던 출처). action 토큰만으로는 판정하지 않는다 — action="sendBubbleMessage"는 캡션 있는 일반
  // 비즈니스/공유 버블에도 붙기 때문(그 경우는 기존대로 text/unknown 유지). 사람 캡션이 없을 때만 통화로 본다.
  const tokenName = pickStringField(o, ["name", "displayName", "title", "zaloName"]);
  const humanCaption = pickCaptionField(o);
  const captionIsTokenOrEmpty = !humanCaption || BENIGN_METHOD_TOKENS.has(humanCaption);
  if (captionIsTokenOrEmpty && BENIGN_METHOD_TOKENS.has(tokenName)) {
    // 통화 버블 — params(duration/reason/isCaller/calltype)에서 상세 보존(Nike 카드용). 없으면 "".
    return { msgType: "call", text: buildCallDetail(o), attachmentUrls: [] };
  }

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

  // ── GIF / 낙서(doodle) — 이미지류로 표시 (zca-js: chat.gif=49, chat.doodle=37) ──
  //    chat.photo와 동일 URL 패턴 재사용(애니메이션도 이미지로 렌더). 단 doodle은
  //    낙서 데이터라 표시 가능한 URL이 없으면 unknown 폴백(빈 이미지 방지).
  if (type === "chat.gif" || type === "chat.doodle") {
    const url = pickStringField(o, ["href", "hdUrl", "normalUrl", "originUrl", "url", "thumb"]);
    if (!url) {
      return { msgType: "unknown", text: "", attachmentUrls: [] };
    }
    let caption = pickStringField(o, ["description", "title", "msg", "caption"]);
    if (!caption && o.params) caption = pickParamsCaption(o.params);
    return { msgType: "photo", text: caption, attachmentUrls: [url] };
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

  // ── 링크(chat.link) — 제목 + URL을 본문(text)으로 (extractText 화이트리스트 범위 내) ──
  //    링크 공유는 사람이 읽는 캡션. 제목·설명(화이트리스트)과 href(URL)를 합쳐 text로.
  //    action/메서드명 등 메타 필드는 절대 넣지 않는다(버그 B 원칙).
  if (type === "chat.link") {
    const title = pickStringField(o, ["title", "name"]);
    const desc = pickStringField(o, ["description", "desc", "caption", "msg"]);
    const linkUrl = pickStringField(o, ["href", "url"]);
    const thumb = pickStringField(o, [
      "thumb",
      "thumbUrl",
      "thumb_url",
      "hdUrl",
      "normalUrl",
      "photoUrl",
      "image",
    ]);
    // http(s) URL이 있으면 리치 링크 카드. 없으면 기존 텍스트 폴백.
    if (/^https?:\/\//i.test(linkUrl)) {
      return makeLinkCard(title, desc, linkUrl, thumb);
    }
    const text = [title || desc, linkUrl].filter((s) => s.length > 0).join("\n");
    return { msgType: "text", text, attachmentUrls: [] };
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

  // ── 연락처/네임카드 OR 링크·지도·POI 공유 ──
  // zca-js 실제 타입: "chat.recommended"(getClientMessageType 38). includes("recommend")로 포착.
  // ★ 주의: Zalo "recommended"는 **네임카드뿐 아니라 링크/구글지도/POI 공유**도 같은 타입으로 온다.
  //   과거엔 전부 contact로 떨궈, 지도 URL 공유가 "빈 연락처"로 표시되던 버그(실관측 2026-06-23).
  //   구분: 연락처 식별자(phone/qrCodeUrl/gUid)가 있으면 네임카드, http URL(href/url)이 있으면 링크/지도.
  //   리치 공유는 url·thumb·title이 params(JSON)에 중첩될 수 있어 top-level + params 양쪽을 본다.
  if (type.includes("recommend") || type === "chat.todo" || o.phone || o.qrCodeUrl || o.gUid) {
    // params(문자열 JSON 또는 객체) 병합 조회용.
    let p: Record<string, unknown> = {};
    if (o.params) {
      try {
        p = typeof o.params === "string" ? JSON.parse(o.params) : (o.params as Record<string, unknown>);
      } catch {
        p = {};
      }
    }
    const pick2 = (keys: readonly string[]) =>
      pickStringField(o, keys) || pickStringField(p, keys);

    const sharedUrl = pick2(["href", "url", "link"]);
    const isHttpLink = /^https?:\/\//i.test(sharedUrl);
    const hasContactId = !!(o.phone || o.qrCodeUrl || o.gUid || p.phone || p.qrCodeUrl);

    // 링크/지도/POI 공유(http URL 보유 + 연락처 식별자 없음) → 리치 링크 카드("link").
    //   제목=장소명, 설명=별점·카테고리 등(별도 필드), 썸네일=미리보기 이미지, URL=클릭 시 지도/브라우저 앱.
    if (isHttpLink && !hasContactId) {
      const title = pick2(["title", "name"]);
      const desc = pick2(["description", "desc", "address", "caption", "msg"]);
      const thumb = pick2(["thumb", "thumbUrl", "thumb_url", "hdUrl", "normalUrl", "photoUrl", "image"]);
      return makeLinkCard(title, desc, sharedUrl, thumb);
    }

    // 진짜 네임카드 — 이름 위주(phone은 표시용으로만, 본문엔 안 넣음).
    const contactName = pick2(["name", "displayName", "title", "zaloName"]);
    const qrCodeUrl = pickStringField(o, ["qrCodeUrl"]) || pickStringField(p, ["qrCodeUrl"]);
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

/**
 * zca-js globalMsgId 추출 (답글 인용 점프 앵커 변환용).
 * 답글의 quote.globalMsgId와 동일 ID 체계 — 메시지별 globalMsgId를 저장해 두면, 수신 답글의
 * quotedMsgId(=원본 globalMsgId)를 버블 앵커 zaloMsgId(=msgId)로 변환할 수 있다(Nike 패턴).
 * data.globalMsgId(문자열/숫자)를 문자열 정규화. 없으면 null(과거 메시지 — 점프 불가, 무해).
 */
export function buildGlobalMsgId(data: { globalMsgId?: unknown }): string | null {
  const raw = data?.globalMsgId;
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
  /** zca-js globalMsgId — 답글 인용 점프 앵커 변환용(quote.globalMsgId와 동일 체계). 없으면 null */
  globalMsgId?: string | null;
  /** 발신자 표시명(있으면 ZaloConversation.displayName 보강용) */
  displayName: string | null;
  /** zca-js가 메시지에 실어 보낸 발신자 전화번호(있으면). 없으면 null */
  senderPhone: string | null;
  /** zca-js cliMsgId — 리액션·답글 대상 식별 (ADR-0009 R3-1). 없으면 null */
  cliMsgId?: string | null;
  /** 수신 메시지의 인용(답글) 스냅샷 (ADR-0009 R3-1). 없으면 null */
  quote?: ParsedQuote | null;
  /**
   * 대화 종류 (ADR-0010 그룹 D / S4). 미지정 시 "USER"(1:1) — 기존 호출 동작 불변.
   * "GROUP"이면 zaloUserId 슬롯에 그룹 id가 들어오고, 전화번호 자동매칭을 스킵한다(다중 발신자).
   */
  threadType?: "USER" | "GROUP";
  /**
   * 그룹 메시지의 발신자 Zalo id (ADR-0010 D3 / S4). 그룹은 다중 발신자라 누가 보냈는지 식별.
   * 1:1은 null(상대 고정). ZaloMessage.senderUid로 저장.
   */
  senderUid?: string | null;
  /**
   * 그룹 메시지 발신자의 표시명 (zca-js data.dName — 그룹에선 발신자명). 1:1은 null.
   * 매 메시지마다 발신자(senderUid+이 이름)를 groupMembers 스냅샷에 점진 누적 → getGroupInfo가
   * 멤버를 안 줘도 "발언한 사람"의 이름은 항상 해석된다(버블 발신자명, R14 폴백 해소).
   */
  senderName?: string | null;
  /**
   * 그룹 멤버 스냅샷 Json (ADR-0010 D2 / S4) — [{zaloId,name,avatarUrl}]. 미지정/없으면 미갱신.
   * 전달되면 GROUP 대화의 groupMembers를 갱신(발신자명·아바타 매핑 원천). 누수 무관(공개 프로필).
   */
  groupMembers?: unknown;
}

/**
 * 그룹 멤버 스냅샷에 발신자 1명을 병합 (ADR-0010 S4 — 점진 누적).
 * 기존 배열에 동일 zaloId가 없거나 이름이 비어 있으면 추가/보강. avatar는 보존(여기선 메시지에 없어 미설정).
 * 변경이 없으면 null 반환(불필요한 DB write 회피). 누수 무관(공개 프로필 zaloId·name만).
 */
export function mergeGroupMember(
  existing: unknown,
  member: { zaloId: string; name: string }
): { zaloId: string; name: string; avatarUrl: string | null }[] | null {
  if (!member.zaloId) return null;
  const list = Array.isArray(existing)
    ? (existing as { zaloId?: unknown; name?: unknown; avatarUrl?: unknown }[])
        .filter((m) => m && typeof m === "object" && typeof m.zaloId === "string")
        .map((m) => ({
          zaloId: m.zaloId as string,
          name: typeof m.name === "string" ? m.name : "",
          avatarUrl: typeof m.avatarUrl === "string" ? m.avatarUrl : null,
        }))
    : [];
  const idx = list.findIndex((m) => m.zaloId === member.zaloId);
  if (idx === -1) {
    list.push({ zaloId: member.zaloId, name: member.name, avatarUrl: null });
    return list;
  }
  // 이미 있고 이름이 비어 있던 경우만 이름 보강(아바타 등 기존 값 보존).
  if (!list[idx].name && member.name) {
    list[idx] = { ...list[idx], name: member.name };
    return list;
  }
  return null; // 변경 없음
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
    globalMsgId,
    displayName,
    senderPhone,
    cliMsgId,
    quote,
    threadType,
    senderUid,
    senderName,
    groupMembers,
  } = parsed;
  const now = new Date();
  // 그룹 여부 — 전화번호 매칭 가드·컬럼 저장 분기. 미지정 시 USER(기존 1:1 동작 불변).
  const isGroup = threadType === "GROUP";

  // 1) 대화 upsert (관리자×상대 복합키 — 없으면 생성)
  //    create에 threadType 반영(기본 USER). GROUP이고 groupMembers가 오면 update로 스냅샷 갱신.
  const conversation = await prisma.zaloConversation.upsert({
    where: { ownerAdminId_zaloUserId: { ownerAdminId, zaloUserId: senderZaloUserId } },
    update:
      isGroup && groupMembers != null
        ? { groupMembers: groupMembers as Prisma.InputJsonValue }
        : {},
    create: {
      ownerAdminId,
      zaloUserId: senderZaloUserId,
      displayName: displayName ?? undefined,
      threadType: isGroup ? ZaloThreadType.GROUP : ZaloThreadType.USER,
      ...(isGroup && groupMembers != null
        ? { groupMembers: groupMembers as Prisma.InputJsonValue }
        : {}),
    },
    select: { id: true, userId: true, displayName: true, translateMode: true, groupMembers: true },
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
      globalMsgId: globalMsgId ?? null,
      cliMsgId: cliMsgId ?? null,
      // 그룹 메시지 발신자 식별 (ADR-0010 D3). 1:1은 null(상대 고정).
      senderUid: senderUid ?? null,
      quotedMsgId: quote?.quotedMsgId ?? null,
      quotedText: quote?.quotedText ?? null,
      quotedSender: quote?.quotedSender ?? null,
      status: ZaloMessageStatus.SENT,
    },
    select: { id: true },
  });

  // 4) 대화 메타 갱신 (+ displayName 보강 + 그룹 발신자 점진 누적)
  //    그룹: 매 메시지 발신자(senderUid+senderName)를 groupMembers에 누적 → getGroupInfo가 멤버를
  //    안 줘도 "발언한 사람"의 이름은 항상 해석된다(버블 발신자명, R14 원문 폴백 해소). 변경 없으면 미갱신.
  const mergedMembers =
    isGroup && senderUid && senderName
      ? mergeGroupMember(conversation.groupMembers, { zaloId: senderUid, name: senderName })
      : null;
  await prisma.zaloConversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: now,
      // 인박스 미리보기 비정규화(perf) — 수신 본문·타입 캐시. 표시 전용(누수 무관).
      lastMessageText: text || null,
      lastMessageType: msgType ?? "text",
      lastInboundAt: now,
      unreadCount: { increment: 1 },
      ...(displayName && !conversation.displayName ? { displayName } : {}),
      ...(mergedMembers ? { groupMembers: mergedMembers as Prisma.InputJsonValue } : {}),
    },
  });

  // 5) 전화번호 매칭 (T3.7) — 시스템봇 수신만(전역 온보딩, D4) + 아직 User 미연결인 대화만.
  //    개인 계정 수신은 User.zaloUserId(전역) 오염 방지 위해 매칭 스킵.
  //    ADR-0010 S4: 그룹(GROUP)은 다중 발신자라 한 zaloUserId(=그룹 id)에 여러 사람이 섞인다.
  //    그룹 id를 특정 User.zaloUserId로 매칭하면 전역 오염되므로 그룹은 자동 매칭을 스킵한다.
  let matchedUserId = conversation.userId;
  if (isSystemBot && !isGroup && !conversation.userId) {
    const phone = senderPhone ?? extractPhone(text);
    if (phone) {
      matchedUserId = await tryMatchSupplierByPhone(
        conversation.id,
        senderZaloUserId,
        phone
      );
    }
  }

  // 실시간(SSE) — 신규 수신 저장 완료(중복 아님) 후 본인(ownerAdminId) 채널로 "inbound" 신호 발행.
  // 비블로킹·예외 격리: 발행 실패가 저장 결과/리스너에 영향 없게 try/catch로 감싼다(신호일 뿐).
  try {
    publishRealtime(ownerAdminId, { type: "inbound", conversationId: conversation.id });
  } catch {
    /* 실시간 발행 실패는 무해 — 클라이언트 폴백/다음 신호로 갱신 */
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
/**
 * 본문이 이미 한국어인지 판정 — 수신 자동번역(타깃 ko) 스킵용.
 * Gemini에 한국어를 "ko로 번역"시키면 ko→ko 패러프레이즈(불필요한 재작성)가 나온다(실관측 2026-06-24).
 * 한글(음절·자모)이 라틴 문자(영어·베트남어)보다 많거나 같으면 한국어로 본다(숫자·기호는 무시).
 */
export function isProbablyKorean(text: string): boolean {
  if (!text) return false;
  const hangul = (text.match(/[가-힣ᄀ-ᇿ㄰-㆏]/g) || []).length;
  if (hangul === 0) return false;
  const latin = (text.match(/[A-Za-zÀ-ɏẠ-ỿ]/g) || []).length;
  return hangul >= latin;
}

export async function maybeTranslateInbound(
  messageId: string,
  text: string,
  translateMode: ZaloTranslateMode
): Promise<void> {
  if (translateMode === "OFF") return; // 번역 끔 — Gemini 호출 0
  const trimmed = text.trim();
  if (trimmed.length === 0) return;
  // 이미 한국어인 수신은 번역 스킵 — ko→ko 패러프레이즈 방지(운영자는 원문 그대로 읽음).
  if (isProbablyKorean(trimmed)) return;
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
    // 받아쓴 게 이미 한국어면 ko→ko 패러프레이즈 방지 — STT 원문을 그대로 자막으로.
    const translated = isProbablyKorean(stt.trim())
      ? stt.trim()
      : await translateText(stt, "ko");
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

/**
 * 수신 사진 메시지 OCR 번역 — best-effort, 리스너 외부 fire-and-forget (maybeTranscribeVoice 복제).
 * 모드가 OFF면 호출 자체를 건너뛴다(Gemini 호출 0 — STT·텍스트 자동번역과 일관).
 * VI/EN이면: imageUrl GET → base64 → translateImage(이미지 OCR→ko 번역)
 *   → ZaloMessage.translatedText에 저장(운영자가 사진 속 글자를 ko로 읽음 — STT와 동일 필드·의미).
 * 저장 성공 후 동일 메시지를 Nike로 1회 재push(멱등 zaloMsgId — Nike가 번역 자막 실시간 반영).
 *
 * 사진 caption(text)과 OCR 번역은 별개다 — caption은 ZaloMessage.text, OCR 번역은 translatedText.
 *
 * 전체 try/catch — 1건 실패(CDN 무응답·OCR 실패·번역 실패·키 미설정·텍스트 없음)가 리스너·메시지에
 * 영향 0(translatedText null 유지, 메시지 자체는 이미 저장됨, 흔적 손실 0).
 *
 * 개인정보 주의: 이미지 base64·OCR 결과를 console에 기록하지 않는다(상태/메시지만).
 */
export async function maybeTranslatePhoto(
  messageId: string,
  imageUrl: string | null | undefined,
  translateMode: ZaloTranslateMode
): Promise<void> {
  if (translateMode === "OFF") return; // 번역 끔 — Gemini 호출 0
  if (!imageUrl) return; // 이미지 URL 없으면 OCR 대상 없음
  try {
    // 1) 이미지 다운로드 (15s 타임아웃 — maybeTranscribeVoice 패턴, CDN 무응답 보호)
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return; // CDN 실패 — 흔적 없이 스킵(상태/메시지만, 본문 에코 없음)
    const arrayBuf = await res.arrayBuffer();
    if (arrayBuf.byteLength === 0) return;
    const imageBase64 = Buffer.from(arrayBuf).toString("base64");
    const mimeType = res.headers.get("content-type") || "image/jpeg";

    // 2) 이미지 OCR→ko 번역. 텍스트 없거나 빈 결과면 저장 스킵(자막 미표시).
    const translated = await translateImage(imageBase64, mimeType, "ko");
    if (!translated || translated.trim().length === 0) return;

    // 3) translatedText UPDATE (maybeTranscribeVoice와 동일 필드·동일 패턴)
    await prisma.zaloMessage.update({
      where: { id: messageId },
      data: { translatedText: translated },
    });

    // 4) OCR 번역 완료 후 동일 메시지 1회 재push (멱등 zaloMsgId — Nike update). 테오 스코프 조회 겸.
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
    // 이미지·OCR 결과 에코 방지 — 상태/메시지만 (실패는 swallow, 리스너 영향 0)
    console.error(
      "[zalo-inbound] 수신 사진 OCR 번역 실패:",
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
  /** zca-js globalMsgId — 답글 인용 점프 앵커 변환용. 프로그램 발신분(route)은 echo로 보강. 없으면 null */
  globalMsgId?: string | null;
  /** 발신 시각(zca-js data.ts). 없으면 호출부에서 now 전달. 순서 꼬임 방지. */
  createdAt: Date;
  /** 상대 표시명(있으면 displayName 보강용). 없으면 null. */
  displayName: string | null;
  /** zca-js cliMsgId — 내가 보낸 메시지의 리액션·답글 대상 식별 (ADR-0009 R3-1). 없으면 null */
  cliMsgId?: string | null;
  /** 내가 보낸 답글의 인용 스냅샷 (앱 발신 동기화 시). 없으면 null */
  quote?: ParsedQuote | null;
  /** 대화 종류 (ADR-0010 그룹 D / S4). 미지정 시 "USER" — 기존 1:1 echo 동작 불변. */
  threadType?: "USER" | "GROUP";
  /** 그룹 echo 발신자 Zalo id (보통 내 ownId). 1:1은 null. ZaloMessage.senderUid로 저장. */
  senderUid?: string | null;
  /** 그룹 멤버 스냅샷 Json (ADR-0010 D2). 전달되면 GROUP 대화 groupMembers 갱신. */
  groupMembers?: unknown;
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
    globalMsgId,
    createdAt,
    displayName,
    cliMsgId,
    quote,
    threadType,
    senderUid,
    groupMembers,
  } = parsed;
  const isGroup = threadType === "GROUP";

  // 1) 대화 upsert (관리자×상대 복합키 — 없으면 생성)
  //    create에 threadType 반영. GROUP echo에서 groupMembers가 오면 스냅샷 갱신.
  const conversation = await prisma.zaloConversation.upsert({
    where: { ownerAdminId_zaloUserId: { ownerAdminId, zaloUserId: senderZaloUserId } },
    update:
      isGroup && groupMembers != null
        ? { groupMembers: groupMembers as Prisma.InputJsonValue }
        : {},
    create: {
      ownerAdminId,
      zaloUserId: senderZaloUserId,
      displayName: displayName ?? undefined,
      threadType: isGroup ? ZaloThreadType.GROUP : ZaloThreadType.USER,
      ...(isGroup && groupMembers != null
        ? { groupMembers: groupMembers as Prisma.InputJsonValue }
        : {}),
    },
    select: { id: true, displayName: true },
  });

  // 2) 멱등 — 프로그램이 이미 같은 zaloMsgId로 저장했으면 스킵 (중복 0)
  //    단, route(POST /api/zalo/messages) 발신은 zca-js send가 globalMsgId를 안 돌려줘 null로 저장된다.
  //    self-echo에는 globalMsgId가 실려 오므로, 기존 행에 없으면 여기서 보강(답글 인용 점프 앵커 — 상대가
  //    내 발신을 인용해 답글하면 quote.globalMsgId가 이 값과 매칭돼야 점프됨). 첫 echo 1회만 update.
  if (zaloMsgId) {
    const existing = await prisma.zaloMessage.findUnique({
      where: { zaloMsgId },
      select: { id: true, globalMsgId: true, cliMsgId: true },
    });
    if (existing) {
      // route(POST) 발신은 zca-js send가 globalMsgId·cliMsgId를 안 돌려줘 null로 저장된다.
      // self-echo엔 둘 다 실려 오므로 기존 행에 없으면 보강 — 그래야 내가 보낸 메시지에도 답글·리액션 가능
      // (cliMsgId)·상대가 내 발신 인용 시 점프(globalMsgId). 첫 echo 1회만 update.
      const patch: { globalMsgId?: string; cliMsgId?: string } = {};
      if (globalMsgId && !existing.globalMsgId) patch.globalMsgId = globalMsgId;
      if (cliMsgId && !existing.cliMsgId) patch.cliMsgId = cliMsgId;
      if (Object.keys(patch).length > 0) {
        await prisma.zaloMessage.update({ where: { id: existing.id }, data: patch });
      }
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
      globalMsgId: globalMsgId ?? null,
      cliMsgId: cliMsgId ?? null,
      // 그룹 echo 발신자(내 ownId 등). 1:1은 null. (ADR-0010 D3)
      senderUid: senderUid ?? null,
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
      // 인박스 미리보기 비정규화(perf) — 발신 echo 본문·타입 캐시.
      lastMessageText: text || null,
      lastMessageType: msgType ?? "text",
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
