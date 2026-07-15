// DB 자동 백업 cron 진입점 (T-db-backup-automation)
// 인증: Authorization: Bearer ${CRON_SECRET} — 타 cron과 동일 패턴(첫 줄 게이트, 무인증 401).
// 흐름: 전 모델 JSON 스냅샷 → gzip → 프라이빗 R2 버킷 업로드 → 보존 pruning → 요약 JSON.
//
// ★ 저장소 격리: 백업엔 여권·원가·마진이 포함되므로 **공개 이미지 버킷(STORAGE_BUCKET_NAME) 사용 금지**.
//   반드시 전용 프라이빗 버킷(BACKUP_BUCKET_NAME). 미설정 시 즉시 500(무단 폴백 없음).
//   자격증명은 BACKUP_* 우선 + STORAGE_* 폴백(기존 R2 토큰이 버킷 스코프면 새 토큰 필요 — 런북 참조).
//
// ⚠ 규모: 현 실DB ≈23MB(gzip 전). 스냅샷 전 행을 메모리에 적재하므로 수십 MB까지는 스트리밍 불필요.
//   수백 MB 이상으로 커지면 lib/db-snapshot 주석의 커서 페치 전환 필요.
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { gzipSync } from "node:zlib";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";
import { snapshotAllModels, serializeSnapshot, selectKeysToPrune } from "@/lib/db-snapshot";
import { enqueueInAppForOperators } from "@/lib/inapp-notification";
import { recordSecurityEvent } from "@/lib/security-event";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 스냅샷+업로드 여유(현 규모 수 초, 성장 대비 상한)

// 보존 정책 — cron 실행 시 초과분 삭제.
const DAILY_KEEP = 14;
const MONTHLY_KEEP = 12;

interface BackupR2 {
  client: S3Client;
  bucket: string;
}

/** 백업 전용 R2 구성 — 자격증명 BACKUP_* 우선 + STORAGE_* 폴백, 버킷은 BACKUP_BUCKET_NAME 필수. */
function getBackupR2(): BackupR2 | { error: string } {
  const bucket = process.env.BACKUP_BUCKET_NAME;
  // 버킷 미설정 = 즉시 실패(공개 버킷 폴백 절대 금지 — 여권·원가·마진 보호).
  if (!bucket) return { error: "BACKUP_BUCKET_NAME missing" };

  const accountId = process.env.BACKUP_ACCOUNT_ID ?? process.env.STORAGE_ACCOUNT_ID;
  const accessKeyId = process.env.BACKUP_ACCESS_KEY_ID ?? process.env.STORAGE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.BACKUP_SECRET_ACCESS_KEY ?? process.env.STORAGE_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    return { error: "R2 credentials missing (BACKUP_*/STORAGE_*)" };
  }

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return { client, bucket };
}

/** 특정 prefix의 객체를 나열해 보존 초과분 삭제. @returns 삭제한 객체 수. */
async function pruneBucketPrefix(
  client: S3Client,
  bucket: string,
  prefix: string,
  keep: number
): Promise<number> {
  const listed = await client.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix })
  );
  const keys = (listed.Contents ?? [])
    .map((o) => o.Key)
    .filter((k): k is string => typeof k === "string");
  // ListObjectsV2는 응답당 최대 1000키(미페이지네이션) — 보존 14/12 규모에선 초과할 수 없어 무해.
  const toPrune = selectKeysToPrune(keys, keep);
  for (const Key of toPrune) {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key }));
  }
  return toPrune.length;
}

/**
 * 실패 사유 살균 — DATABASE_URL 형태(postgresql://…) 연결 문자열을 마스킹하고 120자로 절단(P2-3).
 * 예외 메시지에 연결 문자열·자격증명이 섞여 나올 수 있어, 감사·인앱 노출 전에 방어적으로 제거한다.
 */
function sanitizeReason(reason: string): string {
  const masked = reason.replace(/postgres(?:ql)?:\/\/\S*/gi, "postgresql://***masked***");
  return masked.slice(0, 120);
}

