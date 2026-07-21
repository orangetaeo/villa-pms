import { NextResponse } from "next/server";
import { getPerson, buildVCard, CARD_IDS } from "../../_data";

// GET /card/[id]/vcard — 연락처(.vcf) 다운로드. 모바일에서 열면 "연락처에 추가" 제안.
// 공개 경로(미들웨어 보호목록 외). 정적 파라미터만 허용.
export const dynamicParams = false;

export function generateStaticParams() {
  return CARD_IDS.map((id) => ({ id }));
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const person = getPerson(id);
  if (!person) {
    return new NextResponse("Not found", { status: 404 });
  }
  const vcard = buildVCard(person);
  return new NextResponse(vcard, {
    status: 200,
    headers: {
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": `attachment; filename="${person.id}-villago.vcf"`,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
