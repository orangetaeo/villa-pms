// Nike↔villa Zalo 통합 S3 — 과거 대화·첨부 ETL (ADR-0010 그룹 C, 계약 zalo-integration-s3.md)
//
// 일회성 운영자 수동 실행 ETL. Nike(원천)→villa(정본) 단방향·멱등.
//   npx tsx scripts/etl-nike-zalo.ts [--dry-run] [--limit N] [--attachments-only]
//
// 소스: Nike PostgreSQL(env NIKE_DATABASE_URL, 읽기 전용) — 별도 PrismaClient(datasourceUrl)로
//       raw SQL read만(write/delete 0). credentials 컬럼은 select 안 함.
// 타깃: villa DB(lib/prisma) 쓰기 + 첨부 villa 저장소(R2/디스크) 업로드.
//
// 범위(절대): 테오 단일 accountId AND threadType="user"(그룹 skip — S4). villa 스키마 무변경.
// 보안: Nike read only, NIKE_DATABASE_URL 값 로그 미출력, credential·마진 비참조.
//
// 의존성: @prisma/client(villa + Nike datasourceUrl raw), @aws-sdk/client-s3, node fs/path — 신규 deps 0.
//         (Nike 전용 pg 클라이언트 대신 PrismaClient datasourceUrl + $queryRawUnsafe로 pg 의존 회피)

import { promises as fs } from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import {
  ZaloMessageDirection,
  ZaloMessageSource,
  ZaloMessageStatus,
  ZaloCounterpartyType,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSystemBotOwnerId } from "@/lib/zalo-credentials";

// ===================== CLI 옵션 =====================
interface Options {
  dryRun: boolean;
  limit: number | null; // 스레드 수 상한(검증용). null=전체
  attachmentsOnly: boolean; // 본문 이관 skip, 첨부만 재시도
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { dryRun: false, limit: null, attachmentsOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--attachments-only") opts.attachmentsOnly = true;
    else if (a === "--limit") {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n <= 0) {
        console.error(`[ETL] --limit 값이 올바르지 않습니다: ${argv[i]}`);
        process.exit(1);
      }
      opts.limit = Math.floor(n);
    } else if (a.startsWith("--limit=")) {
      const n = Number(a.slice("--limit=".length));
      if (!Number.isFinite(n) || n <= 0) {
        console.error(`[ETL] --limit 값이 올바르지 않습니다: ${a}`);
        process.exit(1);
      }
      opts.limit = Math.floor(n);
    } else {
      console.error(`[ETL] 알 수 없는 인자: ${a}`);
      process.exit(1);
    }
  }
  return opts;
}

// ===================== Nike DB 접근 (읽기 전용, raw SQL) =====================
// pg 패키지 신규 도입 회피: villa @prisma/client를 datasourceUrl=NIKE_DATABASE_URL로 인스턴스화하고
// $queryRawUnsafe로 Nike 테이블(PascalCase, @map 없음)을 직접 read. write 메서드 일절 호출 안 함.
//
// credentials 컬럼은 어떤 SELECT에도 포함하지 않는다(이관 대상 아님 — ADR-0010 ④).

interface NikeThreadRow {
  id: string;
  zaloThreadId: string;
  displayName: string;
  avatar: string;
  threadType: string;
}

interface NikeMessageRow {
  id: string;
  zaloMsgId: string;
  globalMsgId: string | null;
  direction: string; // "sent" | "received"
  text: string | null;
  translatedText: string | null;
  msgType: string;
  timestamp: Date;
  cliMsgId: string | null;
  quoteText: string | null;
  quoteSender: string | null;
  quoteMsgId: string | null; // = globalMsgId 체계
}

interface NikeAttachmentRow {
  id: string;
  messageId: string;
  type: string;
  originalUrl: string | null;
  thumbData: Buffer | null;
  fileName: string | null;
  mimeType: string | null;
  ocrTranslatedText: string | null;
}

interface NikeReactionRow {
  messageId: string;
  icon: string;
}

function makeNikeClient(url: string): PrismaClient {
  // datasourceUrl: 스키마는 villa 것이지만 raw SQL은 연결된 DB에 그대로 실행된다.
  return new PrismaClient({ datasourceUrl: url });
}

