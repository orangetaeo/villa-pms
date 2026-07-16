// lib/marketing-notify.ts — 마케팅 자동화 운영자 알림 단일 진입점 (marketing-s2 §D)
//
// 배경: 마케팅 cron(인스타 초안·발행·유튜브 업로드·토큰 갱신·인사이트·직접촬영 편집)의 운영자 통지가
//   그동안 인앱 벨(enqueueInAppForOperators)로만 갔다. 이 모듈이 ① 인앱(기존 동작 유지) ② Zalo 그룹방
//   (MARKETING_ALERT)을 병행 적재하는 단일 지점이다.
//
// 규칙:
//   - 인앱: 벨 기록 — 킬스위치 무관(장애 경보류는 벨에 항상 남긴다, 기존 동작 보존).
//   - Zalo: enqueueOperatorNotification 경유 → ZALO_OPERATOR_NOTIFY_PAUSED 킬스위치·그룹 라우팅 자동 준수.
//   - ★ 누수 0: summary·href는 마케팅 통지 텍스트(판매가·마진 없음)만. payload 화이트리스트 = {kind, summary, href}.
//   - 두 적재 모두 try/catch 격리 — 알림 실패가 cron 본 흐름(발행·수집)을 깨지 않게.
import { NotificationType } from "@prisma/client";
import type { DbClient } from "@/lib/availability";
import { enqueueInAppForOperators } from "@/lib/inapp-notification";
import { enqueueOperatorNotification } from "@/lib/operator-notify";

/**
 * 마케팅 알림 종류 — MARKETING_ALERT payload.kind. 승인 대기(정보성) + 실패 경보 + 편집 잡 결과.
 *  ★ 새 kind 추가 시: ① 아래 MARKETING_INAPP_TITLE ② lib/zalo.ts MARKETING_ALERT_PREFIX 두 곳 모두 등재.
 */
export type MarketingAlertKind =
  | "IG_DRAFTS_READY"
  | "YT_DRAFTS_READY"
  | "IG_PUBLISH_FAILED"
  | "YT_PUBLISH_FAILED"
  | "YT_DRAFT_FAILED"
  | "IG_TOKEN_REFRESH_FAILED"
  | "IG_INSIGHTS_FAILED"
  | "YT_STATS_FAILED"
  | "YT_EDIT_DONE"
  | "YT_EDIT_FAILED";

/** 인앱 벨 제목(ko 고정 — 운영 화면 기준 언어). body는 호출부 summary. */
const MARKETING_INAPP_TITLE: Record<MarketingAlertKind, string> = {
  IG_DRAFTS_READY: "인스타 초안 승인 대기",
  YT_DRAFTS_READY: "유튜브 쇼츠 초안 승인 대기",
  IG_PUBLISH_FAILED: "⚠️ 인스타 발행 실패",
  YT_PUBLISH_FAILED: "⚠️ 유튜브 쇼츠 업로드 실패",
  YT_DRAFT_FAILED: "⚠️ 유튜브 쇼츠 초안 실패",
  IG_TOKEN_REFRESH_FAILED: "⚠️ 인스타 토큰 갱신 실패",
  IG_INSIGHTS_FAILED: "⚠️ 인스타 인사이트 수집 실패",
  YT_STATS_FAILED: "⚠️ 유튜브 성과 수집 실패",
  YT_EDIT_DONE: "유튜브 편집 완료",
  YT_EDIT_FAILED: "⚠️ 유튜브 편집 실패",
};

export interface NotifyMarketingParams {
  kind: MarketingAlertKind;
  /** 운영자용 상세 문구(ko) — 인앱 body + Zalo 본문. 판매가·마진 금지. */
  summary: string;
  /** 클릭 이동 경로(상대). 예: "/marketing/instagram". */
  href?: string | null;
  /** 인앱 제목 오버라이드(긴급 프리픽스 등 — 미지정 시 kind 기본 제목). */
  title?: string;
  /** 트랜잭션 주입(선택). */
  db?: DbClient;
}

/**
 * 마케팅 알림 발송 — 인앱(벨) + Zalo(그룹방) 병행 적재.
 *  ★ 발송이 아니라 적재(cron/notifications가 실제 발송). 두 경로 각각 try/catch 격리.
 */
export async function notifyMarketing(params: NotifyMarketingParams): Promise<void> {
  const { kind, summary, href = null, db } = params;
  const title = params.title ?? MARKETING_INAPP_TITLE[kind];

  // ① 인앱 벨 — 기존 동작 유지(킬스위치 무관).
  try {
    await enqueueInAppForOperators({ type: kind, title, body: summary, href, db });
  } catch (e) {
    console.error(`[marketing-notify] 인앱 적재 실패(${kind}):`, e instanceof Error ? e.message : String(e));
  }

  // ② Zalo 그룹방 — MARKETING_ALERT. 킬스위치·그룹 라우팅은 enqueueOperatorNotification이 결정.
  try {
    await enqueueOperatorNotification({
      type: NotificationType.MARKETING_ALERT,
      payload: { kind, summary, href },
      db,
    });
  } catch (e) {
    console.error(`[marketing-notify] Zalo 적재 실패(${kind}):`, e instanceof Error ? e.message : String(e));
  }
}
