"use client";

/** c1 헤더 공유 버튼 — Web Share API, 미지원 시 URL 복사 */
export function ShareButton({ title }: { title: string }) {
  const onShare = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      alert("링크가 복사되었습니다");
    } catch {
      // 사용자 취소 등 — 무시
    }
  };

  return (
    <button
      type="button"
      onClick={onShare}
      aria-label="공유"
      className="text-teal-600 hover:bg-neutral-50 transition-colors duration-200 p-2 rounded-full"
    >
      <span className="material-symbols-outlined">share</span>
    </button>
  );
}
