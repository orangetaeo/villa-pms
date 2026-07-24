// 가이드 글 초안 생성 cron (T-seo-s3)
// 인증: Authorization: Bearer ${CRON_SECRET} — verifyCronAuth(타 cron 동일 패턴, 첫 줄 게이트).
// 흐름: 미사용 주제 선택 → 공개 빌라 힌트(관문 경유) → Gemini 본문(블록 JSON)
//   → SeoArticle PENDING_APPROVAL 저장 → 운영자 알림 + AuditLog.
//
// ★ 발행하지 않는다. 이 cron은 **승인 대기**까지만 만든다(사람 승인 게이트 = 스팸 정책 방어선).
// ★ 누수 0: 빌라 정보는 lib/seo/public-villa.ts 관문 통과분만, 그중에서도 규모·시설 요약뿐.
// ★ 사진 출처가 글 종류마다 다르다: 빌라 글 = 그 빌라의 실사진, 가이드 글 = **자료 라이브러리 + 공개 빌라 사진 혼합**
//   (/marketing/seo/media, T-seo-media-library / 운영자 결정 2026-07-24). 자료 라이브러리는 비(非)빌라
//   (풍경·장소·먹거리) 전용이 되고, 빌라 사진은 getPublicVillas 관문을 통과한 공개본을 pickGuideImages가 섞는다.
import { SeoArticleStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";
import { writeAuditLog } from "@/lib/audit-log";
import { getPublicVillas, getPublicVillasByIds } from "@/lib/seo/public-villa";
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
  interleaveImages,
  spreadImageGroups,
} from "@/lib/seo/article-draft";
import {
  pickMediaForTopic,
  pickGuideImages,
  toPickedImages,
  markMediaUsed,
  MAX_MEDIA_PER_ARTICLE,
} from "@/lib/seo/media";
import {
  getServiceCandidates,
  generateServiceArticleBody,
  pickServicePhotos,
} from "@/lib/seo/service-article";
import { getPlaceCandidates, placeTopicKey, createPlaceArticleDraft } from "@/lib/seo/place-article";
import {
  getVideoArticleCandidates,
  toVideoArticleShort,
  toVideoArticleVillaContext,
  generateVideoArticleBody,
  composeVideoBody,
  videoTopicKey,
  buildVideoArticleTitle,
} from "@/lib/seo/video-article-draft";
import { ensureWatermarkedUrl } from "@/lib/seo/watermark-server";
import type { SeoArticleCategory } from "@/lib/seo/categories";
import { renderArticleThumbnail } from "@/lib/seo/thumbnail";
import { toArticleHtml } from "@/lib/seo/article-html";

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
          category: "villa" satisfies SeoArticleCategory,
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

    // ── ② 부가서비스 글 — 판매 중인 서비스(마사지·입장권·BBQ …) 타입당 1편 ──
    //   빌라 글 다음 순위인 이유: 팔 상품이 있는데 검색에 걸릴 페이지가 없으면 그게 가장 큰 공백이다.
    //   ★ 카탈로그가 비어 있으면 이 단계는 통째로 no-op — 항목을 등록하는 순간부터 대상이 된다.
    //   ★ 금액은 재료 조회 단계에서부터 배제된다(SERVICE_ITEM_SELECT에 price·cost 없음, 원칙 2).
    const svc = (await getServiceCandidates(usedKeys))[0];
    if (svc) {
      const key = svc.topic.key;
      usedKeys.add(key);
      const sDraft = await generateServiceArticleBody(svc.topic, svc.facts);
      if (!sDraft) {
        skipped.push(`${key}: 생성 실패`);
        continue;
      }
      if (!isArticlePublishable(sDraft.blocks)) {
        skipped.push(`${key}: 분량·구조 하한 미달`);
        continue;
      }
      // 사진: 상품 실사진(카탈로그) 우선, 모자라면 자료 사진 라이브러리에서 주제 태그로 채운다.
      // ★ 사진을 넉넉히 담아(최대 6장) 소제목마다 그리드 갤러리로 흩뿌린다(테오 지적 2026-07-24).
      const SERVICE_PHOTO_MAX = 6;
      const itemPhotos = pickServicePhotos(svc.topic, svc.items, SERVICE_PHOTO_MAX);
      const libMedia = await pickMediaForTopic(key, Math.max(0, SERVICE_PHOTO_MAX - itemPhotos.length));
      const sPhotos = [...itemPhotos, ...toPickedImages(libMedia)];
      const sCover = sPhotos[0]?.url ?? BRAND_FALLBACK_IMAGE;
      const sBody = spreadImageGroups(sDraft.blocks, sPhotos.slice(1));

      const sRow = await prisma.seoArticle.create({
        data: {
          slug: buildArticleSlug(key),
          title: svc.topic.title,
          summary: buildSummary(sDraft.blocks),
          bodyJson: sBody,
          topicKey: key,
          category: "service" satisfies SeoArticleCategory,
          coverPhotoUrl: sCover,
          status: SeoArticleStatus.PENDING_APPROVAL,
          flaggedTerms: sDraft.flaggedTerms.length > 0 ? sDraft.flaggedTerms : undefined,
          createdBy: CREATED_BY,
        },
        select: { id: true, slug: true, title: true },
      });
      created.push(sRow);
      await markMediaUsed(libMedia.map((m) => m.id));
      await writeAuditLog({
        userId: null,
        action: "CREATE",
        entity: "SeoArticle",
        entityId: sRow.id,
        changes: {
          kind: { new: "service" },
          serviceType: { new: svc.topic.type },
          topicKey: { new: key },
          slug: { new: sRow.slug },
          status: { new: "PENDING_APPROVAL" },
          photos: { new: sPhotos.length },
          flaggedTerms: { new: sDraft.flaggedTerms },
        },
      });
      continue;
    }

    // ── ③ 장소 글(맛집·카페·쇼핑) — 등록된 장소 3곳이 모이면 한 편 ──
    //   ★ 유일하게 고갈되지 않는 글감이다(테오가 다닐수록 늘어난다). 그래서 회차로 이어진다.
    //   ★ 등록된 장소만 등장할 수 있다 — 남의 가게는 우리 DB가 사실 원천이 아니라서
    //     AI에게 맡기면 없는 가게를 지어낸다. 사실은 사람이 넣고 문장만 AI가 쓴다.
    const place = (await getPlaceCandidates())[0];
    if (place) {
      const key = placeTopicKey(place.category.key, place.seq);
      usedKeys.add(key);
      // ★ 수동 생성(운영자 버튼)과 **같은 함수**를 쓴다 — 워터마크·썸네일·HTML·중복제거가 한 곳에만 있게.
      //   (예전에는 cron이 자체 구현이라 개선이 한쪽에만 반영되는 사고가 났다.)
      const res = await createPlaceArticleDraft(
        { category: place.category, places: place.places, seq: place.seq, createdBy: CREATED_BY },
        {
          watermark: (photo) =>
            ensureWatermarkedUrl({
              id: (photo as { mediaId?: string }).mediaId ?? "",
              url: photo.url,
              watermarkedUrl: (photo as { watermarkedUrl?: string | null }).watermarkedUrl ?? null,
            }),
          renderThumbnail: renderArticleThumbnail,
          toHtml: (blocks, opts) => toArticleHtml(blocks, opts),
          helpers: {
            isArticlePublishable,
            buildArticleSlug,
            buildSummary,
            interleaveImages,
            brandFallbackImage: BRAND_FALLBACK_IMAGE,
          },
        }
      );
      if (!res.ok) {
        skipped.push(`${key}: ${res.reason}`);
        continue;
      }
      created.push({ id: res.id, slug: res.slug, title: res.title });
      await writeAuditLog({
        userId: null,
        action: "CREATE",
        entity: "SeoArticle",
        entityId: res.id,
        changes: {
          kind: { new: "place" },
          category: { new: place.category.key },
          seq: { new: place.seq },
          topicKey: { new: key },
          slug: { new: res.slug },
          status: { new: "PENDING_APPROVAL" },
          places: { new: place.places.map((p) => p.name) },
          photos: { new: res.photos },
        },
      });
      continue;
    }

    // ── ④ 가이드 글 — 사진은 자료 라이브러리 + 공개 빌라 사진 혼합 ──
    //   ★ 주제가 남았을 때만 가이드를 만들고 continue. 소진되면 break 하지 않고 ⑤(영상 글)로 내려간다.
    const topic = pickTopic(usedKeys);
    if (topic) {
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

    // ★ 가이드 글 사진 = **자료 라이브러리(주제+범용) + 공개 빌라 사진 혼합**(운영자 결정 2026-07-24).
    //   빌라 사진은 업로드 시점에 이미 워터마크가 구워진 파일이라 여기서 재워터마크하지 않는다(pickGuideImages 주석).
    //   둘 다 있으면 최소 각 1장씩 섞고, 한쪽이 비면 나머지로 진행한다. 둘 다 비면 사진 없이 진행하고
    //   커버는 브랜드 이미지로 채운다(공유 썸네일이 비면 CTR이 떨어진다).
    const { images: guideImages, usedMediaIds } = await pickGuideImages(
      topic.key,
      villaPool,
      MAX_MEDIA_PER_ARTICLE
    );
    const guideCover = guideImages[0]?.url ?? BRAND_FALLBACK_IMAGE;
    // 첫 장은 커버로 쓰므로 본문에는 두 번째부터 — 같은 사진 중복 노출 방지(빌라 글과 동일 규칙).
    const guideBody = interleaveImages(draft.blocks, guideImages.slice(1));

    const row = await prisma.seoArticle.create({
      data: {
        slug: buildArticleSlug(topic.key),
        title: topic.title,
        summary: buildSummary(draft.blocks),
        bodyJson: guideBody,
        coverPhotoUrl: guideCover,
        topicKey: topic.key,
        category: "guide" satisfies SeoArticleCategory,
        status: SeoArticleStatus.PENDING_APPROVAL,
        flaggedTerms: draft.flaggedTerms.length > 0 ? draft.flaggedTerms : undefined,
        createdBy: CREATED_BY,
      },
      select: { id: true, slug: true, title: true },
    });
    created.push(row);
    // 사용 기록은 글 저장 성공 뒤에만 — 저장이 실패한 회차가 사진 순번을 소비하면 안 된다.
    //   ★ 최종 선택된 자료 사진만 소비한다(혼합에서 잘린 라이브러리 사진은 건드리지 않는다).
    await markMediaUsed(usedMediaIds);

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
        blocks: { new: guideBody.length },
        photos: { new: guideImages.length },
        libraryPhotos: { new: usedMediaIds.length },
        villaPhotos: { new: guideImages.length - usedMediaIds.length },
      },
    });
      continue;
    }

    // ── ⑤ 영상 글 — 업로드된 실촬영 쇼츠 1건을 개별 영상 글로 (ADR-0049) ──
    //   ★ 최저 우선순위(빌라·서비스·장소·가이드 뒤). 조건 충족 쇼츠가 있으면 실행당 1건 생성한다.
    //   ★ 멱등: topicKey `video-<shortId>` 존재 검사(usedKeys). 기발행 실촬영 쇼츠 자동 백필도 여기서.
    //   ★ 원천 실명 차단: 빌라 컨텍스트는 공개 관문(getPublicVillasByIds) 통과분만 — name/nameVi 부재.
    const shortRow = (await getVideoArticleCandidates(usedKeys, prisma))[0];
    if (!shortRow) {
      skipped.push("영상 글 대상 없음");
      break; // 이 회차에 만들 것이 아무것도 없다
    }
    const vidKey = videoTopicKey(shortRow.id);
    usedKeys.add(vidKey);
    const short = toVideoArticleShort(shortRow);
    // 공개 게이트(PUBLIC_WHERE) 통과 빌라만 — 비공개·비발행 빌라의 영상은 글화하지 않는다.
    const pubVilla = short && shortRow.villaId ? (await getPublicVillasByIds([shortRow.villaId]))[0] : null;
    if (!short || !pubVilla) {
      skipped.push(`${vidKey}: 공개 빌라 아님`);
      continue;
    }
    const vidInput = { villa: toVideoArticleVillaContext(pubVilla), short };
    const vidDraft = await generateVideoArticleBody(vidInput);
    if (!vidDraft) {
      skipped.push(`${vidKey}: 생성 실패`);
      continue;
    }
    // 도입 문단 뒤에 유튜브 임베드(video 블록)를 끼운다. video 블록 title = 쇼츠 제목(실명 무결).
    const vidBody = composeVideoBody(vidDraft.blocks, { ytVideoId: short.ytVideoId, title: short.title });
    if (!isArticlePublishable(parseArticleBody(vidBody), "video")) {
      skipped.push(`${vidKey}: 분량·구조 하한 미달`);
      continue;
    }
    const vidCover = short.posterUrl ?? BRAND_FALLBACK_IMAGE; // coverPhotoUrl = posterUrl(ADR)
    const vidRow = await prisma.seoArticle.create({
      data: {
        slug: buildArticleSlug(vidKey),
        title: buildVideoArticleTitle(vidInput.villa),
        summary: buildSummary(vidDraft.blocks),
        bodyJson: vidBody,
        topicKey: vidKey,
        category: "video" satisfies SeoArticleCategory,
        coverPhotoUrl: vidCover,
        relatedVillaIds: [pubVilla.id],
        status: SeoArticleStatus.PENDING_APPROVAL,
        flaggedTerms: vidDraft.flaggedTerms.length > 0 ? vidDraft.flaggedTerms : undefined,
        createdBy: CREATED_BY,
      },
      select: { id: true, slug: true, title: true },
    });
    created.push(vidRow);
    await writeAuditLog({
      userId: null,
      action: "CREATE",
      entity: "SeoArticle",
      entityId: vidRow.id,
      changes: {
        kind: { new: "video" },
        youtubeShortId: { new: shortRow.id },
        ytVideoId: { new: short.ytVideoId },
        topicKey: { new: vidKey },
        slug: { new: vidRow.slug },
        status: { new: "PENDING_APPROVAL" },
        relatedVillaIds: { new: [pubVilla.id] },
        flaggedTerms: { new: vidDraft.flaggedTerms },
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
