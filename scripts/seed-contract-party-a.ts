/**
 * seed-contract-party-a — 사업 계약서 갑(회사) 계약 주체 고정값 시드 (멱등)
 *
 * AppSetting 키 BUSINESS_CONTRACT_PARTY_A(JSON 문자열)를 upsert한다.
 *   생성 폼(app/(admin)/contracts)이 이 값을 읽어 갑 정보를 자동 prefill한다(재입력 방지).
 *   ★ additive 데이터 upsert이므로 raw SQL/마이그레이션 불필요(prisma upsert로 충분).
 *
 * 실행:   npx tsx scripts/seed-contract-party-a.ts
 * 멱등성: key로 upsert — 두 번 실행해도 값만 최신으로 유지(행 중복 없음).
 * 적재:   프로덕션 DB(.env DATABASE_URL) 대상으로 실행.
 */
import { PrismaClient } from "@prisma/client";
import { CONTRACT_PARTY_A_KEY } from "../lib/business-contract";

const prisma = new PrismaClient();

// 테오 실제 계약 주체 정보 (개인 자격 당사자, Villa GO=운영 브랜드).
const PARTY_A = {
  companyName: "KIM HAKTAE",
  companyPassport: "M364Z7249",
  companyContactVn: "0799493138",
  companyContactKr: "01028675342",
};

async function main() {
  const value = JSON.stringify(PARTY_A);
  const row = await prisma.appSetting.upsert({
    where: { key: CONTRACT_PARTY_A_KEY },
    update: { value },
    create: { key: CONTRACT_PARTY_A_KEY, value },
  });
  console.log(`[seed-contract-party-a] upsert 완료: key=${row.key}`);
  console.log(`  value=${row.value}`);
}

main()
  .catch((e) => {
    console.error("[seed-contract-party-a] 실패:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
