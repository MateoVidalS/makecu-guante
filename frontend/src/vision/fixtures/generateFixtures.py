"""Synthetic upright and legacy palm-down hands, NOT real glove/webcam validation.

Run from the repository root. Writes only this owned fixture directory; the
legacy shared contract fixtures remain frozen. Distances are metres. The camera
is 36 cm away, in front on the thumb side and above a palm-down right hand.
"""

import json
import math
from pathlib import Path

OUTPUT = Path(__file__).resolve().parent
# Long-finger MCP/PIP/DIP and thumb MCP/IP. Thumb is free for hook/tabletop.
POSES = {
    "open": ((0, 0, 0), (0, 0)),
    "tabletop": ((90, 0, 0), (20, 10)),
    "hook": ((0, 90, 70), (10, 10)),
    "straight_fist": ((90, 100, 0), (40, 30)),
    "full_fist": ((90, 100, 80), (50, 50)),
    "pinch": ((50, 50, 20), (30, 30)),
}


def add(a, b):
    return [x + y for x, y in zip(a, b)]


def scale(v, s):
    return [x * s for x in v]


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def unit(v):
    return scale(v, 1 / math.hypot(*v))


def cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def model(name, angles, thumb_angles):
    points = [[0.0, 0.0, 0.0] for _ in range(21)]
    points[1] = [-0.035, 0.025, 0.0]
    direction = unit([-1, 1, 0])
    points[2] = add(points[1], scale(direction, 0.028))
    cumulative = 0
    for i, (angle, length) in enumerate(zip(thumb_angles, (0.028, 0.022)), 3):
        cumulative += math.radians(angle)
        bone = add(scale(direction, math.cos(cumulative)), [0, 0, math.sin(cumulative)])
        points[i] = add(points[i - 1], scale(bone, length))
    for base, x, y, lengths in [
        (5, -0.028, 0.073, (0.038, 0.024, 0.018)),
        (9, 0.0, 0.08, (0.044, 0.027, 0.02)),
        (13, 0.025, 0.074, (0.041, 0.025, 0.018)),
        (17, 0.045, 0.06, (0.032, 0.02, 0.016)),
    ]:
        points[base] = [x, y, 0.0]
        direction = unit(points[base])
        cumulative = 0
        finger_angles = (0, 0, 0) if name == "pinch" and base != 5 else angles
        for i, (angle, length) in enumerate(zip(finger_angles, lengths), 1):
            cumulative += math.radians(angle)
            bone = add(scale(direction, math.cos(cumulative)), [0, 0, math.sin(cumulative)])
            points[base + i] = add(points[base + i - 1], scale(bone, length))
    if name == "pinch":
        # Synthetic helper-assisted thumb tip contact, not anatomical validation.
        target = add(points[8], [0.001, 0, 0])
        points[3] = add(scale(points[2], 0.4), scale(target, 0.6))
        points[3][2] -= 0.008
        points[4] = target
    return points


for view in ("front_diagonal", "front_upright"):
    target = [0, 0.065, 0]
    upright = view == "front_upright"
    position = add(target, [0, 0, 0.5] if upright else scale(unit([-0.55, 0.65, -0.52]), 0.36))
    forward = unit(add(target, scale(position, -1)))
    right = unit(cross(forward, [0, 1, 0] if upright else [0, 0, -1]))
    up = cross(right, forward)
    for name, (angles, thumb_angles) in POSES.items():
        frames = []
        for i in range(30):
            rotation = 0.025 * math.sin(i * 0.4)
            c, s = math.cos(rotation), math.sin(rotation)
            points = [[c * x - s * y + i * 0.00002, s * x + c * y, z] for x, y, z in model(name, angles, thumb_angles)]
            world, image = [], []
            wrist_depth = dot(add(points[0], scale(position, -1)), forward)
            for p in points:
                world.append([round(dot(p, right), 8), round(-dot(p, up), 8), round(dot(p, forward), 8)])
                offset = add(p, scale(position, -1))
                depth = dot(offset, forward)
                image.append([
                    round(0.5 + 480 * dot(offset, right) / depth / 640, 8),
                    round(0.5 - 480 * dot(offset, up) / depth / 480, 8),
                    round((depth - wrist_depth) * 480 / wrist_depth / 640, 8),
                ])
            frames.append({"t": round(i * 1000 / 30, 5), "worldLandmarks": world, "landmarks": image})
        fixture = {
            "source": "synthetic forward-kinematic model; NOT real webcam or glove recordings",
            "generator": "frontend/src/vision/fixtures/generateFixtures.py",
            "pose": name, "affectedHand": "right", "score": 0.95, "fps": 30,
            "posture": "upright; palm to laptop webcam; elbow supported; fingers curl toward lens" if upright else "palm-down; wrist fixed at table edge; fingers close down into free space",
            "camera": {"view": "front upright, palm to lens, no rotation" if upright else "front diagonal, thumb side, above hand", "distanceCm": 50 if upright else 36},
            "frames": frames,
        }
        prefix = "front_upright" if upright else "palm-down"
        (OUTPUT / f"{prefix}_{name}.json").write_text(json.dumps(fixture, separators=(",", ":")) + "\n")
