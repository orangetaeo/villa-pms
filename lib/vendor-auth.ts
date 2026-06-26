// lib/vendor-auth.ts — 로그인 User → ServiceVendor 매핑 (ADR-0023 S2)
//   엔티티(ServiceVendor)와 계정(User, Role=VENDOR)은 분리(선택적 1:1, userId @unique).
//   공급자 API는 세션 userId로 이 함수를 거쳐 자기 vendorId를 얻고, 그 스코프만 강제한다.
import { prisma } from "@/lib/prisma";

/**
 * 세션 사용자에 연결된 활성 ServiceVendor의 id 반환. 없거나 비활성이면 null.
 * (null이면 라우트가 403 NOT_A_VENDOR로 차단.)
 */
export async function getVendorIdForUser(userId: string): Promise<string | null> {
  const vendor = await prisma.serviceVendor.findUnique({
    where: { userId },
    select: { id: true, active: true },
  });
  if (!vendor || !vendor.active) return null;
  return vendor.id;
}
