// POST /api/uploads — 사진 업로드 (T1.1 + T0.4)
// 저장 백엔드: lib/storage.ts가 자동 선택 (R2 환경변수 설정 시 R2, 아니면 디스크/volume — ADR-0004)
// 클라 리사이즈: 업로드 UI에서 lib/image-resize.ts resizeImage() 사용 권장 (서버 sharp는 미채택)
import { NextResponse } from "next/server";
import { saveFile, isAllowedImageMime, sanitizeNameHint } from "@/lib/storage";
import { prisma } from "@/lib/prisma";
import { buildPublicSlug } from "@/lib/seo/public-villa";
import { isOperator } from "@/lib/permissions";
import { requireAuth } from "@/lib/api-guard";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export async function POST(req: Request) {
  // 인증·권한 검사 (route handler 첫 줄 규칙) — SUPPLIER·ADMIN·CLEANER 허용.
  // CLEANER는 T3.8(F4 청소 사진 제출)에서 허용 — 파일 업로드 자체는 무해,
  // 태스크 소유·배정 검증은 /api/cleaning-tasks/[id]/submit에서 수행
  const g = await requireAuth(req);
  if (!g.ok) return g.response;
  const session = g.session;
  const role = session.user.role;
  if (role !== "SUPPLIER" && !isOperator(role) && role !== "CLEANER") {
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

  // ── SEO 파일명 (T-seo-media) ─────────────────────────────────────────────
  // 파일명은 이미지 검색 결과에 URL로 그대로 노출되고, 약하지만 실재하는 신호다.
  // ★ 클라이언트가 보낸 문자열을 파일명에 그대로 쓰지 않는다 — villaId만 받아 **서버가**
  //   빌라 슬러그를 조회해 조립한다(클라 문자열 신뢰 금지 + 항상 실제 빌라와 일치).
  //   공간(space)은 사전 밖 값이 오면 sanitize 단계에서 걸러진다.
  const villaIdRaw = formData.get("villaId");
  const spaceRaw = formData.get("space");
  let nameHint: string | undefined;
  try {
    const parts: string[] = [];
    if (typeof villaIdRaw === "string" && villaIdRaw.length > 0 && villaIdRaw.length <= 40) {
      const v = await prisma.villa.findUnique({
        where: { id: villaIdRaw },
        select: { publicSlug: true, complex: true, bedrooms: true, id: true },
      });
      if (v) parts.push(v.publicSlug ?? buildPublicSlug({ id: v.id, complex: v.complex, bedrooms: v.bedrooms }));
    }
    if (typeof spaceRaw === "string") parts.push(spaceRaw);
    const hint = sanitizeNameHint(parts.join("-"));
    nameHint = hint || undefined;
  } catch {
    nameHint = undefined; // 조회 실패가 업로드를 막지 않는다 — 파일명만 기존 규칙으로
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const { url } = await saveFile(buffer, file.type, session.user.id, nameHint);

  return NextResponse.json({ url }, { status: 201 });
}
