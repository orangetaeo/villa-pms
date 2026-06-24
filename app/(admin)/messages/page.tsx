// /messages — 운영자 Zalo 채팅 (T6.6, Stitch b14-zalo-chat 변환, ADR-0003·ADR-0007·ADR-0009)
// RSC: 초기 인박스 + (딥링크 ?c= 면) 초기 스레드만 서버에서 조회(SSR 신선도)하고 MessagesClient에 주입.
//   클릭 전환·5초 폴링은 클라이언트(MessagesClient)가 API로 처리 — page.tsx 전체 재실행 제거(perf #2).
// 조회·매핑·누수 분기는 _thread-data.ts(getInboxData/getThreadData) 단일 진실원 — 인박스 라우트·스레드 라우트와 공유.
// ADR-0007 개인 스코프: where ownerAdminId = session.user.id (관리자A 대화를 B가 못 봄 — 누수 0).
// 누수 0: select 화이트리스트 — 마진·판매가(KRW)·원가·credential 미조회(_thread-data 보존).
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { isOperator } from "@/lib/permissions";
import { getInboxData, getThreadData } from "./_thread-data";
import { MessagesClient } from "./messages-client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pageTitles");
  return { title: `${t("messages")} — Villa PMS` };
}

// 수신 메시지가 폴링 없이는 RSC에 반영되지 않으므로 초기 SSR은 항상 동적(딥링크 신선도).
export const dynamic = "force-dynamic";

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  // 개인 스코프 — 본인(ownerAdminId)이 받은 대화만 (ADR-0007 D3, 누수 0).
  const session = await auth();
  // RBAC(ADR-0013) — 운영자(OWNER/MANAGER/STAFF/ADMIN) 허용. 미들웨어와 동일 술어.
  if (!session?.user?.id || !isOperator(session.user.role)) {
    redirect("/login");
  }
  const ownerAdminId = session.user.id;

  const { c: selectedId } = await searchParams;

  // 초기 인박스(SSR) + 딥링크면 초기 스레드(SSR) 동시 조회.
  const { items, totalUnread } = await getInboxData(ownerAdminId, selectedId ?? null);
  const initialThread = selectedId ? await getThreadData(ownerAdminId, selectedId) : null;

  // 딥링크 ?c= 가 무효·타 관리자 대화면(스레드 null) 목록으로 되돌림(id 추측 차단, 모바일 백지 방지).
  if (selectedId && !initialThread) {
    redirect("/messages");
  }

  return (
    <MessagesClient
      initialItems={items}
      initialTotalUnread={totalUnread}
      initialSelectedId={selectedId ?? null}
      initialThread={initialThread}
    />
  );
}
