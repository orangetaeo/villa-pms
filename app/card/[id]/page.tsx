import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPerson, CARD_IDS } from "../_data";

// 온라인 디지털 명함 (villa-go.net/card/[id]) — T-online-namecard
// 공개·인증 불필요. 모바일 우선. 카톡/Zalo로 링크 공유 → 전화·Zalo·이메일·웹 바로 연결 + 연락처 저장(.vcf).
export const dynamicParams = false;
export function generateStaticParams() {
  return CARD_IDS.map((id) => ({ id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const p = getPerson(id);
  if (!p) return { title: "Villa Go" };
  const title = `${p.nameEn} · Villa Go`;
  const description = `${p.role} · Villa Go — Phu Quoc Premium Pool Villas`;
  const url = `https://villa-go.net/card/${p.id}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: "Villa Go",
      type: "profile",
      images: [{ url: "/og-villa-go.png", width: 800, height: 400, alt: "Villa Go" }],
    },
    twitter: { card: "summary_large_image", title, description, images: ["/og-villa-go.png"] },
  };
}

function Pin({ color }: { color: string }) {
  return (
    <span className="vgc-pin" style={{ color }}>
      <svg viewBox="0 0 100 128" aria-hidden="true">
        <path
          d="M50 3 C25.7 3 6 22.7 6 47 C6 79 50 125 50 125 C50 125 94 79 94 47 C94 22.7 74.3 3 50 3 Z"
          fill="currentColor"
        />
        <g fill="#12897F">
          <path d="M50 22 L74 43 L68 43 L68 45 L32 45 L32 43 L26 43 Z" />
          <rect x="34" y="45" width="32" height="27" rx="1.5" />
        </g>
        <rect x="44.5" y="53" width="11" height="19" rx="2" fill="currentColor" />
        <circle cx="50" cy="34.5" r="5.4" fill="#F5A623" />
      </svg>
    </span>
  );
}

const CSS = `
.vgc{--teal:#12897F;--teal-deep:#0B5C55;--orange:#F5A623;--mint:#9FE3D8;--ink:#12312D;--muted:#5C726D;--line:#E3EAE8;--bg:#EAF0EE;
  background:var(--bg);color:var(--ink);min-height:100dvh;
  font-family:"Public Sans","Noto Sans KR","Be Vietnam Pro",system-ui,-apple-system,sans-serif;
  -webkit-font-smoothing:antialiased;line-height:1.5}
.vgc *{box-sizing:border-box;margin:0;padding:0}
.vgc .vgc-wrap{max-width:440px;margin:0 auto;min-height:100dvh;display:flex;flex-direction:column}
.vgc .vgc-hero{position:relative;color:#fff;padding:40px 26px 74px;
  background:radial-gradient(120% 130% at 82% -10%,#17A093 0,rgba(23,160,147,0) 55%),linear-gradient(158deg,var(--teal),var(--teal-deep))}
.vgc .vgc-brand{display:flex;align-items:center;gap:12px}
.vgc .vgc-pin{display:inline-flex}
.vgc .vgc-brand .vgc-pin svg{width:40px;height:40px;filter:drop-shadow(0 3px 6px rgba(0,0,0,.18))}
.vgc .vgc-wm{font-size:23px;font-weight:800;letter-spacing:-.02em}
.vgc .vgc-wm span{color:var(--mint)}
.vgc .vgc-tag{margin-top:14px;font-size:13px;color:rgba(255,255,255,.85);letter-spacing:.01em}
.vgc .vgc-sheet{background:#fff;border-radius:22px 22px 0 0;margin-top:-46px;
  padding:26px 22px calc(30px + env(safe-area-inset-bottom));flex:1;
  box-shadow:0 -8px 30px -16px rgba(6,40,36,.35);position:relative;z-index:1}
.vgc .vgc-idrow{display:flex;justify-content:space-between;align-items:flex-start;gap:14px}
.vgc .vgc-name{font-size:26px;font-weight:800;letter-spacing:-.01em;color:var(--teal-deep);line-height:1.08}
.vgc .vgc-ko{display:block;font-size:14px;font-weight:600;color:var(--muted);margin-top:6px;letter-spacing:.02em}
.vgc .vgc-role{margin-top:10px;display:inline-block;font-size:12px;font-weight:700;letter-spacing:.04em;
  color:var(--teal-deep);background:#E7F4F1;border-radius:999px;padding:5px 12px}
.vgc .vgc-pinmini{flex:none}
.vgc .vgc-pinmini .vgc-pin svg{width:34px;height:34px}
.vgc .vgc-actions{margin-top:22px;display:flex;flex-direction:column;gap:10px}
.vgc a.vgc-act{display:flex;align-items:center;gap:14px;text-decoration:none;color:var(--ink);
  border:1px solid var(--line);border-radius:14px;padding:13px 15px;background:#fff;-webkit-tap-highlight-color:transparent}
.vgc a.vgc-act:active{transform:scale(.985)}
.vgc a.vgc-act .ico{width:38px;height:38px;border-radius:11px;display:grid;place-items:center;flex:none;background:#EAF4F2;color:var(--teal)}
.vgc a.vgc-act .ico svg{width:19px;height:19px}
.vgc a.vgc-act .tt{display:flex;flex-direction:column;min-width:0}
.vgc a.vgc-act .lb{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.vgc a.vgc-act .vl{font-size:15px;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vgc a.vgc-act.zalo .ico{background:#eaf1fb;color:#0068ff}
.vgc a.vgc-act.insta .ico{background:#fdeef4;color:#c13584}
.vgc .vgc-save{margin-top:16px}
.vgc a.vgc-savebtn{width:100%;text-decoration:none;display:flex;align-items:center;justify-content:center;gap:10px;
  background:linear-gradient(158deg,var(--teal),var(--teal-deep));color:#fff;
  font-size:15px;font-weight:800;letter-spacing:.01em;border-radius:14px;padding:15px;
  box-shadow:0 8px 20px -8px rgba(11,92,85,.6);-webkit-tap-highlight-color:transparent}
.vgc a.vgc-savebtn:active{transform:scale(.99)}
.vgc a.vgc-savebtn svg{width:19px;height:19px}
.vgc .vgc-savehint{margin-top:8px;text-align:center;font-size:11.5px;color:var(--muted)}
.vgc .vgc-foot{margin-top:22px;text-align:center;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#9AAAA6}
`;

export default async function CardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const p = getPerson(id);
  if (!p) notFound();

  return (
    <div className="vgc">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="vgc-wrap">
        <header className="vgc-hero">
          <div className="vgc-brand">
            <Pin color="#ffffff" />
            <span className="vgc-wm">
              Villa <span>Go</span>
            </span>
          </div>
          <div className="vgc-tag">
            푸꾸옥 프리미엄 풀빌라 · Premium Pool Villas in Phu Quoc
          </div>
        </header>

        <main className="vgc-sheet">
          <div className="vgc-idrow">
            <div>
              <h1 className="vgc-name">
                {p.nameEn}
                <span className="vgc-ko">{p.nameKo}</span>
              </h1>
              <span className="vgc-role">{p.role}</span>
            </div>
            <span className="vgc-pinmini">
              <Pin color="#12897F" />
            </span>
          </div>

          <div className="vgc-actions">
            <a className="vgc-act" href={`tel:${p.tel}`}>
              <span className="ico">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.4-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
                </svg>
              </span>
              <span className="tt">
                <span className="lb">Call · 전화</span>
                <span className="vl">{p.telDisp}</span>
              </span>
            </a>

            <a className="vgc-act zalo" href={p.zaloUrl} target="_blank" rel="noopener noreferrer">
              <span className="ico">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.4 8.6 8.6 0 0 1-3.9-.9L3 20l1.1-4.4A8.4 8.4 0 1 1 21 11.5z" />
                </svg>
              </span>
              <span className="tt">
                <span className="lb">Zalo</span>
                <span className="vl">Chat on Zalo</span>
              </span>
            </a>

            <a className="vgc-act" href={`mailto:${p.email}`}>
              <span className="ico">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <path d="m2 6 10 7L22 6" />
                </svg>
              </span>
              <span className="tt">
                <span className="lb">Email</span>
                <span className="vl">{p.email}</span>
              </span>
            </a>

            <a className="vgc-act insta" href="https://instagram.com/biz.villago" target="_blank" rel="noopener noreferrer">
              <span className="ico">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="2" width="20" height="20" rx="5" />
                  <circle cx="12" cy="12" r="4" />
                  <circle cx="17.5" cy="6.5" r="1.1" fill="currentColor" stroke="none" />
                </svg>
              </span>
              <span className="tt">
                <span className="lb">Instagram</span>
                <span className="vl">@biz.villago</span>
              </span>
            </a>

            <a className="vgc-act" href="https://villa-go.net" target="_blank" rel="noopener noreferrer">
              <span className="ico">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M3 12h18M12 3c2.6 2.7 2.6 15.3 0 18M12 3c-2.6 2.7-2.6 15.3 0 18" />
                </svg>
              </span>
              <span className="tt">
                <span className="lb">Website</span>
                <span className="vl">villa-go.net</span>
              </span>
            </a>
          </div>

          <div className="vgc-save">
            <a className="vgc-savebtn" href={`/card/${p.id}/vcard`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21v-8H5v8" />
                <path d="M7 3v5h8" />
                <path d="M21 21H3V3h13l5 5v13z" />
              </svg>
              <span>연락처 저장 · Save to contacts</span>
            </a>
            <div className="vgc-savehint">전화번호부에 저장 (.vcf) · Lưu vào danh bạ</div>
          </div>

          <div className="vgc-foot">Phu Quoc · Vietnam</div>
        </main>
      </div>
    </div>
  );
}
