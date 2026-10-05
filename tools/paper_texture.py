"""Generate public/paper.png: a seamless, low-contrast paper texture.
Built from FFT-filtered (1/f^a) noise, so the tile wraps with no seam.
Run: uv run --with numpy --with pillow python tools/paper_texture.py
"""
import numpy as np
from PIL import Image

N = 1024

def pink(alpha: float, seed: int) -> np.ndarray:
    r = np.random.default_rng(seed)
    F = np.fft.fft2(r.standard_normal((N, N)))
    fy = np.fft.fftfreq(N)[:, None]
    fx = np.fft.fftfreq(N)[None, :]
    f = np.sqrt(fx**2 + fy**2); f[0, 0] = 1
    F /= f**alpha; F[0, 0] = 0
    x = np.real(np.fft.ifft2(F))
    return (x - x.mean()) / x.std()

grain  = pink(0.6, 1)   # fine tooth
mottle = pink(1.6, 2)   # soft cloudy clumps
fiber  = pink(1.1, 3)   # mid-scale fibers
tex = 0.7 * grain + 0.55 * mottle + 0.5 * fiber
tex = (tex - tex.mean()) / tex.std()
img = np.clip(246 + tex * 3.5, 0, 255).astype(np.uint8)   # near-white so multiply only darkens slightly
Image.fromarray(img, "L").save("public/paper.png", optimize=True)
