#!/usr/bin/env python3
"""Happy-jump-only local correspondence guides for continuous motion.

Guides are image landmarks, not an anatomical skeleton. They constrain flow
between selected authored poses without changing the drawings or selecting
endpoints at a temporal threshold. Other pose pairs use the global Tween.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path

import cv2
import numpy as np

_spec = importlib.util.spec_from_file_location("jump_continuous_base", Path(__file__).with_name("continuous-motion.py"))
base = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(base)
METHOD = "happy_jump_local_arm_rotation_guided_continuous_flow_v1"

# Screen-left then screen-right: shoulder, elbow, wrist, hand center.
# Coordinates refer to the renderer's 320px aligned poses, including neutral=0.
GUIDE_DATA = json.loads(Path(__file__).with_name("jump-arm-guides.json").read_text())
GUIDES = {cls: {int(i): points for i, points in data["points"].items()}
          for cls, data in GUIDE_DATA["classes"].items()}


def _distance_to_arm(grid, points):
    result = np.full(grid.shape[:2], np.inf, np.float32)
    for a, b in zip(points[:-1], points[1:]):
        ab = b - a
        t = np.clip(np.sum((grid - a) * ab, axis=2) / max(float(np.dot(ab, ab)), 1e-6), 0, 1)
        result = np.minimum(result, np.sum((grid - a - t[..., None] * ab) ** 2, axis=2))
    return result


class Tween(base.Tween):
    def __init__(self, frames, class_id, *, guides=None, guide_width=14.0):
        super().__init__(frames)
        self.class_id = class_id
        self.guides = guides if guides is not None else GUIDES.get(class_id, {})
        self.guide_width = guide_width
        if guides is None and class_id in GUIDE_DATA["classes"]:
            for index, expected in GUIDE_DATA["classes"][class_id]["aligned_frame_rgba_sha256"].items():
                if hashlib.sha256(frames[int(index)].tobytes()).hexdigest() != expected:
                    raise ValueError(f"Stale happy-jump arm guide: {class_id}/frame {index}")

    def inverse_maps(self, i, j, amount):
        t = float(amount * amount * (3 - 2 * amount))
        f, b, ca, cb = self.pair(i, j)
        ma, mb = self.grid - t * f, self.grid - (1 - t) * b
        for _ in range(5):
            ma = .5 * ma + .5 * (self.grid - t * base.remap(f, ma))
            mb = .5 * mb + .5 * (self.grid - (1 - t) * base.remap(b, mb))
        mask_union = np.zeros(self.grid.shape[:2], np.float32)
        paths = []
        if i in self.guides and j in self.guides:
            pa, pb = np.asarray(self.guides[i], np.float32), np.asarray(self.guides[j], np.float32)
            for offset in (0, 4):
                a0, a1 = pa[offset], pa[offset + 3]
                b0, b1 = pb[offset], pb[offset + 3]
                av, bv = a1 - a0, b1 - b0
                la, lb = float(np.linalg.norm(av)), float(np.linalg.norm(bv))
                aa, ab = float(np.arctan2(av[1], av[0])), float(np.arctan2(bv[1], bv[0]))
                delta = float(np.arctan2(np.sin(ab - aa), np.cos(ab - aa)))
                angle, length = aa + t * delta, (1 - t) * la + t * lb
                origin = (1 - t) * a0 + t * b0
                direction = np.array([np.cos(angle), np.sin(angle)], np.float32)
                tip = origin + length * direction
                distance2 = _distance_to_arm(self.grid, np.array([origin, tip]))
                mask = np.exp(-.5 * np.square(distance2 / self.guide_width ** 2))
                # Taper away from shoulder, preserving face/torso registration.
                along = np.sum((self.grid - origin) * direction, axis=2) / length
                ramp = np.clip(along / .4, 0, 1)
                mask *= ramp * ramp * (3 - 2 * ramp)

                def inverse(source_angle, source_length, anchor):
                    d = source_angle - angle
                    c, s = np.cos(d), np.sin(d)
                    rotation = np.array([[c, -s], [s, c]], np.float32)
                    return ((self.grid - origin) @ rotation.T) * (source_length / length) + anchor

                ma = ma * (1 - mask[..., None]) + inverse(aa, la, a0) * mask[..., None]
                mb = mb * (1 - mask[..., None]) + inverse(ab, lb, b0) * mask[..., None]
                mask_union = np.maximum(mask_union, mask)
                paths.append({"origin": origin, "hand_center": tip, "source_hand": a1, "target_hand": b1})
        return ma.astype(np.float32), mb.astype(np.float32), ca, cb, mask_union, paths

    def frame_premul(self, i, j, amount):
        if i == j or amount <= 0 or amount >= 1 or i not in self.guides or j not in self.guides:
            return super().frame_premul(i, j, amount)
        if not np.isfinite(amount):
            raise ValueError("Interpolation amount must be finite")
        t = float(amount * amount * (3 - 2 * amount))
        ma, mb, ca, cb, _, _ = self.inverse_maps(i, j, amount)
        a, z = base.remap(self.premul[i], ma), base.remap(self.premul[j], mb)
        ac, bc = base.remap(ca, ma), base.remap(cb, mb)
        disagreement = np.max(np.abs(a - z), axis=2)
        uncertainty = 1 - np.exp(-disagreement / .16) * (1 - (1 - ac) * (1 - bc))
        exponent = 1 + 1.5 * cv2.GaussianBlur(uncertainty, (0, 0), .7)
        wa = np.power(1 - t, exponent) * np.power(.06 + .94 * cv2.GaussianBlur(ac, (0, 0), 2), 6)
        wb = np.power(t, exponent) * np.power(.06 + .94 * cv2.GaussianBlur(bc, (0, 0), 2), 6)
        blend = wb / (wa + wb)
        return a * (1 - blend[..., None]) + z * blend[..., None]