// ===================== villa 저장소 — 키 지정 R2 업로드 헬퍼 (storage.ts 미수정) =====================
// storage.ts의 getR2Config/getR2Client는 export되지 않으므로 동일 STORAGE_* env를 로컬에서 읽어
// 고정 키 업로드(putAttachmentByKey)를 구현. (storage.ts 설정 패턴 차용 — 파일 수정 0)
// 과거 데이터 영구보존 목적이라 MIME 화이트리스트는 완화(octet-stream 허용).

interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicUrl: string;
}

function getR2Config(): R2Config | null {
  const {
    STORAGE_ACCOUNT_ID: accountId,
    STORAGE_ACCESS_KEY_ID: accessKeyId,
    STORAGE_SECRET_ACCESS_KEY: secretAccessKey,
    STORAGE_BUCKET_NAME: bucket,
    STORAGE_PUBLIC_URL: publicUrl,
  } = process.env;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicUrl) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket, publicUrl: publicUrl.replace(/\/$/, "") };
}

let _r2Client: S3Client | null = null;
function getR2Client(cfg: R2Config): S3Client {
  _r2Client ??= new S3Client({
    region: "auto",
    endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
  return _r2Client;
}

// 디스크 모드 폴백 (R2 미설정 시) — saveFile과 동일하게 UPLOAD_DIR/public/uploads.
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? path.join(process.cwd(), "public", "uploads");
function villaPublicBase(): string {
  return (
    process.env.VILLA_PUBLIC_BASE_URL ||
    process.env.STORAGE_PUBLIC_URL ||
    process.env.NEXTAUTH_URL ||
    ""
  ).replace(/\/$/, "");
}

/**
 * 고정 키로 첨부 업로드 — 존재 시 skip(멱등). 반환은 villa 절대 URL.
 * R2: HeadObject로 존재 확인 → 있으면 재업로드 0. 디스크: 파일 존재 확인.
 * @returns { url, uploaded } uploaded=false면 기존 객체 재사용(skip)
 */
async function putAttachmentByKey(
  buffer: Buffer,
  mimeType: string,
  key: string,
  dryRun: boolean
): Promise<{ url: string; uploaded: boolean }> {
  const r2 = getR2Config();
  const ct = mimeType || "application/octet-stream";

  if (r2) {
    const client = getR2Client(r2);
    const absUrl = `${r2.publicUrl}/${key}`;
    // 멱등: 존재하면 재업로드 skip
    try {
      await client.send(new HeadObjectCommand({ Bucket: r2.bucket, Key: key }));
      return { url: absUrl, uploaded: false };
    } catch {
      /* 없음 — 업로드 진행 */
    }
    if (dryRun) return { url: absUrl, uploaded: false };
    await client.send(
      new PutObjectCommand({
        Bucket: r2.bucket,
        Key: key,
        Body: buffer,
        ContentType: ct,
        CacheControl: "public, max-age=31536000, immutable",
      })
    );
    return { url: absUrl, uploaded: true };
  }

  // 디스크 모드 — 키의 슬래시는 하위 디렉터리. URL은 villa 절대 base + /uploads/<key>.
  const safeKey = key.replace(/\\/g, "/");
  const diskPath = path.join(UPLOAD_DIR, ...safeKey.split("/"));
  const base = villaPublicBase();
  const url = `${base}/uploads/${safeKey}`;
  try {
    await fs.access(diskPath);
    return { url, uploaded: false }; // 존재 — skip
  } catch {
    /* 없음 — 쓰기 */
  }
  if (dryRun) return { url, uploaded: false };
  await fs.mkdir(path.dirname(diskPath), { recursive: true });
  await fs.writeFile(diskPath, buffer);
  return { url, uploaded: true };
}

// ===================== 매핑 헬퍼 (계약 ② 매핑표) =====================

/** Nike direction → villa direction/source. */
function mapDirection(dir: string): {
  direction: ZaloMessageDirection;
  source: ZaloMessageSource;
} {
  if (dir === "sent") {
    return { direction: ZaloMessageDirection.OUTBOUND, source: ZaloMessageSource.CHAT };
  }
  return { direction: ZaloMessageDirection.INBOUND, source: ZaloMessageSource.USER };
}

/** Nike msgType → villa 컨벤션(image→photo, 그 외 동일). */
function mapMsgType(t: string): string {
  return t === "image" ? "photo" : t;
}

/** type별 MIME 유추(없을 때). 과거 데이터 보존 — 미상은 octet-stream. */
function guessMime(type: string, fileName: string | null): string {
  if (fileName) {
    const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase();
    const map: Record<string, string> = {
      jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
      gif: "image/gif", heic: "image/heic", mp4: "video/mp4", mov: "video/quicktime",
      m4a: "audio/mp4", aac: "audio/aac", pdf: "application/pdf",
    };
    if (ext && map[ext]) return map[ext];
  }
  if (type === "image") return "image/jpeg";
  if (type === "video") return "video/mp4";
  if (type === "voice") return "audio/mp4";
  return "application/octet-stream";
}

/** originalUrl HTTP GET → Buffer. 4xx/5xx/타임아웃은 throw(폴백 트리거). */
async function fetchOriginal(url: string, timeoutMs = 20000): Promise<Buffer> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } finally {
    clearTimeout(t);
  }
}

