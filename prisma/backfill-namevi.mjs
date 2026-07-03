// prisma/backfill-namevi.mjs — 기존 빌라의 베트남어 병기명(nameVi) 백필 (ADR-0020)
//
// 목적: nameVi가 비어 있던 기존 빌라 때문에 청소부·공급자 화면에 한국어 빌라명이 그대로
//       노출되던 문제(villaNameViOnly 한국어 폴백)를 해소한다. 신규 빌라는 POST /api/villas가
//       생성 시 자동 채우므로, 이 스크립트는 그 이전에 만들어진 빌라만 대상으로 한다.
//
// 실행(라이브 Railway DB — 로컬 .env의 DATABASE_URL·GEMINI_API_KEY 사용):
//   node --env-file=.env prisma/backfill-namevi.mjs        # 실제 적용
//   node --env-file=.env prisma/backfill-namevi.mjs --dry  # 미리보기(쓰기 없음)
//
// 안전: nameVi가 null/빈 문자열인 빌라만 대상(기존 확정값 미접촉). 음역 실패 빌라는 건너뛴다.
//       각 갱신은 AuditLog(UPDATE·note=backfill-namevi)로 기록한다. 값은 되돌릴 수 있다.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DRY = process.argv.includes("--dry");
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

// lib/gemini.ts VILLA_ROMANIZE_PROMPT 와 동일 — 한국어 음역 빌라명 → 라틴/베트남 통용 표기.
const VILLA_ROMANIZE_PROMPT = `You convert a Korean-transliterated villa or resort name in Phú Quốc, Vietnam into its official/internationally-used Latin (Vietnamese-friendly) spelling.

Rules:
- Output ONLY the converted name. No explanation, quotes, labels, or markdown.
- Convert the Korean transliteration of the resort/complex name to its real Latin spelling (e.g. 쏘나씨 → Sonasea, 썬셋 사나토 → Sunset Sanato, 그린베이 → Green Bay, 마리나 → Marina).
- Keep unit/block codes, numbers and Latin segments EXACTLY as given (V11, A3, B2, …).
- If the name is already in Latin (no Korean), return it unchanged.
- If unsure of the official spelling, give the most natural Latin transliteration.
- Preserve overall word order and spacing.

Name:`;

async function romanizeVillaName(name) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY 미설정");
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${VILLA_ROMANIZE_PROMPT} ${trimmed}` }] }],
        generationConfig: { temperature: 0, thinkingConfig: { thinkingBudget: 0 } },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini API HTTP ${res.status}`);
  const data = await res.json();
  return (data.candidates?.[0]?.content?.parts?.[0]?.text ?? "")
    .trim()
    .split("\n")[0]
    .replace(/^["'`]|["'`]$/g, "")
    .trim();
}

async function main() {
  const villas = await prisma.villa.findMany({
    where: { OR: [{ nameVi: null }, { nameVi: "" }] },
    select: { id: true, name: true, nameVi: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(`${DRY ? "[DRY] " : ""}nameVi 미설정 빌라: ${villas.length}채`);

  let updated = 0;
  for (const v of villas) {
    try {
      const romanized = await romanizeVillaName(v.name);
      if (!romanized || romanized === v.name) {
        console.log(`·  스킵  ${v.name}  (음역 결과 없음/동일)`);
        continue;
      }
      if (DRY) {
        console.log(`~  (dry) ${v.name}  →  ${romanized}`);
        updated++;
        continue;
      }
      await prisma.$transaction(async (tx) => {
        await tx.villa.update({ where: { id: v.id }, data: { nameVi: romanized } });
        await tx.auditLog.create({
          data: {
            userId: null,
            action: "UPDATE",
            entity: "Villa",
            entityId: v.id,
            changes: { nameVi: { old: v.nameVi, new: romanized }, note: "backfill-namevi" },
          },
        });
      });
      console.log(`✓  갱신  ${v.name}  →  ${romanized}`);
      updated++;
    } catch (e) {
      console.log(`✗  실패  ${v.name}  —  ${e.message}`);
    }
  }
  console.log(`${DRY ? "[DRY] " : ""}완료: ${updated}/${villas.length}채`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
