// 가이드 글 초안 생성 cron (T-seo-s3)
// 인증: Authorization: Bearer ${CRON_SECRET} — verifyCronAuth(타 cron 동일 패턴, 첫 줄 게이트).
// 흐름: 미사용 주제 선택 → 공개 빌라 힌트(관문 경유) → Gemini 본문(블록 JSON)
//   → SeoArticle PENDING_APPROVAL 저장 → 운영자 알림 + AuditLog.
//
// ★ 발행하지 않는다. 이 cron은 **승인 대기**까지만 만든다(사람 승인 게이트 = 스팸 정책 방어선).
// ★ 누수 0: 빌라 정보는 lib/seo/public-villa.ts 관문 통과분만, 그중에서도 규모·시설 요약뿐.
import { SeoArticleStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";
import { writeAuditLog } from "@/lib/audit-log";
import { getPublicVillas } from "@/lib/seo/public-villa";
import { isArticlePublishable, parseArticleBody } from "@/lib/seo/article";
import {
  ARTICLE_TOPICS,
  pickTopic,
  buildArticleSlug,
  buildSummary,
  generateArticleBody,
  villaHints,
  BRAND_FALLBACK_IMAGE,
  generateVillaArticleBody,
  villaTopicKey,
  buildVillaArticleTitle,
  pickVillaPhotos,
  composeVillaBody,
} from "@/lib/seo/article-draft";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CREATED_BY = "cron:seo-draft";

/** 1회 실행당 생성할 초안 수 — 기본 1(점진 공급). 과다 생성은 승인 부담만 키운다. */
function draftsPerRun(): number {
  const n = parseInt((process.env.SEO_DRAFTS_PER_RUN ?? "").trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(3, n);
}

async function handle(req: Request) {
  const auth = verifyCronAuth(req, "seo-draft");
  if (!auth.ok) return Response.json(auth.body, { status: auth.status });

  const want = draftsPerRun();
  // 이미 쓴 주제(상태 무관 — 반려된 주제를 즉시 재시도하지 않는다)
  const used = await prisma.seoArticle.findMany({ select: { topicKey: true } });
  const usedKeys = new Set(used.map((r) => r.topicKey));

  // 빌라 힌트·이미지는 공개 관문 경유분만. 실패해도 글 생성은 계속한다(선택 재료).
  let hints: string[] = [];
  let villaPool: Awaited<ReturnType<typeof getPublicVillas>> = [];
  try {
    const villas = await getPublicVillas();
    hints = villaHints(villas);
    // 시드 없이 뽑으면 모든 글이 같은 사진을 쓴다 — 주제별로 아래에서 다시 뽑는다.
    villaPool = villas;
  } catch {
    hints = [];
    villaPool = [];
  }

  const created: { id: string; slug: string; title: string }[] = [];
  const skipped: string[] = [];

  for (let i = 0; i < want; i++) {
    // ── ① 빌라 글 우선 — 사진·영상이 본문과 정확히 맞는 유일한 글 종류 ──
    //   가이드 글에 빌라 사진을 끼우면 본문과 무관한 이미지가 된다(테오 지적 2026-07-22).
    //   사진이 의미를 가지려면 글의 주제가 그 빌라여야 한다.
    const villa = villaPool.find((v) => !usedKeys.has(villaTopicKey(v.slug)));
    if (villa) {
      const key = villaTopicKey(villa.slug);
      usedKeys.add(key);
      const vDraft = await generateVillaArticleBody(villa);
      if (!vDraft) {
        skipped.push(`${key}: 생성 실패`);
        continue;
      }
      const photos = pickVillaPhotos(villa, 4);
      const video = villa.videos[0]
        ? { ytVideoId: villa.videos[0].ytVideoId, title: villa.videos[0].title }
        : null;
      // 첫 사진은 커버(공유 썸네일), 나머지를 본문에 — 같은 사진 중복 노출 방지
      const vCover = photos[0]?.url ?? BRAND_FALLBACK_IMAGE;
      const vBody = composeVillaBody(vDraft.blocks, photos.slice(1), video);
      if (!isArticlePublishable(parseArticleBody(vBody))) {
        skipped.push(`${key}: 분량·구조 하한 미달`);
        continue;
      }
      const vRow = await prisma.seoArticle.create({
        data: {
          slug: buildArticleSlug(key),
          title: buildVillaArticleTitle(villa),
          summary: buildSummary(vDraft.blocks),
          bodyJson: vBody,
          topicKey: key,
          coverPhotoUrl: vCover,
          relatedVillaIds: [villa.id],
          status: SeoArticleStatus.PENDING_APPROVAL,
          flaggedTerms: vDraft.flaggedTerms.length > 0 ? vDraft.flaggedTerms : undefined,
          createdBy: CREATED_BY,
        },
        select: { id: true, slug: true, title: true },
      });
      created.push(vRow);
      await writeAuditLog({
        userId: null,
        action: "CREATE",
        entity: "SeoArticle",
        entityId: vRow.id,
        changes: {
          kind: { new: "villa" },
          topicKey: { new: key },
          slug: { new: vRow.slug },
          status: { new: "PENDING_APPROVAL" },
          photos: { new: photos.length },
          video: { new: video?.ytVideoId ?? null },
          flaggedTerms: { new: vDraft.flaggedTerms },
        },
      });
      continue;
    }

    // ── ② 가이드 글 — ★본문 이미지 없음(주제와 무관한 사진을 끼우지 않는다) ──
    const topic = pickTopic(usedKeys);
    if (!topic) {
      skipped.push("주제 풀 소진");
      break;
    }
    usedKeys.add(topic.key); // 같은 실행 안에서 중복 선택 방지

    const draft = await generateArticleBody(topic, hints);
    if (!draft) {
      // ★ 폴백 템플릿을 쓰지 않는다 — 기계적 글은 그 자체로 얇은 콘텐츠다. 못 만들면 건너뛴다.
      skipped.push(`${topic.key}: 생성 실패`);
      continue;
    }
    if (!isArticlePublishable(draft.blocks)) {
      skipped.push(`${topic.key}: 분량·구조 하한 미달`);
      continue;
    }

    // ★ 가이드 글에는 본문 이미지를 넣지 않는다 — 빌라 사진은 본문 주제와 무관하다.
    //   커버만 브랜드 이미지로 채운다(공유 썸네일·Article.image가 비면 CTR이 떨어진다).

    const row = await prisma.seoArticle.create({
      data: {
        slug: buildArticleSlug(topic.key),
        title: topic.title,
        summary: buildSummary(draft.blocks),
        bodyJson: draft.blocks,
        coverPhotoUrl: BRAND_FALLBACK_IMAGE,
        topicKey: topic.key,
        status: SeoArticleStatus.PENDING_APPROVAL,
        flaggedTerms: draft.flaggedTerms.length > 0 ? draft.flaggedTerms : undefined,
        createdBy: CREATED_BY,
      },
      select: { id: true, slug: true, title: true },
    });
    created.push(row);

    await writeAuditLog({
      userId: null,
      // AuditAction은 6종 고정 union — 신규 액션을 추가하지 않고 CREATE + changes로 표현한다.
      action: "CREATE",
      entity: "SeoArticle",
      entityId: row.id,
      changes: {
        topicKey: { new: topic.key },
        slug: { new: row.slug },
        status: { new: "PENDING_APPROVAL" },
        flaggedTerms: { new: draft.flaggedTerms },
        kind: { new: "guide" },
        blocks: { new: draft.blocks.length },
      },
    });
  }

  // ★ 승인 대기 알림(인앱 벨·Zalo)은 보내지 않는다 — 테오 지시(2026-07-22).
  //   초안은 /marketing/seo 큐에서 직접 확인한다. 알림 종류(SEO_DRAFTS_READY)는 정의만 남겨두고
  //   호출하지 않는다(필요해지면 이 자리에서 되살리면 된다).

  return Response.json({
    ok: true,
    created: created.length,
    slugs: created.map((c) => c.slug),
    skipped,
    topicsTotal: ARTICLE_TOPICS.length,
    topicsUsed: usedKeys.size,
  });
}

export const GET = handle;
export const POST = handle;
