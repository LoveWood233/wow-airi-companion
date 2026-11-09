#!/usr/bin/env python3
"""Continuous, alpha-aware motion interpolation for the existing Tween API.

This is optical-flow interpolation of illustrated poses, not skeletal animation
or proof of anatomically valid joints. Unlike smooth-motion.py, this module has
no temporal endpoint switch or binary occlusion classification. All visibility
weights vary continuously. Sampling and final uint8 conversion retain normal
finite-precision image quantization.
"""
from __future__ import annotations

import hashlib

import cv2
import numpy as np

WIDTH, HEIGHT, FPS = 640, 360, 60
METHOD = "bidirectional_DIS_continuous_visibility_premultiplied_RGBA_v1"


def remap(array, coords):
    return cv2.remap(array, coords, None, cv2.INTER_LINEAR,
                     borderMode=cv2.BORDER_CONSTANT, borderValue=0)


def premultiply(rgba):
    out = rgba.astype(np.float32) / 255.0
    out[..., :3] *= out[..., 3:4]
    return out


def to_rgba(premul):
    alpha = np.clip(premul[..., 3:4], 0, 1)
    color = np.divide(premul[..., :3], alpha,
                      out=np.zeros_like(premul[..., :3]), where=alpha > 1e-5)
    return np.rint(np.clip(np.concatenate([color, alpha], axis=2), 0, 1) * 255).astype(np.uint8)


def feature(premul):
    matte = premul[..., :3] + .55 * (1 - premul[..., 3:4])
    return cv2.cvtColor(np.rint(matte * 255).astype(np.uint8), cv2.COLOR_RGB2GRAY)


def composite(rgba):
    f = rgba.astype(np.float32)
    return f[..., :3] * (f[..., 3:4] / 255) + 235 * (1 - f[..., 3:4] / 255)


def visible_hash(rgba):
    p = np.rint(premultiply(rgba) * 255).astype(np.uint8)
    return hashlib.sha256(p.tobytes()).hexdigest()


class Tween:
    """Drop-in constructor/pair/frame API; dimensions come from the frames."""

    def __init__(self, frames):
        if not frames:
            raise ValueError("At least one RGBA pose is required")
        shape = frames[0].shape
        if len(shape) != 3 or shape[2] != 4 or any(x.shape != shape for x in frames):
            raise ValueError("All poses must have the same H x W x 4 shape")
        self.frames = frames
        self.premul = [premultiply(x) for x in frames]
        self.features = [feature(x) for x in self.premul]
        h, w = shape[:2]
        self.grid = np.stack(np.meshgrid(np.arange(w, dtype=np.float32),
                                         np.arange(h, dtype=np.float32)), axis=2)
        self.cache = {}

    def pair(self, i, j):
        if (i, j) in self.cache:
            return self.cache[(i, j)]
        engine = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
        engine.setUseSpatialPropagation(True)
        engine.setFinestScale(0)
        forward = engine.calc(self.features[i], self.features[j], None)
        backward = engine.calc(self.features[j], self.features[i], None)
        forward = cv2.GaussianBlur(forward, (0, 0), 2.5)
        backward = cv2.GaussianBlur(backward, (0, 0), 2.5)
        err_a = np.linalg.norm(forward + remap(backward, self.grid + forward), axis=2)
        err_b = np.linalg.norm(backward + remap(forward, self.grid + backward), axis=2)
        conf_a, conf_b = np.exp(-err_a / 2.0), np.exp(-err_b / 2.0)
        result = forward, backward, conf_a, conf_b
        self.cache[(i, j)] = result
        self.cache[(j, i)] = backward, forward, conf_b, conf_a
        return result

    def frame_premul(self, i, j, amount):
        """Float output for inspection before uint8 alpha/color quantization."""
        if i == j or amount <= 0:
            return self.premul[i]
        if amount >= 1:
            return self.premul[j]
        if not np.isfinite(amount):
            raise ValueError("Interpolation amount must be finite")
        t = float(amount * amount * (3 - 2 * amount))
        f, b, ca, cb = self.pair(i, j)
        ma, mb = self.grid - t * f, self.grid - (1 - t) * b
        for _ in range(5):
            ma = .5 * ma + .5 * (self.grid - t * remap(f, ma))
            mb = .5 * mb + .5 * (self.grid - (1 - t) * remap(b, mb))
        a, z = remap(self.premul[i], ma), remap(self.premul[j], mb)
        ac, bc = remap(ca, ma), remap(cb, mb)

        # Soft uncertainty has no >/< threshold. A bounded exponent narrows
        # cross-fades in disagreeing regions without selecting an endpoint.
        # This retains motion throughout the transition, including its center.
        disagreement = np.max(np.abs(a - z), axis=2)
        appearance_reliability = np.exp(-disagreement / .16)
        flow_reliability = 1 - (1 - ac) * (1 - bc)
        uncertainty = 1 - appearance_reliability * flow_reliability
        uncertainty = cv2.GaussianBlur(uncertainty, (0, 0), .7)
        exponent = 1 + 1.5 * uncertainty

        # Smooth and sharpen the *continuous* confidence evidence, reducing dim
        # duplicate contours where one correspondence is more reliable. No
        # binary source selection is introduced. The nonzero prior keeps even
        # low-confidence regions well-defined and preserves exact endpoints.
        visibility_a = np.power(.06 + .94 * cv2.GaussianBlur(ac, (0, 0), 2.0), 6)
        visibility_b = np.power(.06 + .94 * cv2.GaussianBlur(bc, (0, 0), 2.0), 6)
        wa = np.power(1 - t, exponent) * visibility_a
        wb = np.power(t, exponent) * visibility_b
        blend = wb / (wa + wb)
        return a * (1 - blend[..., None]) + z * blend[..., None]

    def frame(self, i, j, amount):
        if i == j or amount <= 0:
            return self.frames[i]
        if amount >= 1:
            return self.frames[j]
        return to_rgba(self.frame_premul(i, j, amount))
