// 여권·서명 PII 보존정책 cron 진입점 (보안 P1-S3)
// 인증: Authorization: Bearer ${CRON_SECRET} — 타 cron과 동일 패턴. Railway cron 등록은 OPS(예: 매일 1회).
// 보존기간(90일)을 넘긴 비공개 passports 파일을 purge하고, 삭제가 있으면 SecurityEvent 기록.
import { purgeExpiredPassports, PASSPORT_RETENTION_DAYS } from "@/lib/passport-retention";
import { recordSecurityEvent } from "@/lib/security-event";
import { verifyCronAuth } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

async function handle(req: Request) {
  const auth = verifyCronAuth(req, "cleanup-passports");
  if (!auth.ok) return Response.json(auth.body, { status: auth.status });

  try {
    const result = await purgeExpiredPassports(new Date(), PASSPORT_RETENTION_DAYS);
    if (result.deleted > 0) {
      await recordSecurityEvent({
        type: "PII_PURGE", // 보존정책 실행 기록(파일명 미포함 — 건수만)
        path: "/cron/cleanup-passports",
        meta: { retentionDays: PASSPORT_RETENTION_DAYS, ...result },
      });
      console.log(`[cron/cleanup-passports] purged ${result.deleted}/${result.scanned}`);
    }
    return Response.json({ ok: true, ...result });
  } catch (e) {
    console.error("[cron/cleanup-passports] 실패:", e instanceof Error ? e.message : String(e));
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
