/**
 * 가동률 현실화 준비 (시연/테스트 DB 전용) — 정크 테스트 빌라 비활성화·정리 + demo 자식데이터 정리.
 *   ① 정크 빌라(키보드 난타·테스트명) → INACTIVE(가동률 분모·매출·랭킹서 제외)
 *   ② 정크 빌라 부가서비스·미니바 라인 삭제 + 예약 CANCELLED(점유·매출서 제외)
 *   ③ demo-svc/demo-massage 주문·demo-mbl 라인·demo-cor-mbl 기록 삭제(이후 demo-rbk 예약 재생성 위해 FK 해제)
 *   실행: npx tsx --env-file=.env prisma/prep-occupancy-realistic.ts
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// 명백한 테스트/정크 빌라 (이름 기준 id 고정)
const JUNK_VILLA_IDS = [
  "cmq9foljz0002uktg7007mju9", // QA 타인빌라
  "cmq9jknc50005ns0f66ug3yj4", // TEST1
  "cmqpbnflw0001p30fq2nl42r4", // DDDD
  "cmqhkx9of0035mk0fwcdfrast", // ,ㅏㅏㅏㅏ
  "cmq9fgnmf0001mr0f81z2sdwo", // sddsd
  "cmqt6qnbz0001ukgc02hmwt0t", // V11 (쏘나씨 V11과 중복 테스트)
];

async function main() {
  // 정크 빌라 예약 id
  const junkBookings = await prisma.booking.findMany({ where: { villaId: { in: JUNK_VILLA_IDS } }, select: { id: true } });
  const junkBkIds = junkBookings.map((b) => b.id);

  // ① 정크 빌라의 부가서비스·미니바 제거(통계서 제외)
  const delSvc = await prisma.serviceOrder.deleteMany({ where: { bookingId: { in: junkBkIds } } });
  const junkRecs = await prisma.checkOutRecord.findMany({ where: { bookingId: { in: junkBkIds } }, select: { id: true } });
  const delMl = await prisma.checkoutMinibarLine.deleteMany({ where: { checkOutRecordId: { in: junkRecs.map((r) => r.id) } } });

  // ② 정크 빌라 예약 CANCELLED(점유·매출 제외) — 이미 CANCELLED/EXPIRED는 그대로
  const cancel = await prisma.booking.updateMany({
    where: { id: { in: junkBkIds }, status: { in: ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT", "NO_SHOW", "HOLD"] } },
    data: { status: "CANCELLED", cancelReason: "테스트 빌라 정리(시연 데이터)" },
  });

  // ③ 빌라 INACTIVE
  const deact = await prisma.villa.updateMany({ where: { id: { in: JUNK_VILLA_IDS } }, data: { status: "INACTIVE", isSellable: false } });

  // ④ demo 자식데이터 정리(demo-rbk 예약 재생성 위해 FK 해제) — 이후 시드가 재생성
  const dSvc = await prisma.serviceOrder.deleteMany({ where: { OR: [{ id: { startsWith: "demo-svc-" } }, { id: { startsWith: "demo-massage-" } }] } });
  const dMl = await prisma.checkoutMinibarLine.deleteMany({ where: { id: { startsWith: "demo-mbl-" } } });
  const dCor = await prisma.checkOutRecord.deleteMany({ where: { id: { startsWith: "demo-cor-mbl-" } } });

  console.log(`정크 빌라 ${deact.count}개 INACTIVE · 예약 ${cancel.count}건 취소 · 부가 ${delSvc.count}·미니바 ${delMl.count} 삭제`);
  console.log(`demo 자식 정리: 부가/마사지 ${dSvc.count}·미니바라인 ${dMl.count}·체크아웃기록 ${dCor.count} (시드가 재생성)`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