// 동시성 제한 풀 (첨부 업로드 — 저장소 부하 통제, 기본 4).
async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let idx = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const cur = items[idx++];
      await worker(cur);
    }
  });
  await Promise.all(runners);
}

// ===================== 집계 카운터 =====================
const stats = {
  threadsTotal: 0,
  threadsUser: 0,
  threadsGroupSkipped: 0,
  conversationsUpserted: 0,
  messagesProcessed: 0,
  messagesInserted: 0,
  messagesSkipped: 0, // 멱등 중복
  messagesFailed: 0,
  quoteLinked: 0,
  quoteUnresolved: 0,
  ocrBackfilled: 0,
  attachTotal: 0,
  attachOriginal: 0,
  attachThumbFallback: 0,
  attachFailed: 0,
  attachSkippedExisting: 0,
  attachNoSource: 0,
};

// ===================== 메인 =====================

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.log("=== Nike↔villa Zalo S3 ETL ===");
  console.log(
    `옵션: dry-run=${opts.dryRun} attachments-only=${opts.attachmentsOnly} limit=${opts.limit ?? "전체"}`
  );

  // --- env 가드 (크래시 금지, 명확 안내 후 안전 종료) ---
  const nikeUrl = process.env.NIKE_DATABASE_URL;
  if (!nikeUrl) {
    console.error(
      "\n[ETL] 환경변수 NIKE_DATABASE_URL 이(가) 설정되지 않았습니다.\n" +
        "      Nike PostgreSQL(읽기 전용 권장)의 연결 문자열을 설정한 뒤 다시 실행하세요.\n" +
        "      예) .env 또는 Railway 변수에 NIKE_DATABASE_URL=postgresql://... 추가.\n" +
        "      (값은 로그에 출력되지 않습니다.)"
    );
    process.exit(1); // 안전 종료 — DB 연결 시도 0
  }
  const nikeTheoUserId = process.env.NIKE_THEO_USER_ID || "cmmdavtkx00001dqytx9v1ss2";

  // --- 테오 식별 (하드코딩 금지) ---
  const ownerAdminId = await getSystemBotOwnerId();
  if (!ownerAdminId) {
    console.error(
      "[ETL] villa SYSTEM_BOT 소유자(테오)를 해석하지 못했습니다(getSystemBotOwnerId=null).\n" +
        "      활성 SYSTEM_BOT ZaloAccount가 있어야 합니다 — 이관 중단(테오 스코프 보장)."
    );
    process.exit(1);
  }
  console.log(`villa ownerAdminId(테오): ${ownerAdminId}`);

  const nike = makeNikeClient(nikeUrl);

  try {
    // --- Nike 테오 accountId 조회 (credentials 미select) ---
    const accountRows = await nike.$queryRawUnsafe<{ id: string }[]>(
      `SELECT "id" FROM "ZaloAccount" WHERE "userId" = $1 LIMIT 1`,
      nikeTheoUserId
    );
    if (accountRows.length === 0) {
      console.error(
        `[ETL] Nike에서 테오 ZaloAccount를 찾지 못했습니다(userId=${nikeTheoUserId}).\n` +
          "      NIKE_THEO_USER_ID 를 확인하세요 — 이관 중단."
      );
      process.exit(1);
    }
    const nikeAccountId = accountRows[0].id;
    console.log(`Nike 테오 accountId: ${nikeAccountId}`);

    // --- USER 스레드 조회 (그룹 skip) ---
    const allThreads = await nike.$queryRawUnsafe<(NikeThreadRow & { threadType: string })[]>(
      `SELECT "id", "zaloThreadId", "displayName", "avatar", "threadType"
       FROM "ZaloThread" WHERE "accountId" = $1`,
      nikeAccountId
    );
    stats.threadsTotal = allThreads.length;
    let userThreads = allThreads.filter((t) => t.threadType === "user");
    stats.threadsGroupSkipped = allThreads.length - userThreads.length;
    if (opts.limit != null) userThreads = userThreads.slice(0, opts.limit);
    stats.threadsUser = userThreads.length;
    console.log(
      `Nike 스레드: 전체 ${stats.threadsTotal} / user ${userThreads.length} / group skip ${stats.threadsGroupSkipped}`
    );

    // globalMsgId → villa zaloMsgId 사전 (quote 2-pass용). villa zaloMsgId = Nike zaloMsgId 그대로.
    const globalToZaloMsgId = new Map<string, string>();
    // 본 실행에서 본문 삽입/존재가 확인된 메시지의 quote 처리 큐.
    interface QuotePending {
      zaloMsgId: string; // 인용하는 메시지 자신
      quoteGlobalMsgId: string; // 인용 대상(globalMsgId 체계)
    }
    const quotePending: QuotePending[] = [];
    // 첨부 처리 큐 — 본문 삽입 후 일괄(동시성 제한).
    interface AttachJob {
      zaloMsgId: string;
      attachments: NikeAttachmentRow[];
    }
    const attachJobs: AttachJob[] = [];

    for (const thread of userThreads) {
      // --- C1: 대화 upsert (멱등 키 (ownerAdminId, zaloUserId)) ---
      if (!opts.attachmentsOnly && !opts.dryRun) {
        await prisma.zaloConversation.upsert({
          where: {
            ownerAdminId_zaloUserId: { ownerAdminId, zaloUserId: thread.zaloThreadId },
          },
          update: {}, // 메타는 메시지 삽입 후 재계산
          create: {
            ownerAdminId,
            zaloUserId: thread.zaloThreadId,
            displayName: thread.displayName?.trim() ? thread.displayName : null,
            avatarUrl: thread.avatar?.trim() ? thread.avatar : null,
            counterpartyType: ZaloCounterpartyType.UNKNOWN,
            unreadCount: 0,
            userId: null,
            // translateMode 는 스키마 @default(VI)
          },
        });
      }
      stats.conversationsUpserted++;

      const conversation =
        opts.dryRun || opts.attachmentsOnly
          ? await prisma.zaloConversation.findUnique({
              where: { ownerAdminId_zaloUserId: { ownerAdminId, zaloUserId: thread.zaloThreadId } },
              select: { id: true },
            })
          : await prisma.zaloConversation.findUniqueOrThrow({
              where: { ownerAdminId_zaloUserId: { ownerAdminId, zaloUserId: thread.zaloThreadId } },
              select: { id: true },
            });

      // --- 메시지 조회 (createdAt=timestamp 순) ---
      const messages = await nike.$queryRawUnsafe<NikeMessageRow[]>(
        `SELECT "id", "zaloMsgId", "globalMsgId", "direction", "text", "translatedText",
                "msgType", "timestamp", "cliMsgId", "quoteText", "quoteSender", "quoteMsgId"
         FROM "ZaloMessage" WHERE "threadId" = $1 ORDER BY "timestamp" ASC`,
        thread.id
      );

      // 첨부·리액션 일괄 조회 (메시지 id 기준) — Nike read only.
      const msgIds = messages.map((m) => m.id);
      const attByMsg = new Map<string, NikeAttachmentRow[]>();
      const reactByMsg = new Map<string, Map<string, number>>();
      if (msgIds.length > 0) {
        const atts = await nike.$queryRawUnsafe<NikeAttachmentRow[]>(
          `SELECT "id", "messageId", "type", "originalUrl", "thumbData", "fileName",
                  "mimeType", "ocrTranslatedText"
           FROM "ZaloAttachment" WHERE "messageId" = ANY($1::text[])
           ORDER BY "messageId", "createdAt" ASC`,
          msgIds
        );
        for (const a of atts) {
          const arr = attByMsg.get(a.messageId) ?? [];
          arr.push(a);
          attByMsg.set(a.messageId, arr);
        }
        const reacts = await nike.$queryRawUnsafe<NikeReactionRow[]>(
          `SELECT "messageId", "icon" FROM "ZaloReaction" WHERE "messageId" = ANY($1::text[])`,
          msgIds
        );
        for (const r of reacts) {
          const m = reactByMsg.get(r.messageId) ?? new Map<string, number>();
          m.set(r.icon, (m.get(r.icon) ?? 0) + 1);
          reactByMsg.set(r.messageId, m);
        }
      }

      // --- 1-pass: 메시지 삽입 + 사전 구축 ---
      for (const msg of messages) {
        stats.messagesProcessed++;
        // 사전: villa zaloMsgId = Nike zaloMsgId 그대로
        if (msg.globalMsgId) globalToZaloMsgId.set(msg.globalMsgId, msg.zaloMsgId);

        const msgAtts = attByMsg.get(msg.id) ?? [];

        // 첨부 작업 등록 (본문 이관·재시도 양쪽에서 필요)
        if (msgAtts.length > 0) attachJobs.push({ zaloMsgId: msg.zaloMsgId, attachments: msgAtts });

        // attachments-only 모드: 본문 삽입 skip(첨부만 사후 보강)
        if (opts.attachmentsOnly) continue;

        const { direction, source } = mapDirection(msg.direction);
        const reactionsMap = reactByMsg.get(msg.id);
        const reactions =
          reactionsMap && reactionsMap.size > 0 ? Object.fromEntries(reactionsMap) : null;

        // H2 보강: 첨부 ocrTranslatedText가 있고 메시지 translatedText가 비면 보강(덮어쓰기 금지)
        let translatedText = msg.translatedText?.trim() ? msg.translatedText : null;
        if (!translatedText) {
          const ocr = msgAtts.find((a) => a.ocrTranslatedText?.trim())?.ocrTranslatedText;
          if (ocr) {
            translatedText = ocr;
            stats.ocrBackfilled++;
          }
        }

        // quote 스냅샷 (1-pass에서 채움). quotedMsgId는 2-pass에서 연결.
        const hasQuote = !!(msg.quoteText || msg.quoteSender || msg.quoteMsgId);
        if (hasQuote && msg.quoteMsgId) {
          quotePending.push({ zaloMsgId: msg.zaloMsgId, quoteGlobalMsgId: msg.quoteMsgId });
        }

        if (opts.dryRun) {
          stats.messagesInserted++; // 예상 신규(중복 판정은 본 실행에서)
          continue;
        }

        // 멱등: zaloMsgId 존재 시 skip
        const existing = await prisma.zaloMessage.findUnique({
          where: { zaloMsgId: msg.zaloMsgId },
          select: { id: true },
        });
        if (existing) {
          stats.messagesSkipped++;
          continue;
        }

        try {
          await prisma.zaloMessage.create({
            data: {
              conversationId: conversation!.id,
              direction,
              source,
              msgType: mapMsgType(msg.msgType),
              text: msg.text?.length ? msg.text : null,
              translatedText,
              attachmentUrls: [], // 첨부는 사후 보강 패스에서 채움(멱등 키 업로드)
              zaloMsgId: msg.zaloMsgId,
              cliMsgId: msg.cliMsgId ?? null,
              quotedMsgId: null, // 2-pass에서 연결
              quotedText: msg.quoteText ?? null,
              quotedSender: msg.quoteSender ?? null,
              reactions: reactions ?? undefined,
              status: ZaloMessageStatus.SENT,
              sentBy: direction === ZaloMessageDirection.OUTBOUND ? ownerAdminId : null,
              error: null,
              createdAt: msg.timestamp, // Nike 타임스탬프 명시 set (정렬 보존)
            },
          });
          stats.messagesInserted++;
        } catch (err) {
          stats.messagesFailed++;
          console.error(
            `[ETL] 메시지 삽입 실패 zaloMsgId=${msg.zaloMsgId}:`,
            err instanceof Error ? err.message : String(err)
          );
        }
      }

      // --- 대화 메타 재계산 (본문 이관 모드 + 비-dry-run) ---
      if (!opts.attachmentsOnly && !opts.dryRun && conversation) {
        const agg = await prisma.zaloMessage.aggregate({
          where: { conversationId: conversation.id },
          _max: { createdAt: true },
        });
        const inboundAgg = await prisma.zaloMessage.aggregate({
          where: { conversationId: conversation.id, direction: ZaloMessageDirection.INBOUND },
          _max: { createdAt: true },
        });
        await prisma.zaloConversation.update({
          where: { id: conversation.id },
          data: {
            lastMessageAt: agg._max.createdAt ?? null,
            lastInboundAt: inboundAgg._max.createdAt ?? null,
            unreadCount: 0,
          },
        });
      }
    }

    // --- 2-pass: quote 연결 (사전 해석) ---
    if (!opts.attachmentsOnly) {
      for (const q of quotePending) {
        const resolved = globalToZaloMsgId.get(q.quoteGlobalMsgId);
        if (!resolved) {
          stats.quoteUnresolved++;
          continue; // 스냅샷(quotedText/Sender)은 1-pass에서 채워짐 → 표시 가능
        }
        stats.quoteLinked++;
        if (opts.dryRun) continue;
        // 인용하는 메시지 자신을 zaloMsgId로 찾아 quotedMsgId만 set (멱등 — 동일값 재set no-op)
        await prisma.zaloMessage.updateMany({
          where: { zaloMsgId: q.zaloMsgId },
          data: { quotedMsgId: resolved },
        });
      }
    }

    // --- C2: 첨부 영구보존 (원본 우선 → thumbData 폴백, 동시성 4) ---
    interface AttachFailure {
      zaloMsgId: string;
      index: number;
    }
    const attachFailures: AttachFailure[] = [];

    // 메시지별로 attachmentUrls를 누적해야 하므로 zaloMsgId 단위로 순차 누적(메시지 내부 index는 순서대로).
    await runPool(attachJobs, 4, async (job) => {
      const urls: (string | null)[] = new Array(job.attachments.length).fill(null);
      for (let index = 0; index < job.attachments.length; index++) {
        const att = job.attachments[index];
        stats.attachTotal++;
        const key = `nike-attach/${job.zaloMsgId}/${index}`;
        const mime = att.mimeType || guessMime(att.type, att.fileName);

        let buffer: Buffer | null = null;
        let viaOriginal = false;
        // ① originalUrl 우선
        if (att.originalUrl) {
          try {
            buffer = await fetchOriginal(att.originalUrl);
            viaOriginal = true;
          } catch (err) {
            console.warn(
              `[ETL] originalUrl 실패 → thumb 폴백 zaloMsgId=${job.zaloMsgId}#${index}:`,
              err instanceof Error ? err.message : String(err)
            );
          }
        }
        // ② thumbData 폴백
        if (!buffer && att.thumbData && att.thumbData.length > 0) {
          buffer = Buffer.isBuffer(att.thumbData) ? att.thumbData : Buffer.from(att.thumbData);
        }
        // ③ 둘 다 없음 — skip
        if (!buffer) {
          stats.attachNoSource++;
          console.warn(`[ETL] 첨부 소스 없음 skip zaloMsgId=${job.zaloMsgId}#${index}`);
          continue;
        }

        try {
          const { url, uploaded } = await putAttachmentByKey(buffer, mime, key, opts.dryRun);
          urls[index] = url;
          if (viaOriginal) stats.attachOriginal++;
          else stats.attachThumbFallback++;
          if (!uploaded) stats.attachSkippedExisting++;
        } catch (err) {
          stats.attachFailed++;
          attachFailures.push({ zaloMsgId: job.zaloMsgId, index });
          console.error(
            `[ETL] 첨부 업로드 실패 zaloMsgId=${job.zaloMsgId}#${index}:`,
            err instanceof Error ? err.message : String(err)
          );
        }
      }

      // 메시지 attachmentUrls 갱신 (성공분만, 순서 보존). dry-run은 쓰기 0.
      const ok = urls.filter((u): u is string => !!u);
      if (!opts.dryRun && ok.length > 0) {
        await prisma.zaloMessage.updateMany({
          where: { zaloMsgId: job.zaloMsgId },
          data: { attachmentUrls: ok },
        });
      }
    });

    // --- 첨부 실패 재시도(1회) — 멱등 키라 성공분 skip ---
    if (!opts.dryRun && attachFailures.length > 0) {
      console.log(`[ETL] 첨부 실패 ${attachFailures.length}건 재시도...`);
      const byMsg = new Map<string, AttachJob>();
      for (const job of attachJobs) byMsg.set(job.zaloMsgId, job);
      const retryJobs: AttachJob[] = [];
      const seen = new Set<string>();
      for (const f of attachFailures) {
        if (seen.has(f.zaloMsgId)) continue;
        seen.add(f.zaloMsgId);
        const j = byMsg.get(f.zaloMsgId);
        if (j) retryJobs.push(j);
      }
      await runPool(retryJobs, 4, async (job) => {
        const existing = await prisma.zaloMessage.findUnique({
          where: { zaloMsgId: job.zaloMsgId },
          select: { attachmentUrls: true },
        });
        const urls = existing?.attachmentUrls ? [...existing.attachmentUrls] : [];
        for (let index = 0; index < job.attachments.length; index++) {
          if (urls[index]) continue; // 이미 성공
          const att = job.attachments[index];
          const key = `nike-attach/${job.zaloMsgId}/${index}`;
          const mime = att.mimeType || guessMime(att.type, att.fileName);
          let buffer: Buffer | null = null;
          let viaOriginal = false;
          if (att.originalUrl) {
            try {
              buffer = await fetchOriginal(att.originalUrl);
              viaOriginal = true;
            } catch {
              /* 폴백 */
            }
          }
          if (!buffer && att.thumbData && att.thumbData.length > 0) {
            buffer = Buffer.isBuffer(att.thumbData) ? att.thumbData : Buffer.from(att.thumbData);
          }
          if (!buffer) continue;
          try {
            const { url } = await putAttachmentByKey(buffer, mime, key, false);
            urls[index] = url;
            stats.attachFailed = Math.max(0, stats.attachFailed - 1);
            if (viaOriginal) stats.attachOriginal++;
            else stats.attachThumbFallback++;
          } catch {
            /* 여전히 실패 — 목록 유지 */
          }
        }
        const ok = urls.filter((u): u is string => !!u);
        if (ok.length > 0) {
          await prisma.zaloMessage.updateMany({
            where: { zaloMsgId: job.zaloMsgId },
            data: { attachmentUrls: ok },
          });
        }
      });
    }

    // --- 분량 로그 (silent cap 금지) ---
    printSummary(opts);
  } finally {
    await nike.$disconnect();
    await prisma.$disconnect();
  }
}

