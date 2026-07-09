// 마법사 단계 인라인 가이드 배너 (T-tutorial-onboarding-4) — 전산 초보 대상 "지금 뭘 + 왜" 한 문장.
// UX-VN 확정 사양: teal 톤(앰버는 경고 계열로 이미 소비)·info 아이콘 고정·화면당 1개·최대 2문장·닫기 없음.
// 코치마크(1회성)와 달리 항상 보이는 정적 안내 — 매번 참조 가능.
export function WizardGuide({ text }: { text: string }) {
  return (
    <div className="flex gap-3 rounded-xl border border-teal-100 bg-teal-50 p-3.5">
      <span className="material-symbols-outlined shrink-0 text-teal-600" aria-hidden>
        info
      </span>
      <p className="text-sm leading-snug text-neutral-700">{text}</p>
    </div>
  );
}
