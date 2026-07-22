// 빌라 공개 준비 cron (T-seo-s2 앞부분)
// 인증: Authorization: Bearer ${CRON_SECRET} — verifyCronAuth(첫 줄 게이트).
//
// 하는 일 (판매 가능·활성 빌라 대상):
//   ① publicSlug 미발급 → 충돌 없는 슬러그 발급
//   ② description 비어 있음 → Gemini로 소개문 생성(★기존 글은 절대 덮어쓰지 않는다)
//   ③ AppSetting SEO_AUTO_LIST_ON_SELLABLE=1 이고 조건 충족 → publicListed 자동 전환
//
// ★ 이 cron은 ③이 꺼져 있으면 **공개를 켜지 않는다**. 준비만 해두고 노출 결정은 운영자에게 남긴다
//   (기본 off — 자동으로 공개되는 것이 놀라운 동작이기 때문. 켜는 순간부터 무인 운영이 된다).
// ★ 300~400개 확장을 전제로 만든 경로다. 빌라가 늘어도 손이 들지 않는다.
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";
import { writeAuditLog } from "@/lib/audit-log";
import { MIN_PUBLIC_BODY_CHARS, MIN_PUBLIC_PHOTOS } from "@/lib/seo/public-villa";
import {
  PREP_VILLA_SELECT,
  ensureUniquePublicSlug,
  generateVillaDescription,
  toDescriptionFacts,
  evaluatePrep,
  isAutoListEnabled,
} from "@/lib/seo/villa-prep";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** 1회 실행당 소개문 생성 상한 — Gemini 비용·지연 통제. 나머지는 다음 회차에서. */
function descriptionsPerRun(): number {
  const n = parseInt((process.env.SEO_VILLA_DESC_PER_RUN ?? "").trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return 3;
  return Math.min(10, n);
}

async function handle(req: Request) {
  const auth = verifyCronAuth(req, "seo-villa-prep");
  if (!auth.ok) return Response.json(auth.body, { status: auth.status });

  const autoList = await isAutoListEnabled(prisma);
  const villas = await prisma.villa.findMany({
    where: { status: "ACTIVE", isSellable: true },
    select: PREP_VILLA_SELECT,
    orderBy: { createdAt: "asc" },
  });

  const slugged: string[] = [];
  const described: string[] = [];
  const listed: string[] = [];
  const skipped: string[] = [];
  let descBudget = descriptionsPerRun();

  for (const v of villas) {
    // ① 슬러그
    let slug = v.publicSlug;
    if (!slug) {
      slug = await ensureUniquePublicSlug({ id: v.id, name: v.name, nameVi: v.nameVi }, prisma);
      await prisma.villa.update({ where: { id: v.id }, data: { publicSlug: slug } });
      slugged.push(slug);
      await writeAuditLog({
        userId: null,
        action: "UPDATE",
        entity: "Villa",
        entityId: v.id,
        changes: { publicSlug: { old: null, new: slug } },
      });
    }

    // ② 소개문 — 비어 있을 때만. 사람이 쓴 글은 건드리지 않는다.
    const descLen = (v.description ?? "").trim().length;
    if (descLen === 0 && descBudget > 0) {
      descBudget -= 1;
      const gen = await generateVillaDescription(toDescriptionFacts(v));
      if (gen) {
        await prisma.villa.update({ where: { id: v.id }, data: { description: gen.text } });
        described.push(v.name);
        await writeAuditLog({
          userId: null,
          action: "UPDATE",
          entity: "Villa",
          entityId: v.id,
          changes: {
            description: { old: null, new: `${gen.text.length}자 자동 생성` },
            flaggedTerms: { new: gen.flaggedTerms },
          },
        });
      } else {
        skipped.push(`${v.name}: 소개문 생성 실패`);
      }
    } else if (descLen > 0 && descLen < MIN_PUBLIC_BODY_CHARS) {
      // 사람이 짧게 써둔 경우 — 덮어쓰지 않고 운영자에게 알린다(공개 하한 미달).
      skipped.push(`${v.name}: 기존 소개문 ${descLen}자(하한 ${MIN_PUBLIC_BODY_CHARS}자 미달, 미변경)`);
    }

    // ③ 자동 공개 — 스위치가 켜져 있고 조건을 모두 충족할 때만
    if (autoList && !v.publicListed) {
      const fresh = await prisma.villa.findUnique({
        where: { id: v.id },
        select: { status: true, isSellable: true, publicSlug: true, description: true, _count: { select: { photos: true } } },
      });
      if (fresh) {
        const prep = evaluatePrep({
          status: fresh.status,
          isSellable: fresh.isSellable,
          publicSlug: fresh.publicSlug,
          description: fresh.description,
          photoCount: fresh._count.photos,
        });
        if (prep.eligible) {
          await prisma.villa.update({
            where: { id: v.id },
            data: { publicListed: true, publicListedAt: new Date() },
          });
          listed.push(v.name);
          await writeAuditLog({
            userId: null,
            action: "UPDATE",
            entity: "Villa",
            entityId: v.id,
            changes: { publicListed: { old: false, new: true }, reason: { new: "SEO_AUTO_LIST_ON_SELLABLE" } },
          });
        }
      }
    }
  }

  return Response.json({
    ok: true,
    scanned: villas.length,
    autoList,
    slugged,
    described,
    listed,
    skipped,
    thresholds: { minPhotos: MIN_PUBLIC_PHOTOS, minDescriptionChars: MIN_PUBLIC_BODY_CHARS },
  });
}

export const GET = handle;
export const POST = handle;
