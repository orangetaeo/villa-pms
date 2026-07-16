import WebchatMount from "@/components/webchat-mount";

// /p/[token] 레이아웃 — 공개 제안 4화면(제안·book·done·roster) 공통.
//   웹챗 위젯 부착만 담당. 만료·회수 뷰에서 떠도 무해(계약 §B).
//   offset 미지정 — /p는 하단 CTA가 흐름 내 버튼(sticky/fixed 아님)이라 FAB 겹침 없음(계약 검토).
//   sourcePage=`p:<토큰 앞 8자>` — 전체 토큰 DB 저장 금지(계약).
export default async function ProposalTokenLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <>
      {children}
      <WebchatMount page={`p:${token.slice(0, 8)}`} />
    </>
  );
}
