import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const suppliers = await prisma.user.findMany({
    where: { role: "SUPPLIER" },
    select: { id: true, email: true, role: true }
  });
  console.log("Suppliers:", JSON.stringify(suppliers, null, 2));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
