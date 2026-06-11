/** c1/c2 공통 한국어 푸터 — T5.5: 영문 보일러플레이트 제거, ko 링크 3종 */
export function PublicFooter() {
  return (
    <footer className="w-full px-6 py-12 flex flex-col gap-4 text-center bg-neutral-50 border-t border-neutral-200">
      <div className="font-bold text-neutral-900">Villa PMS Phu Quoc</div>
      <div className="flex justify-center gap-4">
        <a className="text-sm text-neutral-500 hover:text-teal-600 transition-colors" href="#">
          이용약관
        </a>
        <a className="text-sm text-neutral-500 hover:text-teal-600 transition-colors" href="#">
          개인정보처리방침
        </a>
        <a className="text-sm text-neutral-500 hover:text-teal-600 transition-colors" href="#">
          보증금 정책
        </a>
      </div>
      <p className="text-sm text-neutral-500">© 2026 Villa PMS Phu Quoc</p>
    </footer>
  );
}
