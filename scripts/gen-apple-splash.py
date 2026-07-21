"""iOS 설치 PWA 런치 스플래시 이미지 생성기 (public/splash/apple-splash-*.png).

iOS는 apple-touch-startup-image가 없으면 앱 부팅 동안 흰 화면을 보여준다.
teal 배경 + 흰 핀 로고(teal 집·오렌지 점) + "Villa GO" 워드마크로 인트로와 이음매 없이 연결.
media 쿼리는 app/layout.tsx의 appleWebApp.startupImage에 기기별로 매칭돼 있어야 iOS가 적용한다.

실행: python scripts/gen-apple-splash.py  (의존: Pillow)
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "splash")
os.makedirs(OUT, exist_ok=True)

TEAL = (18, 133, 122)      # #12857a — 인트로 dominant / 게이트 인라인 배경과 동일
WHITE = (255, 255, 255)
ORANGE = (245, 161, 28)    # #F5A11C
FONT_BD = r"C:\Windows\Fonts\arialbd.ttf"


def draw_pin(size):
    """200x300 좌표계 핀 로고를 size(px) 정사각 RGBA로 렌더(4x 슈퍼샘플)."""
    SS = 4
    W = H = size * SS
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    sx, sy = W / 200.0, H / 300.0

    def P(x, y):
        return (x * sx, y * sy)

    d.ellipse([*P(26, 16), *P(174, 164)], fill=WHITE)          # 원형 상단
    d.polygon([P(38, 120), P(162, 120), P(100, 246)], fill=WHITE)  # 하단 뾰족
    d.polygon([P(100, 50), P(150, 92), P(50, 92)], fill=TEAL)  # 지붕
    d.rectangle([*P(70, 88), *P(130, 140)], fill=TEAL)          # 몸체
    d.rectangle([*P(89, 116), *P(111, 140)], fill=WHITE)        # 문
    d.ellipse([*P(91, 67), *P(109, 85)], fill=ORANGE)          # 지붕점
    return img.resize((size, size), Image.LANCZOS)


def make(w, h, path):
    img = Image.new("RGB", (w, h), TEAL)
    d = ImageDraw.Draw(img)
    pin_h = int(min(w, h) * 0.30)
    pin = draw_pin(pin_h)
    cx = w // 2
    pin_top = int(h * 0.40) - pin_h // 2
    img.paste(pin, (cx - pin_h // 2, pin_top), pin)

    fs = int(pin_h * 0.42)
    try:
        font = ImageFont.truetype(FONT_BD, fs)
    except Exception:
        font = ImageFont.load_default()
    villa, go = "Villa ", "GO"
    wv = d.textlength(villa, font=font)
    total = wv + d.textlength(go, font=font)
    tx = cx - total / 2
    ty = pin_top + pin_h + int(pin_h * 0.18)
    d.text((tx, ty), villa, font=font, fill=WHITE)
    d.text((tx + wv, ty), go, font=font, fill=ORANGE)
    img.save(path, "PNG")


# (cssW, cssH, dpr) portrait — 앱은 portrait 고정
DEVICES = [
    (440, 956, 3), (402, 874, 3), (430, 932, 3), (393, 852, 3), (428, 926, 3),
    (390, 844, 3), (375, 812, 3), (414, 896, 3), (414, 896, 2), (375, 667, 2),
    (320, 568, 2),
]

if __name__ == "__main__":
    seen = set()
    for cw, ch, dpr in DEVICES:
        pw, ph = cw * dpr, ch * dpr
        if (pw, ph) in seen:
            continue
        seen.add((pw, ph))
        make(pw, ph, os.path.join(OUT, f"apple-splash-{pw}x{ph}.png"))
    print(f"generated {len(seen)} splash images into {OUT}")
