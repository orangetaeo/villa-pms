import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { savePassportFile, isAllowedImageMime } from "@/lib/storage";
import { isOperator } from "@/lib/permissions";

/**
 * POST /api/uploads/passport — 여권 사진 업로드 (T3.1, QA 합의 조건 A)
 * 공개 /api/uploads와 분리: ADMIN 전용, 항상 디스크 비공개 저장,
 * 반환 URL은 ADMIN 가드 서빙 라우트(/api/passports/<name>)만 가리킨다.
 */

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isOperator(session.user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file_required" }, { status: 400 });
  }
  if (!isAllowedImageMime(file.type)) {
    return NextResponse.json({ error: "invalid_type" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "file_too_large" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  // 증빙 종류별 접두 분리(삭제·열람 정책 구분): signature→sig-, paper-doc(#1 체크인 종이서류)→doc-, 여권→무접두
  const kind = formData.get("kind");
  const prefix =
    kind === "signature" ? "sig-" : kind === "paper-doc" ? "doc-" : undefined;
  const { fileName } = await savePassportFile(buffer, file.type, session.user.id, prefix);

  return NextResponse.json({ url: `/api/passports/${fileName}` }, { status: 201 });
}
