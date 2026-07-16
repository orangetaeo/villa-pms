import WebchatMount from "@/components/webchat-mount";

// /g/[token] 레이아웃 — 게스트 셀프 체크인 4화면(체크인·options·orders·receipt) 공통.
//   웹챗 위젯 부착만 담당(페이지 렌더는 각 page.tsx). 만료·회수 뷰에서 떠도 무해(계약 §B).
//   offset=96 — 하단 sticky CTA(StickyBar h-14+py-4≈88px)와 FAB 겹침 회피.
//   sourcePage=`g:<토큰 앞 8자>` — 전체 토큰 DB 저장 금지(계약).
export default async function GuestTokenLayout({
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
      <WebchatMount page={`g:${token.slice(0, 8)}`} offset={96} />
    </>
  );
}
