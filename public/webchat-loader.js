/* public/webchat-loader.js — Villa GO 웹챗 로더 (T-webchat-mvp)
 *
 * 의존성 0 · 전역 오염 0(IIFE) · 인라인 스타일. 우하단 플로팅 버튼 → iframe(/webchat/widget) 토글.
 * iframe은 첫 오픈 시 lazy 생성(폴링 비용 절약). 재방문 미확인 답장은 1회 GET으로 뱃지만 표시.
 * ⚠ public/*.js는 Next 해시 미부여 + CF 엣지 캐시 → intro.html은 `?v=` 캐시버스팅으로 참조(기획 §9).
 * sourcePage(?src=) 지정 방법 2가지:
 *   ① 정적 HTML(intro 3종): <script … data-page="…"> 속성 (currentScript 경유)
 *   ② Next 라우트: window.__VG_WEBCHAT_PAGE 전역 (Next <Script>/동적 주입은 currentScript=null)
 * 선택: window.__VG_WEBCHAT_OFFSET(px) = FAB·데스크톱 패널 하단 오프셋(하단 고정 CTA 회피용).
 */
(function () {
  "use strict";
  if (window.__villaWebChatLoaded) return;
  window.__villaWebChatLoaded = true;

  var TEAL = "#0F9488";
  var TEAL_DEEP = "#093B36";
  var LS_LAST_SEEN = "webchat:lastSeen";

  // data-page: ① 스크립트 태그 속성 → ② 전역(__VG_WEBCHAT_PAGE) 폴백.
  //   Next 동적 주입 스크립트는 실행 시점 document.currentScript=null·마지막 태그 보장 없음 →
  //   전역이 신뢰 가능한 경로. 정적 intro HTML(defer)은 currentScript로 data-page를 읽는다.
  var thisScript =
    document.currentScript ||
    (function () {
      var s = document.getElementsByTagName("script");
      return s[s.length - 1];
    })();
  var dataPage =
    (thisScript && thisScript.getAttribute("data-page")) ||
    (typeof window.__VG_WEBCHAT_PAGE === "string" ? window.__VG_WEBCHAT_PAGE : "") ||
    "";

  // 하단 오프셋(px) — /g·/p의 sticky 하단 CTA와 겹치지 않게 FAB·패널을 위로 올린다.
  var offset = 0;
  try {
    var o = window.__VG_WEBCHAT_OFFSET;
    if (typeof o === "number" && isFinite(o) && o > 0) offset = o;
  } catch (e) {
    /* 무시 */
  }

  var open = false;
  var iframe = null;
  var panel = null;
  var badge = null;

  function isMobile() {
    return window.matchMedia && window.matchMedia("(max-width: 640px)").matches;
  }

  // ── 플로팅 버튼 ──
  var btn = document.createElement("button");
  btn.type = "button";
  btn.setAttribute("aria-label", "Chat");
  btn.style.cssText = [
    "position:fixed",
    "right:18px",
    "bottom:calc(" + (18 + offset) + "px + env(safe-area-inset-bottom))",
    "width:58px",
    "height:58px",
    "border-radius:50%",
    "border:0",
    "background:" + TEAL,
    "color:#fff",
    "box-shadow:0 6px 20px rgba(9,59,54,.32)",
    "cursor:pointer",
    "z-index:2147483000",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "padding:0",
  ].join(";");
  btn.innerHTML =
    '<svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
    '<path d="M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3 21l1.9-5.6A8.5 8.5 0 1 1 21 11.5z" stroke-linejoin="round"/></svg>';

  // ── 미확인 뱃지 ──
  badge = document.createElement("span");
  badge.style.cssText = [
    "position:absolute",
    "top:-3px",
    "right:-3px",
    "min-width:20px",
    "height:20px",
    "padding:0 5px",
    "border-radius:10px",
    "background:#F5990E",
    "color:#3A2400",
    "font:700 12px/20px system-ui,-apple-system,sans-serif",
    "text-align:center",
    "display:none",
    "box-shadow:0 0 0 2px #fff",
  ].join(";");
  btn.appendChild(badge);

  function setBadge(n) {
    if (n > 0) {
      badge.textContent = n > 9 ? "9+" : String(n);
      badge.style.display = "block";
    } else {
      badge.style.display = "none";
    }
  }

  // ── iframe lazy 생성 ──
  function ensureIframe() {
    if (iframe) return;
    panel = document.createElement("div");
    iframe = document.createElement("iframe");
    var src = "/webchat/widget?src=" + encodeURIComponent(dataPage);
    iframe.src = src;
    iframe.title = "Villa GO chat";
    iframe.setAttribute("allow", "clipboard-write");
    iframe.style.cssText = "border:0;width:100%;height:100%;background:transparent;display:block";
    panel.appendChild(iframe);
    applyPanelStyle();
    document.body.appendChild(panel);
    window.addEventListener("resize", applyPanelStyle);
  }

  function applyPanelStyle() {
    if (!panel) return;
    if (isMobile()) {
      panel.style.cssText = [
        "position:fixed",
        "inset:0",
        "z-index:2147483001",
        "background:#F7FAF9",
        "box-shadow:none",
        "border-radius:0",
        "overflow:hidden",
      ].join(";");
    } else {
      panel.style.cssText = [
        "position:fixed",
        "right:18px",
        "bottom:calc(" + (88 + offset) + "px + env(safe-area-inset-bottom))",
        "width:380px",
        "height:560px",
        "max-height:calc(100vh - 110px)",
        "z-index:2147483001",
        "background:#F7FAF9",
        "border-radius:16px",
        "box-shadow:0 12px 40px rgba(9,59,54,.28)",
        "overflow:hidden",
      ].join(";");
    }
    panel.style.display = open ? "block" : "none";
  }

  function setOpen(next) {
    open = next;
    ensureIframe();
    applyPanelStyle();
    if (open) {
      setBadge(0);
      // 버튼 아이콘 → 닫기(X)
      btn.style.display = isMobile() ? "none" : "flex";
    } else {
      btn.style.display = "flex";
    }
  }

  btn.addEventListener("click", function () {
    setOpen(!open);
  });

  // ── 위젯 내부 닫기(postMessage) ──
  window.addEventListener("message", function (e) {
    if (e && e.data === "webchat:close") setOpen(false);
  });

  // ── 페이지 내 "웹채팅 문의" 버튼용 오픈 훅 ──
  //   /p 만료·마감 뷰 등에서 body 버튼 → 위젯을 연다. 로더는 async 주입이라
  //   버튼 클릭이 먼저일 수 있어 pending 플래그(mount에서 확인)로 예약도 지원한다.
  window.__vgOpenWebChat = function () {
    setOpen(true);
  };
  window.addEventListener("vg:webchat:open", function () {
    setOpen(true);
  });

  // ── 재방문 미확인 답장 뱃지(1회, 지속 폴링 금지) ──
  function checkUnread() {
    var lastSeen = null;
    try {
      lastSeen = window.localStorage.getItem(LS_LAST_SEEN);
    } catch (err) {
      /* localStorage 차단 환경 무시 */
    }
    if (!lastSeen) return; // 대화 이력 없음 = 신규 방문자(불필요한 요청 회피)
    var url = "/api/webchat/messages?after=" + encodeURIComponent(lastSeen);
    fetch(url, { cache: "no-store", credentials: "same-origin" })
      .then(function (res) {
        if (!res.ok) return null;
        return res.json();
      })
      .then(function (data) {
        if (!data || !data.ok || !data.messages) return;
        var unread = 0;
        for (var i = 0; i < data.messages.length; i++) {
          if (data.messages[i].direction === "OUTBOUND") unread++;
        }
        if (!open) setBadge(unread);
      })
      .catch(function () {
        /* 무해 */
      });
  }

  function mount() {
    document.body.appendChild(btn);
    checkUnread();
    // 로더 로드 전에 눌린 "웹채팅 문의" 버튼의 예약 오픈 처리.
    if (window.__vgWebChatOpenPending) {
      window.__vgWebChatOpenPending = false;
      setOpen(true);
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
