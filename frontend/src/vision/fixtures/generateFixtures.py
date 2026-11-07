"""Deterministic synthetic FK hand fixtures; never recorded patient data.

Run from the repo root: python3 frontend/src/vision/fixtures/generateFixtures.py
Each clip has 30 frames at 30Hz. Palm size is 8cm; bones have plausible
lengths. Tendon glide joint angles follow the product pose definitions.
Small rigid rotations/translations exercise 3D invariance without jittering
individual joints. Pinch is helper-assisted tip contact in this hand model.
"""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
POSES = {
    "open": (0, 0, 0),
    "tabletop": (90, 0, 0),
    "hook": (0, 90, 70),
    "straight_fist": (90, 90, 0),
    "full_fist": (90, 100, 70),
    "pinch": (35, 45, 20),
}


def add(a, b):
    return [x + y for x, y in zip(a, b)]


def scale(v, s):
    return [x * s for x in v]


def model(angles, pinch):
    points = [[0.0, 0.0, 0.0] for _ in range(21)]
    points[1] = [-0.035, 0.025, 0.0]
    points[2] = [-0.055, 0.045, 0.0]
    points[3] = [-0.075, 0.065, 0.0]
    points[4] = [-0.09, 0.08, 0.0]
    for base, x, y, lengths in [
        (5, -0.028, 0.073, (0.038, 0.024, 0.018)),
        (9, 0.0, 0.08, (0.044, 0.027, 0.02)),
        (13, 0.025, 0.074, (0.041, 0.025, 0.018)),
        (17, 0.045, 0.06, (0.032, 0.02, 0.016)),
    ]:
        points[base] = [x, y, 0.0]
        unit = scale(points[base], 1 / math.hypot(x, y))
        cumulative = 0
        for i, (angle, length) in enumerate(zip(angles, lengths), 1):
            cumulative += math.radians(angle)
            direction = add(scale(unit, math.cos(cumulative)), [0, 0, math.sin(cumulative)])
            points[base + i] = add(points[base + i - 1], scale(direction, length))
    if pinch:
        target = add(points[8], [0.001, 0.0, 0.0])
        # A bent thumb ending in tip contact; no duplicated or zero-length bones.
        points[2] = [-0.04, 0.04, 0.005]
        points[3] = add(scale(points[2], 0.4), scale(target, 0.6))
        points[3][2] += 0.008
        points[4] = target
    elif angles[0] > 0:
        points[3] = add(points[2], [0.0, 0.014, 0.022])
        points[4] = add(points[3], [0.014, -0.004, 0.015])
    return points


for name, angles in POSES.items():
    frames = []
    for i in range(30):
        rotation = 0.025 * math.sin(i * 0.4)
        c, s = math.cos(rotation), math.sin(rotation)
        world = []
        for x, y, z in model(angles, name == "pinch"):
            world.append([round(c * x - s * y + i * 0.00002, 8), round(s * x + c * y, 8), round(z, 8)])
        image = [[round(0.5 + x / 0.25, 8), round(0.85 - y / 0.25, 8), round(z / 0.25, 8)] for x, y, z in world]
        frames.append({"t": round(i * 1000 / 30, 5), "worldLandmarks": world, "landmarks": image})
    fixture = {"source": "synthetic forward-kinematic hand model (not webcam recordings)", "generator": "frontend/src/vision/fixtures/generateFixtures.py", "pose": name, "handedness": "right", "score": 0.95, "fps": 30, "frames": frames}
    path = ROOT / "contracts" / "fixtures" / f"landmarks_{name}.json"
    path.write_text(json.dumps(fixture, separators=(",", ":")) + "\n")
