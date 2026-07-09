/**
 * 재무 집계 누락 필드 백필 (시연/테스트 DB 전용) — 마진/환산이 온전히 합산되도록.
 *   ① KRW 예약 중 fxVndPerKrw(환율 스냅샷) 없는 건 → 현재 환율(AppSetting)로 채움
 *      (없으면 환산·마진에서 제외되던 것). ② 부가서비스 priceVnd 없는 건 → priceKrw×환율 또는
 *      카탈로그가×수량으로 복원(없으면 VND 마진에서 제외되던 것).
 *   실행: npx tsx --env-file=.env prisma/backfill-finance-fields.ts (멱등)
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main(){
  const fxRow = await prisma.appSetting.findUnique({ where:{ key:"FX_VND_PER_KRW" }});
  const fx = Number(fxRow?.value ?? "18.87");

  // ① KRW 예약 환율 스냅샷 백필
  const bkFix = await prisma.booking.updateMany({
    where:{ saleCurrency:"KRW", fxVndPerKrw:null },
    data:{ fxVndPerKrw: fx },
  });

  // ② 부가서비스 priceVnd 백필 (priceVnd null) — 카탈로그가×수량 우선, 없으면 priceKrw×환율
  const orders = await prisma.serviceOrder.findMany({
    where:{ priceVnd:null },
    select:{ id:true, priceKrw:true, quantity:true, catalogItemId:true },
  });
  const itemIds = [...new Set(orders.map(o=>o.catalogItemId).filter((v):v is string=>!!v))];
  const items = itemIds.length ? await prisma.serviceCatalogItem.findMany({ where:{ id:{ in:itemIds }}, select:{ id:true, priceVnd:true }}) : [];
  const priceById = new Map(items.map(i=>[i.id, i.priceVnd]));

  let svcFix=0;
  for(const o of orders){
    const cat = o.catalogItemId ? priceById.get(o.catalogItemId) : null;
    let vnd: bigint;
    if(cat && cat>0n) vnd = cat * BigInt(Math.max(1,o.quantity));
    else vnd = BigInt(Math.round(o.priceKrw * fx));
    if(vnd<=0n) continue;
    await prisma.serviceOrder.update({ where:{ id:o.id }, data:{ priceVnd: vnd }});
    svcFix++;
  }

  console.log(`완료 — KRW예약 환율 백필 ${bkFix.count}건 · 부가서비스 priceVnd 백필 ${svcFix}건 (fx=${fx})`);
}
main().catch(e=>{console.error(e);process.exit(1)}).finally(()=>prisma.$disconnect());
