// lib/ticket-upload.ts — 티켓형 부가서비스(TICKET) QR 티켓 이미지 업로드 공용 헬퍼 (ADR-0034)
//   벤더 발행 API(/api/vendor/orders/[id]/tickets)·관리자 대리 업로드 API
//   (/api/service-orders/[id]/tickets)가 공유한다. 이미지 검증(화이트리스트·매직바이트·5MB)·
//   총량 상한(30장)·저장(saveFile)까지 담당. 상태 전이·알림·AuditLog는 호출부 책임.
//   ★ 저장 URL은 추측 불가(saveFile: 타임스탬프+업로더+uuid). 공개 버킷이지만 열거 불가.
import { saveFile, isAllowedImageMime, sniffImageMime } from "@/lib/storage";

// 개당 5MB — uploads route와 동일 상한. QR 티켓 이미지는 스크린샷/사진이라 넉넉.
export const MAX_TICKET_FILE_SIZE = 5 * 1024 * 1024;
// 한 주문의 티켓 총량 상한 — 발행 수량 + 확인시트·FOC 여유분(ADR-0034: 수량 비강제).
export const MAX_TICKETS_PER_ORDER = 30;

export type TicketUploadResult =
  | { ok: true; urls: string[] }
  | { ok: false; error: "NO_FILES" | "INVALID_TYPE" | "FILE_TOO_LARGE" | "TOO_MANY_TICKETS" };

/**
 * multipart form-data(files 필드 다중)에서 티켓 이미지를 검증·저장.
 * - existingCount: 기존 ticketUrls 장수(합계 상한 판정용).
 * - ★ 전량 사전검증 후 저장 — 하나라도 불합격이면 아무것도 저장하지 않아 부분 저장/orphan 없음.
 *   (동시성 409로 DB 미기록 시 발생하는 orphan은 호출부 책임 — 노출 URL이 없으므로 무해.)
 */
export async function saveTicketFiles(
  formData: FormData,
  existingCount: number,
  uploaderId: string
): Promise<TicketUploadResult> {
  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return { ok: false, error: "NO_FILES" };
  if (existingCount + files.length > MAX_TICKETS_PER_ORDER) {
    return { ok: false, error: "TOO_MANY_TICKETS" };
  }

  // 1) 전량 검증(선언 MIME 화이트리스트 + 크기 + 실제 매직바이트) — 저장 전 게이트.
  const validated: { buffer: Buffer; mime: string }[] = [];
  for (const f of files) {
    if (!isAllowedImageMime(f.type)) return { ok: false, error: "INVALID_TYPE" };
    if (f.size > MAX_TICKET_FILE_SIZE) return { ok: false, error: "FILE_TOO_LARGE" };
    const buffer = Buffer.from(await f.arrayBuffer());
    // 실제 바이트가 허용 이미지가 아니면(SVG/HTML/실행파일 위장) 거부 — saveFile도 막지만 orphan 방지 위해 선차단.
    if (sniffImageMime(buffer) === null) return { ok: false, error: "INVALID_TYPE" };
    validated.push({ buffer, mime: f.type });
  }

  // 2) 저장 — 검증 통과분만. saveFile은 파일명에 타임스탬프+업로더 기록(증빙 규칙).
  const urls: string[] = [];
  for (const v of validated) {
    const { url } = await saveFile(v.buffer, v.mime, uploaderId);
    urls.push(url);
  }
  return { ok: true, urls };
}
