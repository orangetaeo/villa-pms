import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getPassportDir, EXT_MIME } from "@/lib/storage";

/**
 * GET /api/passports/<파일명> — 여권 사진 서빙 (T3.1, QA 합의 조건 A)
 * 첫 줄 ADMIN 검사 — 공개 /uploads 라우트와 달리 비로그인·SUPPLIER 차단.
 * private,no-store: 프록시·브라우저 캐시 잔존 차단 (여권 90일 삭제 정책 정합).
 */

const SAFE_NAME = /^[a-zA-Z0-9._-]+$/; // 경로 탈출(../) 차단

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { name } = await params;
  if (!SAFE_NAME.test(name) || name.includes("..")) {
    return NextResponse.json({ error: "invalid_name" }, { status: 400 });
  }

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(path.join(getPassportDir(), name));
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": EXT_MIME[ext] ?? "application/octet-stream",
      "Cache-Control": "private, no-store", // 개인정보 — 캐시 금지
      "X-Content-Type-Options": "nosniff",
    },
  });
}
