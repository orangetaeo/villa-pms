"use client";

// 동의서 섹션 (T3.2, b3 §3 변환) — 스크롤 동의서 + 터치 서명 패드.
// 서명 완료 시 비공개 경로 url을 부모에 전달. 본문은 발행본(body) 자유 텍스트를 줄바꿈 보존 렌더.
// 현재 앱 로케일(ko/vi)로 표시(인쇄 시트는 게스트 5개 언어 선택 가능).
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  agreementVersionLabel,
  type AgreementContent,
  type AgreementLang,
} from "@/lib/agreement";
import SignaturePad from "./signature-pad";

export default function AgreementSection({
  sectionNo,
  agreement,
  onSigned,
}: {
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

  return (
    <section className="bg-slate-800 rounded-xl border border-slate-700 shadow-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-700 flex items-center gap-3">
        <span className="w-7 h-7 flex items-center justify-center bg-blue-600 rounded-full text-xs font-bold text-white">
          {sectionNo}
        </span>
        <h3 className="font-bold text-slate-100">{t("title")}</h3>
      </div>
      <div className="p-6 space-y-6">
        <div className="h-48 overflow-y-auto bg-slate-900 border border-slate-700 rounded-lg p-4 text-xs text-slate-400 leading-relaxed space-y-2">
          <p className="font-bold text-slate-200">{agreement.docTitle[lang]}</p>
          {/* 자유 텍스트 본문 — 운영자가 번호 매긴 그대로 줄바꿈 보존 */}
          <p className="whitespace-pre-line">{agreement.body[lang]}</p>
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