function printSummary(opts: Options) {
  console.log("\n=== ETL 요약 ===");
  console.log(`[스레드] 전체=${stats.threadsTotal} user=${stats.threadsUser} group-skip=${stats.threadsGroupSkipped}`);
  console.log(`[대화] upsert=${stats.conversationsUpserted}`);
  console.log(
    `[메시지] 처리=${stats.messagesProcessed} 삽입=${stats.messagesInserted} skip(멱등)=${stats.messagesSkipped} 실패=${stats.messagesFailed}`
  );
  console.log(`[quote] 연결=${stats.quoteLinked} 미해석(스냅샷유지)=${stats.quoteUnresolved}`);
  console.log(`[OCR/STT 보강] translatedText 보강=${stats.ocrBackfilled}`);
  console.log(
    `[첨부] 전체=${stats.attachTotal} original=${stats.attachOriginal} thumb-fallback=${stats.attachThumbFallback} ` +
      `failed=${stats.attachFailed} skip(존재)=${stats.attachSkippedExisting} 소스없음=${stats.attachNoSource}`
  );
  if (opts.dryRun) {
    console.log("\n[DRY-RUN] villa DB·저장소 쓰기 0 — 위 수치는 예상치입니다(중복 판정은 본 실행에서).");
  }
  console.log("=== 완료 ===");
}

main().catch((err) => {
  console.error("[ETL] 치명적 오류:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
