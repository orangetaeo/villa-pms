import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getPassportDir, EXT_MIME } from "@/lib/storage";
import { isOperator } from "@/lib/permissions";
import { fileBelongsToUploader } from "@/lib/passport-name";

/**
 * GET /api/passports/<파일명> — 여권·서명 증빙 서빙 (T3.1, QA 합의 조건 A)
 * 운영자(ADMIN)는 전체 접근. 공급자(SUPPLIER)는 F10 D5(T10.5)에서 본인이 업로드한 파일만 접근.
 *   파일명에 업로더 id가 박혀 있으므로(storage.buildFileName: ts-uploaderId-uuid.ext) 본인 업로드분만 매칭한다.
 *   → 공급자는 자기 게스트분 여권/서명만 보고, 운영자·타 공급자 게스트분은 도달 불가(타인 여권 차단).
 * VENDOR·PARTNER(T-business-contract-esign): 사업 계약 전자서명 이미지(sig-)를 본인 업로드분만 접근.
 *   이들은 서명 파일 외 업로드가 없어 스코프가 자기 계약 서명으로 자연히 한정된다(파일명 업로더 id 매칭).
 * 비로그인·CLEANER 등은 모두 차단.
 * private,no-store: 프록시·브라우저 캐시 잔존 차단 (여권 90일 삭제 정책 정합).
 */

const SAFE_NAME = /^[a-zA-Z0-9._-]+$/; // 경로 탈출(../) 차단

// 본인 업로드분만 접근 가능한 비운영자 role(파일명 업로더 id 매칭으로 스코프 한정).
const SELF_SCOPED_ROLES = new Set(["SUPPLIER", "VENDOR", "PARTNER"]);

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { name } = await params;
  if (!SAFE_NAME.test(name) || name.includes("..")) {
    return NextResponse.json({ error: "invalid_name" }, { status: 400 });
  }

  // 운영자=전체 / 공급자·VENDOR·PARTNER=본인 업로드 파일만(파일명 업로더 id 매칭). 그 외 역할 차단.
  const allowed =
    isOperator(session.user.role) ||
    (SELF_SCOPED_ROLES.has(session.user.role) &&
      fileBelongsToUploader(name, session.user.id));
  if (!allowed) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
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
