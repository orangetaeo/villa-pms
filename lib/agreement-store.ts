// 이용 동의서 콘텐츠 저장소 — AppSetting(키-값) JSON 기반 (T-admin-agreement-editor).
// 스키마 무변경(병렬 세션 db push/EPERM 위험 회피). 전용 모델 마이그레이션은 후속.
// server 전용 — prisma 직접 접근. 클라이언트는 lib/agreement.ts의 순수 헬퍼만 사용.
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/lib/availability";
import {
  AGREEMENT_CONTENT_KEY,
  AGREEMENT_HISTORY_KEY,
  AGREEMENT_HISTORY_MAX,
  buildDefaultAgreementContent,
  type AgreementContent,
} from "@/lib/agreement";

/** 현재 발행 동의서 콘텐츠 — 미저장/손상 시 코드 기본값 폴백 (체크인 차단 방지) */
export async function getAgreementContent(db: DbClient = prisma): Promise<AgreementContent> {
  const row = await db.appSetting.findUnique({ where: { key: AGREEMENT_CONTENT_KEY } });
  if (!row) return buildDefaultAgreementContent();
  try {
    const parsed = JSON.parse(row.value) as AgreementContent;
    if (parsed && typeof parsed.rev === "number" && parsed.body && parsed.docTitle) {
      return parsed;
    }
  } catch {
    // 손상된 JSON — 기본값 폴백
  }
  return buildDefaultAgreementContent();
}

/** 저장: 직전 발행본을 이력에 append(최대 N) 후 새 발행본 upsert. 서명 시점 문구 추적용 보존. */
export async function saveAgreementContent(db: DbClient, next: AgreementContent): Promise<void> {
  const prev = await db.appSetting.findUnique({ where: { key: AGREEMENT_CONTENT_KEY } });
  if (prev) {
    const histRow = await db.appSetting.findUnique({ where: { key: AGREEMENT_HISTORY_KEY } });
    let history: unknown[] = [];
    try {
      history = histRow ? (JSON.parse(histRow.value) as unknown[]) : [];
      if (!Array.isArray(history)) history = [];
    } catch {
      history = [];
    }
    try {
      history.push(JSON.parse(prev.value));
    } catch {
      // 손상된 직전본은 이력 생략
    }
    if (history.length > AGREEMENT_HISTORY_MAX) {
      history = history.slice(history.length - AGREEMENT_HISTORY_MAX);
    }
    await db.appSetting.upsert({
      where: { key: AGREEMENT_HISTORY_KEY },
      create: { key: AGREEMENT_HISTORY_KEY, value: JSON.stringify(history) },
      update: { value: JSON.stringify(history) },
    });
  }

  await db.appSetting.upsert({
    where: { key: AGREEMENT_CONTENT_KEY },
    create: { key: AGREEMENT_CONTENT_KEY, value: JSON.stringify(next) },
    update: { value: JSON.stringify(next) },
  });
}
