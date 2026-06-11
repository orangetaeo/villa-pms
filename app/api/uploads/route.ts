// POST /api/uploads — 사진 업로드 (T1.1 + T0.4)
// 저장 백엔드: lib/storage.ts가 자동 선택 (R2 환경변수 설정 시 R2, 아니면 디스크/volume — ADR-0004)
// 클라 리사이즈: 업로드 UI에서 lib/image-resize.ts resizeImage() 사용 권장 (서버 sharp는 미채택)
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { saveFile, isAllowedImageMime } from "@/lib/storage";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export async function POST(req: Request) {
  // 인증·권한 검사 (route handler 첫 줄 규칙) — SUPPLIER·ADMIN·CLEANER 허용.
  // CLEANER는 T3.8(F4 청소 사진 제출)에서 허용 — 파일 업로드 자체는 무해,
  // 태스크 소유·배정 검증은 /api/cleaning-tasks/[id]/submit에서 수행
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const role = session.user.role;
  if (role !== "SUPPLIER" && role !== "ADMIN" && role !== "CLEANER") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "FILE_REQUIRED" }, { status: 400 });
  }
  // MIME 화이트리스트 검사 — startsWith("image/")는 image/svg 위장(stored XSS)을 통과시킴 (QA M1)
  if (!isAllowedImageMime(file.type)) {
    return NextResponse.json({ error: "INVALID_TYPE" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "FILE_TOO_LARGE" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const { url } = await saveFile(buffer, file.type, session.user.id);

  return NextResponse.json({ url }, { status: 201 });
}
