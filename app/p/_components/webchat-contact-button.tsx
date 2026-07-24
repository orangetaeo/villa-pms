"use client";

// 제안 만료/마감 뷰의 "웹채팅으로 문의" 버튼 — 레이아웃에 이미 마운트된 웹챗 위젯(FAB)을 연다.
//   위젯 로더(public/webchat-loader.js)가 노출하는 전역 훅 window.__vgOpenWebChat 을 호출한다.
//   버튼 클릭이 로더 로드보다 빠를 수 있으므로(비동기 주입) pending 플래그+이벤트로 예약도 지원.
//   → 로더가 mount 시점에 pending 을 확인해 위젯을 연다(로드 순서 무관).
declare global {
  interface Window {
    __vgOpenWebChat?: () => void;
    __vgWebChatOpenPending?: boolean;
  }
}

export function WebchatContactButton({ label }: { label: string }) {
  function open() {
    if (typeof window.__vgOpenWebChat === "function") {
      window.__vgOpenWebChat();
      return;
    }
    // 로더 미로드 — 예약 후 이벤트 발신(로더가 준비되면 즉시 연다)
    window.__vgWebChatOpenPending = true;
    window.dispatchEvent(new Event("vg:webchat:open"));
  }

  return (
    <button
      type="button"
      onClick={open}
      className="w-full h-14 bg-teal-600 text-white font-bold rounded-xl flex items-center justify-center gap-2 shadow-[0_4px_12px_rgba(15,148,136,0.25)] transition-transform active:scale-[0.98]"
    >
      <span className="material-symbols-outlined icon-fill">forum</span>
      {label}
    </button>
  );
}
