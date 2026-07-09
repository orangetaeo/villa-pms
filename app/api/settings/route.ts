// GET/PUT /api/settings — 운영 설정(AppSetting) 조회·갱신 (T1.7, ADMIN 전용)
// 키 화이트리스트만 허용 — 임의 설정 주입 차단 (계약 T1.7-settings-ui)
// T1.7-bank-contact: 입금 계좌·연락처 5키 + 배치 PUT(entries) 추가 (b8 Card 3 변환)
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { isSystemAdmin } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";
import {
  SETTING_KEYS,
  CLEARABLE_SET,
  VALIDATORS,
  isSettingKey,
  type SettingKey,
} from "./validators";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }) };
  }
  if (!isSystemAdmin(session.user.role)) {
    return { error: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }) };
  }
  return { userId: session.user.id };
}

// 단일 키 PUT: { key, value } — 비어있지 않은 값 (기존 폼: 홀드·환율 호환)
const singleSchema = z.object({
  key: z.string(),
  value: z.string().trim().min(1),
});

// 배치 PUT: { entries: [{ key, value }] } — 입금 계좌·연락처 카드 일괄 저장
//   value 빈 문자열 = clear(삭제). value 트림은 핸들러에서 수행 (빈 문자열 보존)
const batchSchema = z.object({
  entries: z
    .array(z.object({ key: z.string(), value: z.string() }))
    .min(1)
    .max(SETTING_KEYS.length),
});

export async function GET() {
  // 권한 검사 — ADMIN 전용 (route handler 첫 줄 role 검사 규칙)
  const admin = await requireAdmin();
  if (admin.error) return admin.error;

  const rows = await prisma.appSetting.findMany({
    where: { key: { in: [...SETTING_KEYS] } },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));

  // 화이트리스트 키 전부 반환 — 미설정은 null (FE에서 기본값 표기)
  const settings = Object.fromEntries(
    SETTING_KEYS.map((key) => [key, byKey.get(key) ?? null])
  );
  return NextResponse.json({ settings });
}

export async function PUT(req: Request) {
  // 권한 검사 — ADMIN 전용
  const g = await requireCapability(isSystemAdmin, "isSystemAdmin", req);
  if (!g.ok) return g.response;
  const userId = g.userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  // 배치 모드 분기 — entries 배열이 있으면 일괄 저장 (clear 포함)
  if (body && typeof body === "object" && "entries" in body) {
    return handleBatch(body, userId);
  }

  // 단일 키 모드 (기존 호환)
  const parsed = singleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // 키 화이트리스트 — 그 외 키는 임의 설정 주입으로 간주, 400
  const key = parsed.data.key;
  if (!isSettingKey(key)) {
    return NextResponse.json({ error: "INVALID_KEY", key }, { status: 400 });
  }
  const settingKey = key as SettingKey;

  const value = parsed.data.value.trim();
  if (!VALIDATORS[settingKey](value)) {
    return NextResponse.json(
      { error: "INVALID_VALUE", key: settingKey, value },
      { status: 400 }
    );
  }

  const old = await prisma.appSetting.findUnique({ where: { key: settingKey } });
  const saved = await prisma.appSetting.upsert({
    where: { key: settingKey },
    create: { key: settingKey, value },
    update: { value },
  });

  // 감사 로그 — 데이터 변경 API 동시 기록 (글로벌 절대 규칙)
  await writeAuditLog({
    userId,
    action: "UPDATE",
    entity: "AppSetting",
    entityId: settingKey,
    changes: {
      value: { old: old?.value ?? null, new: saved.value },
    },
  });

  return NextResponse.json({ key: saved.key, value: saved.value });
}

/**
 * 배치 저장: entries의 각 키를 검증 후 트랜잭션으로 upsert(비어있지 않음)/delete(빈 값).
 * 빈 값 삭제는 CLEARABLE_KEYS만 허용 — 그 외 키 빈 값은 INVALID_VALUE.
 * 변경 항목 전체를 하나의 AuditLog로 기록.
 */
async function handleBatch(body: object, userId: string) {
  const parsed = batchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // 동일 키 중복 거부 — 의도치 않은 덮어쓰기 방지
  const seen = new Set<string>();
  const normalized: { key: SettingKey; value: string; clear: boolean }[] = [];
  for (const entry of parsed.data.entries) {
    const key = entry.key;
    if (!isSettingKey(key)) {
      return NextResponse.json({ error: "INVALID_KEY", key }, { status: 400 });
    }
    if (seen.has(key)) {
      return NextResponse.json({ error: "DUPLICATE_KEY", key }, { status: 400 });
    }
    seen.add(key);

    const settingKey = key as SettingKey;
    const value = entry.value.trim();
    if (value === "") {
      // 빈 값 = 삭제 — clearable 키만 허용
      if (!CLEARABLE_SET.has(settingKey)) {
        return NextResponse.json(
          { error: "INVALID_VALUE", key: settingKey, value: "" },
          { status: 400 }
        );
      }
      normalized.push({ key: settingKey, value: "", clear: true });
      continue;
    }
    if (!VALIDATORS[settingKey](value)) {
      return NextResponse.json(
        { error: "INVALID_VALUE", key: settingKey, value },
        { status: 400 }
      );
    }
    normalized.push({ key: settingKey, value, clear: false });
  }

  // 변경 전 값 조회 (감사 로그 diff용)
  const before = await prisma.appSetting.findMany({
    where: { key: { in: normalized.map((n) => n.key) } },
  });
  const beforeByKey = new Map(before.map((r) => [r.key, r.value]));

  // 트랜잭션 — 전부 성공 또는 전부 롤백
  await prisma.$transaction(
    normalized.map((n) =>
      n.clear
        ? prisma.appSetting.deleteMany({ where: { key: n.key } })
        : prisma.appSetting.upsert({
            where: { key: n.key },
            create: { key: n.key, value: n.value },
            update: { value: n.value },
          })
    )
  );

  // 감사 로그 — 변경된 키만 diff 기록 (값 변동 없는 항목 제외)
  const changes: Record<string, { old: string | null; new: string | null }> = {};
  for (const n of normalized) {
    const oldVal = beforeByKey.get(n.key) ?? null;
    const newVal = n.clear ? null : n.value;
    if (oldVal !== newVal) changes[n.key] = { old: oldVal, new: newVal };
  }
  if (Object.keys(changes).length > 0) {
    await writeAuditLog({
      userId,
      action: "UPDATE",
      entity: "AppSetting",
      entityId: "settings-batch",
      changes,
    });
  }

  // 갱신 결과 반환 — 현재 값(미설정은 null)
  const after = await prisma.appSetting.findMany({
    where: { key: { in: normalized.map((n) => n.key) } },
  });
  const afterByKey = new Map(after.map((r) => [r.key, r.value]));
  const settings = Object.fromEntries(
    normalized.map((n) => [n.key, afterByKey.get(n.key) ?? null])
  );
  return NextResponse.json({ settings });
}