/** 백업 실패 경보 — ZALO_OPERATOR_NOTIFY_PAUSED와 무관하게 발송되는 장애 축(인앱 직접 적재 + 감사). */
async function alertBackupFailure(reason: string): Promise<void> {
  const short = sanitizeReason(reason);
  // ① 인앱 — 운영자 전원(enqueueInAppForOperators는 pause 스위치를 거치지 않는 DB 직접 적재 경로).
  try {
    await enqueueInAppForOperators({
      type: "DB_BACKUP_FAILED",
      title: "⚠️ DB 자동 백업 실패",
      body: `일일 DB 백업 cron이 실패했습니다. 사유: ${short}\nRailway Cron Runs 로그를 확인하세요.`,
      href: "/dashboard",
    });
  } catch (e) {
    console.error("[cron/db-backup] 실패 경보(인앱) 적재 실패:", e instanceof Error ? e.message : String(e));
  }
  // ② SecurityEvent 감사 기록(recordSecurityEvent는 자체 try/catch로 삼킴 — 민감값 미포함).
  await recordSecurityEvent({ type: "BACKUP_FAIL", path: "/cron/db-backup", meta: { reason: short } });
}

async function handle(req: Request) {
  const auth = verifyCronAuth(req, "db-backup");
  if (!auth.ok) return Response.json(auth.body, { status: auth.status });

  const r2 = getBackupR2();
  if ("error" in r2) {
    // 저장소 미구성 = 백업 불가. 무단 폴백 없이 명시적 500(Railway Cron Runs에 실패 표시).
    console.error(`[cron/db-backup] 구성 오류: ${r2.error}`);
    await alertBackupFailure(`구성 오류: ${r2.error}`);
    return Response.json({ status: "error", reason: r2.error }, { status: 500 });
  }

  try {
    // 1. 스냅샷 → 직렬화 → gzip
    const { dump, modelCount, rowCount } = await snapshotAllModels(prisma);
    const json = serializeSnapshot(dump);
    const gz = gzipSync(Buffer.from(json, "utf8"));

    // 2. 키 — 날짜는 UTC. 같은 날 재실행 시 같은 키 덮어쓰기(멱등, 기존 cron 규약).
    const now = new Date();
    const ymd = now.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
    const dailyKey = `daily/villa-pms-${ymd}.json.gz`;

    await r2.client.send(
      new PutObjectCommand({
        Bucket: r2.bucket,
        Key: dailyKey,
        Body: gz,
        ContentType: "application/gzip",
      })
    );

    // 3. 매월 1일(UTC)이면 같은 바이트를 monthly/에도 보관(장기 보존).
    let monthlyKey: string | null = null;
    if (now.getUTCDate() === 1) {
      monthlyKey = `monthly/villa-pms-${ymd.slice(0, 7)}.json.gz`; // YYYY-MM
      await r2.client.send(
        new PutObjectCommand({
          Bucket: r2.bucket,
          Key: monthlyKey,
          Body: gz,
          ContentType: "application/gzip",
        })
      );
    }

    // 4. pruning — daily 14개·monthly 12개 초과분 삭제.
    const prunedDaily = await pruneBucketPrefix(r2.client, r2.bucket, "daily/", DAILY_KEEP);
    const prunedMonthly = await pruneBucketPrefix(r2.client, r2.bucket, "monthly/", MONTHLY_KEEP);

    console.log(
      `[cron/db-backup] ${modelCount}모델 ${rowCount}행 · ${gz.length}B → ${dailyKey}` +
        `${monthlyKey ? ` (+${monthlyKey})` : ""} · pruned ${prunedDaily + prunedMonthly}`
    );

    return Response.json({
      status: "ok",
      models: modelCount,
      rows: rowCount,
      bytes: gz.length,
      key: dailyKey,
      monthlyKey,
      pruned: prunedDaily + prunedMonthly,
    });
  } catch (e) {
    // 상세 메시지는 서버 로그로만(연결 문자열·자격증명 유출 방지). 응답은 cleanup-passports와 대칭으로 일반화.
    const reason = e instanceof Error ? e.message : String(e);
    console.error("[cron/db-backup] 실패:", reason);
    await alertBackupFailure(reason); // 감사·인앱은 sanitizeReason으로 마스킹·절단
    return Response.json({ status: "error", reason: "internal_error" }, { status: 500 });
  }
}

export { handle as GET, handle as POST };
