"use client";

// 동의서 섹션 (T3.2, b3 §3 변환) — 스크롤 동의서(수영장 조항은 hasPool일 때만 자동 포함,
// SPEC F4 체크인 4) + 터치 서명 패드. 서명 완료 시 비공개 경로 url을 부모에 전달.
// 동의서 본문은 lib/agreement 단일 소스에서 현재 앱 로케일(ko/vi)로 렌더(인쇄 시트와 공용).
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  agreementVersionLabel,
  buildClauseOrder,
  type AgreementContent,
  type AgreementClauseKey,
  type AgreementLang,
} from "@/lib/agreement";
import SignaturePad from "./signature-pad";

export default function AgreementSection({
  hasPool,
  sectionNo,
  agreement,
  onSigned,
}: {
  hasPool: boolean;
  /** b3 섹션 번호 배지 (체크인 폼 3, 사후 서명 모드 1) */
  sectionNo: number;
  /** 발행본 동의서 콘텐츠(운영자 편집본 또는 코드 기본값) — RSC에서 store 조회 후 주입 */
  agreement: AgreementContent;
  onSigned: (url: string) => void;
}) {
  const t = useTranslations("adminCheckin.agreement");
  const locale = useLocale();
  const lang: AgreementLang = locale === "vi" ? "vi" : "ko"; // 디지털 체크인은 앱 로케일(ko/vi)
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  // 수영장 빌라는 c2 다음에 수영장 조항 자동 삽입 — 번호는 순서대로 재부여
  const clauses = buildClauseOrder(hasPool);

  return (
    <section className="bg-slate-800 rounded-xl border border-slate-700 shadow-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-700 flex items-center gap-3">
        <span className="w-7 h-7 flex items-center justify-center bg-blue-600 rounded-full text-xs font-bold text-white">
          {sectionNo}
        </span>
        <h3 className="font-bold text-slate-100">{t("title")}</h3>
      </div>
      <div className="p-6 space-y-6">
        <div className="h-48 overflow-y-auto bg-slate-900 border border-slate-700 rounded-lg p-4 text-xs text-slate-400 leading-relaxed space-y-3">
          <p className="font-bold text-slate-200">{agreement.docTitle[lang]}</p>
          {clauses.map((key, i) =>
            key === "pool" ? (
              <div key={key} className="bg-blue-600/10 border-l-2 border-blue-500 p-2 my-2">
                <p className="text-blue-400 font-bold">
                  {i + 1}. {agreement.clauses.pool[lang]}
                </p>
              </div>
            ) : (
              <p key={key}>
                {i + 1}. {agreement.clauses[key as AgreementClauseKey][lang]}
              </p>
            )
          )}
          <p className="text-[10px] text-slate-600 pt-1">{agreementVersionLabel(agreement)}</p>
        </div>

        {signedUrl ? (
          <div className="flex items-center justify-end">
            <span className="px-3 py-1 bg-green-500/20 text-green-500 border border-green-500/30 rounded-md text-xs font-black tracking-widest flex items-center gap-1.5">
              <span className="material-symbols-outlined icon-fill text-sm">draw</span>
              {t("signedBadge")}
            </span>
          </div>
        ) : (
          <SignaturePad
            onSigned={(url) => {
              setSignedUrl(url);
              onSigned(url);
            }}
          />
        )}
      </div>
    </section>
  );
}
