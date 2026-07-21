// lib/marketing-access.ts — 마케팅 화면 접근 판정(서버 전용)
//
// 마케팅(인스타그램·유튜브)은 역할이 아니라 특정 계정 단일 전화번호로만 노출한다
// (canSeeMarketing, 운영자 지시 2026-07-21). 세션 JWT에는 phone이 없으므로
// user.id로 phone을 조회해 판정한다. 사이드바(레이아웃)·각 마케팅 페이지 RSC 게이트 공용.
//   ★ prisma 의존 → 서버 전용. client 컴포넌트는 lib/permissions.canSeeMarketing(순수)만 사용.
import { prisma } from "@/lib/prisma";
import { canSeeMarketing } from "@/lib/permissions";

/** 현재 로그인 계정(userId)이 마케팅 화면을 볼 수 있는가 — phone 단일 계정 게이트. */
export async function userCanSeeMarketing(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { phone: true },
  });
  return canSeeMarketing(user?.phone);
}
