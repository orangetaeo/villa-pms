// POST /api/auth/forgot-password — 비밀번호 자가재설정 1단계: Zalo 6자리 코드 발송.
// 보안: 사용자 열거 방지(존재 여부 무관 동일 200·동일 안내). 평문 코드는 응답/로그/감사로그 미기록.
// 비로그인 허용 경로(middleware public 화이트리스트). rate-limit(phone·IP).
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import {
  normalizePhone,
  generateResetCode,
  issueResetToken,
  buildResetCodeMessage,
  dummyBcryptWork,
} from "@/lib/password-reset";
import { sendBotMessage } from "@/lib/zalo-runtime";

// 한 전화번호 집중 요청 / 한 IP 다계정 스캔 차단 (로그인 한도와 동일 사상)
const FORGOT_PHONE_LIMIT = { max: 5, windowMs: 10 * 60_000 };
const FORGOT_IP_LIMIT = { max: 20, windowMs: 10 * 60_000 };

const schema = z.object({ phone: z.string().min(1) });

// 전화번호 마스킹 — 감사로그용(전체 노출 방지). 끝 3자리만 표시.
function maskPhone(phone: string): string {
  if (phone.length <= 3) return "***";
  return "*".repeat(phone.length - 3) + phone.slice(-3);
}

export async function POST(req: Request) {
  const ip = clientIp(req.headers);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const phone = normalizePhone(parsed.data.phone);

  // rate-limit — 초과 시에도 열거 방지를 위해 동일한 ok 응답으로 마감(타이밍·형태 일치).
  const phoneOk = phone
    ? checkRateLimit(`forgot:phone:${phone}`, FORGOT_PHONE_LIMIT).allowed
    : true;
  const ipOk = ip ? checkRateLimit(`forgot:ip:${ip}`, FORGOT_IP_LIMIT).allowed : true;
  if (!phoneOk || !ipOk) {
    return NextResponse.json({ ok: true, channel: "zalo" });
  }

  // 사용자 조회 — 활성·미삭제만. 존재 여부는 응답으로 노출하지 않는다.
  const user = phone
    ? await prisma.user.findUnique({
        where: { phone },
        select: { id: true, zaloUserId: true, isActive: true, deletedAt: true },
      })
    : null;

  const eligible = !!user && user.isActive && !user.deletedAt && !!user.zaloUserId;

  if (eligible && user) {
    const code = generateResetCode();
    try {
      // bcrypt 해시(라운드 10) — 미적격 경로의 dummyBcryptWork와 동일 CPU 비용.
      await issueResetToken(user.id, code);
      // Zalo 발송은 fire-and-forget — 네트워크 지연이 응답 시간(타이밍 사이드채널)에
      // 섞이지 않도록 await하지 않는다. 즉시 발송(10분 만료 코드라 cron 불가)·best-effort.
      void sendBotMessage(user.zaloUserId!, buildResetCodeMessage(code)).catch(() => {});
      // 감사로그 — 요청 사실만(평문 코드 절대 미기록, 전화번호 마스킹)
      await writeAuditLog({
        userId: user.id,
        action: "UPDATE",
        entity: "User",
        entityId: user.id,
        changes: { passwordResetRequested: { new: maskPhone(phone) } },
      });
    } catch {
      // 발급 실패도 동일 응답(열거·타이밍 방어). 평문 코드는 메모리에만 존재했고 로그 안 함.
    }
  } else {
    // D2 — 상수 시간(사용자 열거 방지): 미적격(미존재·Zalo 미연결) 분기에서도
    // 적격 경로의 bcrypt.hash와 동일한 CPU 비용을 1회 수행해 응답 시간 차이를 없앤다.
    try {
      await dummyBcryptWork();
    } catch {
      // 더미 작업 실패는 무시(응답 형태·코드 동일 유지).
    }
  }

  // 존재/부재·발송 성공/실패 무관 동일 응답. channel은 클라 안내 문구 분기용(존재 직접 노출 아님).
  return NextResponse.json({ ok: true, channel: "zalo" });
}
