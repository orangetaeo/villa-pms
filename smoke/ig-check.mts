import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { getIgAccessToken, getIgUserId, getIgGraphBase } from "../lib/instagram/settings";

const prisma = new PrismaClient();
const [token, userId, base] = await Promise.all([
  getIgAccessToken(prisma as never),
  getIgUserId(prisma as never),
  getIgGraphBase(prisma as never),
]);
if (!token || !userId) { console.log("IG 설정 없음"); process.exit(1); }
const res = await fetch(`${base}/${userId}/media?fields=id,media_type,media_product_type,caption,timestamp,permalink&limit=8&access_token=${token}`);
const j: any = await res.json();
if (j.error) { console.log("API 오류:", JSON.stringify(j.error).slice(0, 250)); process.exit(1); }
console.log("=== 인스타 최근 게시물 ===");
for (const m of j.data ?? []) {
  console.log(" ", String(m.media_product_type || m.media_type || "?").padEnd(9), String(m.timestamp).slice(0, 16), "|", String(m.caption || "").replace(/\n/g, " ").slice(0, 46));
  console.log("     ", m.permalink);
}
await prisma.$disconnect();
