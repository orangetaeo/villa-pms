// 비밀번호 자가재설정 — Zalo 6자리 코드 방식 (ADR password-self-reset).
// 보안 규칙: 평문 코드는 절대 저장/로그/응답에 남기지 않는다(codeHash만). 사용자 열거 방지(동일 응답).
import { randomInt } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

/** 코드 유효시간 — 10분 (계약) */
export const RESET_CODE_TTL_MS = 10 * 60_000;
/** 코드 최대 오입력 횟수 — 초과 시 토큰 폐기 */
export const RESET_MAX_ATTEMPTS = 5;
/** 새 비밀번호 최소 길이 */
export const RESET_MIN_PASSWORD = 8;

/** 전화번호 정규화 — 숫자만(로그인/가입 폼과 동일 규칙) */
export function normalizePhone(raw: string): string {
  return raw.replace(/[^0-9]/g, "");
}

/** 6자리 숫자 코드 (crypto 안전 난수) — 평문은 호출부에서 즉시 발송 후 폐기 */
export function generateResetCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * 상수 시간화용 더미 bcrypt 작업 (D2 — 사용자 열거 타이밍 사이드채널 방어).
 * 미적격(미존재·Zalo 미연결) 분기에서도 적격 경로의 bcrypt.hash(코드, 10)와 동일한
 * CPU 비용을 1회 수행해 응답 시간 차이를 없앤다. 결과는 사용·반환하지 않고 폐기.
 */
export async function dummyBcryptWork(): Promise<void> {
  // 적격 경로 issueResetToken의 bcrypt.hash(code, 10)와 동일 라운드.
  await bcrypt.hash(generateResetCode(), 10);
}

/**
 * 코드 발급 — 기존 미사용 토큰 무효화 후 새 토큰 1건 생성.
 * 평문 코드는 반환하지 않는다(호출부에서 발송용으로 generateResetCode 결과를 직접 보유).
 */
export async function issueResetToken(userId: string, code: string): Promise<void> {
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + RESET_CODE_TTL_MS);
  await prisma.$transaction(async (tx) => {
    // 같은 user의 미사용 토큰 무효화(사용 처리) — 동시 다발 코드 방지
    await tx.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });
    await tx.passwordResetToken.create({
      data: { userId, codeHash, expiresAt },
    });
  });
}

export type VerifyResetResult =
  | { ok: true; tokenId: string }
  | { ok: false; reason: "NO_TOKEN" | "EXPIRED" | "TOO_MANY_ATTEMPTS" | "WRONG_CODE" };

/**
 * 코드 검증 — 최신 미사용·미만료 토큰 1건 조회. attempts 상한 검사 후 bcrypt.compare.
 * 불일치 시 attempts++. 평문 코드는 로그/응답 어디에도 남기지 않는다.
 */
export async function verifyResetCode(userId: string, code: string): Promise<VerifyResetResult> {
  const token = await prisma.passwordResetToken.findFirst({
    where: { userId, usedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, codeHash: true, expiresAt: true, attempts: true },
  });
  if (!token) return { ok: false, reason: "NO_TOKEN" };

  if (token.expiresAt.getTime() < Date.now()) {
    return { ok: false, reason: "EXPIRED" };
  }
  if (token.attempts >= RESET_MAX_ATTEMPTS) {
    // 상한 도달 — 토큰 폐기(usedAt 세팅)
    await prisma.passwordResetToken.update({
      where: { id: token.id },
      data: { usedAt: new Date() },
    });
    return { ok: false, reason: "TOO_MANY_ATTEMPTS" };
  }

  const match = await bcrypt.compare(code, token.codeHash);
  if (!match) {
    const nextAttempts = token.attempts + 1;
    await prisma.passwordResetToken.update({
      where: { id: token.id },
      // 상한 도달 시 즉시 폐기(usedAt) — 추가 추측 차단
      data:
        nextAttempts >= RESET_MAX_ATTEMPTS
          ? { attempts: nextAttempts, usedAt: new Date() }
          : { attempts: nextAttempts },
    });
    return { ok: false, reason: "WRONG_CODE" };
  }

  return { ok: true, tokenId: token.id };
}

/** Zalo 발송용 코드 안내 문구 (vi 기본 + ko 병기). 평문 코드 포함 — 로그 금지. */
export function buildResetCodeMessage(code: string): string {
  return [
    `🔑 Mã đặt lại mật khẩu Villa Go: ${code}`,
    `Mã có hiệu lực trong 10 phút. Không chia sẻ mã này cho bất kỳ ai.`,
    ``,
    `🔑 Villa Go 비밀번호 재설정 코드: ${code}`,
    `10분간 유효합니다. 코드를 타인에게 공유하지 마세요.`,
  ].join("\n");
}
