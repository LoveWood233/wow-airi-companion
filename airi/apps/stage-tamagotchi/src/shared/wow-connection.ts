import type { InferOutput } from 'valibot'

import { check, finite, integer, maxValue, minValue, nullable, number, object, picklist, pipe, string } from 'valibot'

const nonnegative = pipe(number(), finite(), minValue(0))
const count = pipe(nonnegative, integer())

/** Decoder evidence for one verified game window. These fields do not establish character freshness by themselves. */
export const connectionSchema = object({
  phase: picklist(['locating', 'validating', 'connected', 'blocked', 'error']),
  reason: nullable(picklist(['window-missing', 'window-minimized', 'window-hidden', 'multiple-windows', 'window-changed', 'grid-unreadable', 'access-denied', 'capture-failed', 'calibration-save-failed', 'heartbeat-stale', 'unsupported-platform', 'window-query-failed'])),
  attempts: count,
  consecutive: pipe(count, maxValue(3)),
  lastFrameAt: nullable(string()),
  calibratedAt: nullable(string()),
  retrySeconds: nonnegative,
  calibration: nullable(object({ x: pipe(number(), finite()), y: pipe(number(), finite()), pitchX: pipe(number(), finite(), minValue(1)), pitchY: pipe(number(), finite(), minValue(1)) })),
})

/** Receiver-side progress counts unique validated fragments. A completed transfer is distinct from a fresh heartbeat. */
export const transferSchema = pipe(object({
  kind: picklist(['eq', 'cmp', 'gear', 'calendar']),
  phase: picklist(['receiving', 'complete', 'timed-out', 'error']),
  received: pipe(count, maxValue(820)),
  total: pipe(count, minValue(1), maxValue(820)),
  elapsedSeconds: nonnegative,
  timeoutSeconds: nonnegative,
}), check(value => value.received <= value.total))

export type ConnectionDiagnostic = InferOutput<typeof connectionSchema>
