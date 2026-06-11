// GET /uploads/<파일명> — 디스크 모드(UPLOAD_DIR=Railway volume) 파일 서빙 (T0.4)
// 기본 모드(public/uploads)에서는 next 정적 서빙이 우선하므로 이 라우트는 volume 모드 전용.
// 빌라 사진은 공개 제안 페이지(/p/[token], 비로그인)에서 노출되므로 인증 없이 공개 서빙.
import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { getUploadDir, EXT_MIME } from "@/lib/storage";

// 파일명 화이트리스트 — 경로 탈출(../) 차단
const SAFE_NAME = /^[a-zA-Z0-9._-]+$/;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  if (!SAFE_NAME.test(name) || name.includes("..")) {
    return NextResponse.json({ error: "INVALID_NAME" }, { status: 400 });
  }

  const filePath = path.join(getUploadDir(), name);
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(filePath);
  } catch {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": EXT_MIME[ext] ?? "application/octet-stream",
      // 파일명이 UUID라 내용 불변 — 1년 캐시
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
