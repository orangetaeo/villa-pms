// 인라인 가이드 배너 (T-tutorial-onboarding-4 WizardGuide 승격 → T-9 공용화) —
// 전산 초보 대상 "지금 뭘 + 왜" 안내. 코치마크(1회성 오버레이)와 달리 항상 보이는 정적 안내로,
// 인터랙티브 폼(체크인/아웃·마법사)에서는 오버레이가 작업을 방해하므로 이 형태가 정답.
// 원칙: 화면(섹션)당 1개·최대 2문장·info 아이콘 고정·닫기 없음 (UX-VN 확정).
// variant: light=라이트 포털(teal-50, 기존 WizardGuide와 바이트 동일 톤) / dark=관리자 다크 폼.
export function InlineGuide({
  text,
  variant = "light",
}: {
  text: string;
  variant?: "light" | "dark";
}) {
  if (variant === "dark") {
    return (
      <div className="flex gap-3 rounded-xl border border-teal-500/25 bg-teal-500/10 p-3.5">
        <span className="material-symbols-outlined shrink-0 text-teal-400" aria-hidden>
          info
        </span>
        <p className="text-sm leading-snug text-slate-300">{text}</p>
      </div>
    );
  }
  return (
    <div className="flex gap-3 rounded-xl border border-teal-100 bg-teal-50 p-3.5">
      <span className="material-symbols-outlined shrink-0 text-teal-600" aria-hidden>
        info
      </span>
      <p className="text-sm leading-snug text-neutral-700">{text}</p>
    </div>
  );
}
