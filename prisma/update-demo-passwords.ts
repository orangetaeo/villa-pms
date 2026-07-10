import bcryptjs from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const newPassword = "Test1234!";
  const phones = ["0791234560", "0791234569", "0791234568", "0791234567"];

  const hashedPassword = await bcryptjs.hash(newPassword, 10);

  for (const phone of phones) {
    const updated = await prisma.user.update({
      where: { phone },
      data: {
        passwordHash: hashedPassword,
        passwordChangedAt: new Date(),
      },
    });
    console.log(`✓ Updated ${updated.name} (${phone})`);
  }

  console.log(`\n✅ All ${phones.length} demo accounts password updated to "${newPassword}"`);
}

main()
  .catch((e) => {
    console.error("Error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
