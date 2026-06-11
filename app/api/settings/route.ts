// GET/PUT /api/settings — 운영 설정(AppSetting) 조회·갱신 (T1.7, ADMIN 전용)
// 키 화이트리스트만 허용 — 임의 설정 주입 차단 (계약 T1.7-settings-ui)
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { FX_VND_PER_KRW_KEY } from "@/lib/pricing";
import { HOLD_HOURS_DEFAULT_KEY } from "@/lib/hold";

const SETTING_KEYS = [HOLD_HOURS_DEFAULT_KEY, FX_VND_PER_KRW_KEY] as const;
type SettingKey = (typeof SETTING_KEYS)[number];

/**
 * 키별 값 검증
 * - HOLD_HOURS_DEFAULT: 1~168 정수 문자열 (lib/hold resolveHoldHours와 호환)
 * - FX_VND_PER_KRW: 양수 소수 문자열, 소수 4자리까지
 *   (lib/pricing suggestSalePriceKrw의 /^\d+(\.\d{1,4})?$/ 파서와 호환)
 */
const VALIDATORS: Record<SettingKey, (value: string) => boolean> = {
  [HOLD_HOURS_DEFAULT_KEY]: (value) => {
    if (!/^\d+$/.test(value)) return false;
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 && n <= 168;
  },
  [FX_VND_PER_KRW_KEY]: (value) => {
    if (!/^\d+(\.\d{1,4})?$/.test(value)) return false;
    return Number(value) > 0; // "0", "0.0000" 거부
  },
};

const putSchema = z.object({
  key: z.string(),
  value: z.string().trim().min(1),
});

export async function GET() {
  // 권한 검사 — ADMIN 전용 (route handler 첫 줄 role 검사 규칙)
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

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
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // 키 화이트리스트 — 그 외 키는 임의 설정 주입으로 간주, 400
  const key = parsed.data.key;
  if (!(SETTING_KEYS as readonly string[]).includes(key)) {
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
    userId: session.user.id,
    action: "UPDATE",
    entity: "AppSetting",
    entityId: settingKey,
    changes: {
      value: { old: old?.value ?? null, new: saved.value },
    },
  });

  return NextResponse.json({ key: saved.key, value: saved.value });
}
