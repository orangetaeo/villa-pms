/**
 * 공개 오픈 직전 테스트 데이터 정리 (LAUNCH §1 체크리스트 ④ / §7.2-2)
 *
 * ⚠️ 프로덕션 DB를 건드리는 스크립트. 안전 설계 3원칙:
 *   1) 기본은 읽기 전용 감사(dry-run). 실제 삭제는 `--confirm` 플래그가 있어야만.
 *   2) 대상은 아래 하드코딩 목록(정확 일치)뿐. 와일드카드·패턴 매칭 없음.
 *   3) 의존 레코드(예약·결제·정산·체크인 등)가 있는 항목은 **자동 삭제 거부**하고
 *      "수동 검토 필요"로 표시 — 증빙 영구보존 원칙(LAUNCH §5) 준수.
 *      각 삭제는 개별 트랜잭션 → FK 에러 시 롤백·건너뜀(부분 삭제 불가).
 *
 * 실행:
 *   npx tsx scripts/cleanup-test-data.ts            # 감사만(아무것도 안 지움)
 *   npx tsx scripts/cleanup-test-data.ts --confirm  # 깨끗한 항목만 실제 삭제
 *
 * 사전: DATABASE_URL = 프로덕션 Neon/Railway. 파일럿(시드·실사용 테스트) 완료 후 실행.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// ── 삭제 대상 (정확 일치, 하드코딩) — LAUNCH §7.2-2 ──
const TEST_VILLA_NAMES = ['sddsd', 'QA 타인빌라', 'TEST1']
const TEST_ACCOUNT_PHONES = [
  '0900000001',
  '0900000002',
  '0900000003',
  '0900000088',
  '0900000099',
]

// 안전 가드: 이 수를 넘게 매칭되면 이름 충돌 의심 → 전체 중단(실데이터 보호)
const SANITY_MAX_VILLAS = 5
const SANITY_MAX_USERS = 8

const CONFIRM = process.argv.includes('--confirm')

function line() {
  console.log('─'.repeat(60))
}

async function auditVillas() {
  const villas = await prisma.villa.findMany({
    where: { name: { in: TEST_VILLA_NAMES } },
    include: {
      supplier: { select: { name: true, phone: true } },
      _count: {
        select: {
          bookings: true,
          proposalItems: true,
          cleaningTasks: true,
          photos: true,
          ratePeriods: true,
          amenities: true,
          blocks: true,
        },
      },
    },
  })

  console.log(`\n🏠 테스트 빌라: ${villas.length}채 매칭`)
  line()
  const results = villas.map((v) => {
    // 증빙·재무 레코드가 달린 건 자동 삭제 금지
    const blockers: string[] = []
    if (v._count.bookings > 0) blockers.push(`예약 ${v._count.bookings}`)
    if (v._count.proposalItems > 0) blockers.push(`제안항목 ${v._count.proposalItems}`)
    if (v._count.cleaningTasks > 0) blockers.push(`청소 ${v._count.cleaningTasks}`)
    const safe = blockers.length === 0
    console.log(
      `  ${safe ? '✅ 삭제가능' : '⛔ 수동검토'}  "${v.name}" (${v.id})\n` +
        `      공급자: ${v.supplier.name} / ${v.supplier.phone ?? '-'}\n` +
        `      자식: 사진${v._count.photos}·요율${v._count.ratePeriods}·비품${v._count.amenities}·차단${v._count.blocks} (Cascade)\n` +
        (safe ? '' : `      ⛔ 차단요인: ${blockers.join(', ')} — 자동 삭제 안 함\n`),
    )
    return { villa: v, safe }
  })
  return results
}

async function auditUsers() {
  const users = await prisma.user.findMany({
    where: { phone: { in: TEST_ACCOUNT_PHONES } },
    include: {
      _count: {
        select: {
          villas: true,
          settlements: true,
          notifications: true,
          auditLogs: true,
          zaloAccounts: true,
          ownedConversations: true,
        },
      },
    },
  })

  console.log(`\n👤 테스트 계정: ${users.length}개 매칭`)
  line()
  const results = users.map((u) => {
    const blockers: string[] = []
    if (u._count.villas > 0) blockers.push(`빌라 ${u._count.villas}`)
    if (u._count.settlements > 0) blockers.push(`정산 ${u._count.settlements}`)
    const safe = blockers.length === 0
    console.log(
      `  ${safe ? '✅ 삭제가능' : '⛔ 수동검토'}  ${u.name} / ${u.phone} (${u.role}, ${u.id})\n` +
        `      연관: 알림${u._count.notifications}·감사로그${u._count.auditLogs}(→SetNull)·` +
        `Zalo계정${u._count.zaloAccounts}·대화${u._count.ownedConversations}\n` +
        (safe ? '' : `      ⛔ 차단요인: ${blockers.join(', ')} — 빌라부터 정리 후 재실행\n`),
    )
    return { user: u, safe }
  })
  return results
}

async function main() {
  console.log(`\n=== 테스트 데이터 정리 ${CONFIRM ? '(--confirm: 실제 삭제)' : '(DRY-RUN: 감사만)'} ===`)

  const villaResults = await auditVillas()
  const userResults = await auditUsers()

  // 안전 가드 — 예상보다 많이 매칭되면 중단
  if (villaResults.length > SANITY_MAX_VILLAS || userResults.length > SANITY_MAX_USERS) {
    console.error(
      `\n🛑 매칭 수가 안전 한도 초과(빌라 ${villaResults.length}/${SANITY_MAX_VILLAS}, ` +
        `계정 ${userResults.length}/${SANITY_MAX_USERS}). 이름 충돌로 실데이터가 잡혔을 수 있음 → 중단.`,
    )
    process.exit(1)
  }

  const safeVillas = villaResults.filter((r) => r.safe)
  const safeUsers = userResults.filter((r) => r.safe)
  const skipped =
    villaResults.filter((r) => !r.safe).length + userResults.filter((r) => !r.safe).length

  if (!CONFIRM) {
    console.log('\n📋 요약 (DRY-RUN — 아무것도 삭제하지 않음)')
    line()
    console.log(`  삭제 가능: 빌라 ${safeVillas.length} · 계정 ${safeUsers.length}`)
    console.log(`  수동 검토 필요(의존 레코드 있음): ${skipped}`)
    console.log('\n실제 삭제하려면: npx tsx scripts/cleanup-test-data.ts --confirm')
    console.log('수동 검토 항목은 Prisma Studio(npx prisma studio)로 직접 확인 후 처리 권장.\n')
    return
  }

  // ── 실제 삭제 — 깨끗한 항목만, 빌라→계정 순, 각 개별 트랜잭션 ──
  console.log('\n🗑️  삭제 시작 (깨끗한 항목만)')
  line()
  let okV = 0
  for (const { villa } of safeVillas) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.villa.delete({ where: { id: villa.id } }) // Cascade: 사진·요율·비품·차단·시즌
      })
      console.log(`  ✅ 빌라 삭제: "${villa.name}"`)
      okV++
    } catch (e) {
      console.log(`  ⛔ 빌라 "${villa.name}" 삭제 실패(롤백·건너뜀): ${(e as Error).message}`)
    }
  }

  // 빌라 삭제 후 계정 재조회(빌라 차단요인 해소됐을 수 있음)
  let okU = 0
  for (const { user } of userResults) {
    const remaining = await prisma.villa.count({ where: { supplierId: user.id } })
    const settlements = await prisma.settlement.count({ where: { supplierId: user.id } })
    if (remaining > 0 || settlements > 0) {
      console.log(`  ⛔ 계정 ${user.phone} 건너뜀: 빌라 ${remaining}·정산 ${settlements} 잔존`)
      continue
    }
    try {
      await prisma.$transaction(async (tx) => {
        await tx.user.delete({ where: { id: user.id } }) // AuditLog→SetNull, ZaloAccount→Cascade
      })
      console.log(`  ✅ 계정 삭제: ${user.name} / ${user.phone}`)
      okU++
    } catch (e) {
      console.log(`  ⛔ 계정 ${user.phone} 삭제 실패(롤백·건너뜀): ${(e as Error).message}`)
    }
  }

  console.log(`\n완료: 빌라 ${okV}/${safeVillas.length} · 계정 ${okU} 삭제.`)
  if (skipped > 0) {
    console.log(`⚠️  ${skipped}건은 의존 레코드(예약·결제·정산)로 자동 삭제 제외 — Prisma Studio로 수동 처리.`)
  }
}

main()
  .catch((e) => {
    console.error('스크립트 오류:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
