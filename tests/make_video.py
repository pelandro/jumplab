"""Genera un video MP4 sintetico (marcatori colorati che seguono la fisica di un CMJ) per testare
decodifica, timestamp, ritaglio e finestre della pipeline senza un video reale.

Uso: python make_video.py out.mp4 [fps] [T] [rotate]
Scrive anche out.json con la verità (stacco/atterraggio in secondi).
Richiede numpy e ffmpeg (pip install imageio-ffmpeg numpy).
"""
import json, subprocess, sys
import numpy as np
import imageio_ffmpeg

out = sys.argv[1]
fps = float(sys.argv[2]) if len(sys.argv) > 2 else 240
T = float(sys.argv[3]) if len(sys.argv) > 3 else 0.5
rotate = int(sys.argv[4]) if len(sys.argv) > 4 else 0
g = 9.80665
W, H = 360, 640
H0, L = 0.95, 1.0
v0 = g * T / 2
t1, tb = 1.0, 1.5
to = tb + 0.28
depth = 0.3


def hermite(keys, t):
    if t <= keys[0][0]:
        return keys[0][1]
    for (ta, ya, va), (tb_, yb, vb) in zip(keys, keys[1:]):
        if t <= tb_:
            h = tb_ - ta
            s = (t - ta) / h
            s2, s3 = s * s, s * s * s
            return (2 * s3 - 3 * s2 + 1) * ya + (s3 - 2 * s2 + s) * h * va + (-2 * s3 + 3 * s2) * yb + (s3 - s2) * h * vb
    return keys[-1][1]


td = to + T
pre = [(0, H0, 0), (t1, H0, 0), (tb, H0 - depth, 0), (to, L, v0)]
post = [(td, L, -v0), (td + 0.25, H0 - 0.25, 0), (td + 0.8, H0, 0), (td + 3, H0, 0)]
end = td + 2.0


def state(t):
    if t < to:
        hip = hermite(pre, t)
        toe = 0.0
        heel = 0.03 + 0.07 * max(0, 1 - (to - t) / 0.2)
    elif t <= td:
        hip = L + v0 * (t - to) - 0.5 * g * (t - to) ** 2
        tuck = 0.13 * np.sin(np.pi * (t - to) / T) ** 2
        toe = hip - (L - tuck)
        heel = toe + 0.05
    else:
        hip = hermite(post, t)
        toe = 0.0
        heel = 0.03
    return hip, toe, heel


floor_y = 0.9 * H
px_per_m = H / (1.75 / 0.55)
cx = W / 2
COL = {
    'toe': (255, 0, 0), 'heel': (0, 255, 0), 'hip': (0, 0, 255), 'sh': (255, 255, 0),
    'nose': (255, 0, 255), 'knee': (0, 255, 255), 'ank': (255, 128, 0),
}


def square(img, x, y, c, r=7):
    x, y = int(round(x)), int(round(y))
    img[max(0, y - r):y + r + 1, max(0, x - r):x + r + 1] = c


ff = imageio_ffmpeg.get_ffmpeg_exe()
cmd = [ff, '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(fps), '-i', '-',
       '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-pix_fmt', 'yuv420p', '-g', '48', '-bf', '2', '-movflags', '+faststart']
if rotate:
    cmd += ['-display_rotation', str(rotate)] if False else []
cmd += [out]
proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
n = int(end * fps)
for k in range(n):
    t = k / fps
    hip, toe, heel = state(t)
    img = np.full((H, W, 3), 40, np.uint8)
    img[int(floor_y) + 8:, :] = 70
    Y = lambda m: floor_y - m * px_per_m
    square(img, cx + 14, Y(toe), COL['toe'])
    square(img, cx - 14, Y(heel), COL['heel'])
    square(img, cx - 14, Y(toe + 0.085), COL['ank'])
    square(img, cx, Y(hip - 0.45), COL['knee'])
    square(img, cx, Y(hip), COL['hip'])
    square(img, cx, Y(hip + 0.5), COL['sh'])
    square(img, cx, Y(hip + 0.78), COL['nose'])
    proc.stdin.write(img.tobytes())
proc.stdin.close()
proc.wait()
json.dump({'to': to, 'td': td, 'T': T, 'fps': fps, 'frames': n}, open(out.replace('.mp4', '.json'), 'w'))
print('ok', out, n, 'frames', 'to=%.4f td=%.4f' % (to, td))
