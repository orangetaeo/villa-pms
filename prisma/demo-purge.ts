/**
 * DEMO 정리 — prisma/demo-seed.ts 가 만든 모든 `demo-` 데이터 삭제.
 * 실행: npx tsx prisma/demo-purge.ts
 *
 * FK 안전 순서로 자식부터 삭제. 멱등(없으면 0건 삭제).
 * ⚠️ 오픈 전 반드시 실행해 프로덕션 DB에서 데모 흔적 제거.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const demo = { startsWith: "demo-" };

async function main() {
  const r: Record<string, number> = {};

  // 자식 → 부모 순서
  r.zaloMessage = (await prisma.zaloMessage.deleteMany({ where: { conversationId: demo } })).count;
  r.zaloConversation = (await prisma.zaloConversation.deleteMany({ where: { id: demo } })).count;
  r.notification = (await prisma.notification.deleteMany({ where: { id: demo } })).count;
  r.auditLog = (await prisma.auditLog.deleteMany({ where: { id: demo } })).count;
  r.settlement = (await prisma.settlement.deleteMany({ where: { id: demo } })).count; // SettlementItem cascade
  r.payment = (await prisma.payment.deleteMany({ where: { id: demo } })).count;
  r.checkInRecord = (await prisma.checkInRecord.deleteMany({ where: { id: demo } })).count;
  r.checkOutRecord = (await prisma.checkOutRecord.deleteMany({ where: { id: demo } })).count;
  r.cleaningTask = (await prisma.cleaningTask.deleteMany({ where: { id: demo } })).count;
  r.proposal = (await prisma.proposal.deleteMany({ where: { id: demo } })).count; // ProposalItem cascade
  r.booking = (await prisma.booking.deleteMany({ where: { id: demo } })).count;
  r.calendarBlock = (await prisma.calendarBlock.deleteMany({ where: { id: demo } })).count;
  r.villa = (await prisma.villa.deleteMany({ where: { id: demo } })).count; // Photo/Rate/Amenity cascade
  r.user = (await prisma.user.deleteMany({ where: { id: demo } })).count;

  console.log("🧹 데모 데이터 정리 완료:", r);
}

main()
  .catch((e) => {
    console.error("❌ 정리 실패:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
