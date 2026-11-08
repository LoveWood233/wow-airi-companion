import type { RetailDatabaseSource } from '@proj-airi/stage-shared/wow-knowledge'

import { picklist } from 'valibot'

export const wowDataUpdateErrorSchema = picklist([
  'configuration-invalid',
  'configuration-save-failed',
  'game-root-invalid',
  'tools-root-invalid',
  'build-info-invalid',
  'build-ambiguous',
  'python-missing',
  'dotnet-missing',
  'exporter-missing',
  'definitions-missing',
  'offline-guard-missing',
  'offline-build-required',
  'busy',
  'export-failed',
  'sqlite-failed',
  'verification-failed',
  'source-changed',
  'snapshot-invalid',
  'activation-failed',
  'cancelled',
  'filesystem-failed',
  'unsupported-platform',
])

export type WowDataUpdateError = typeof wowDataUpdateErrorSchema.options[number]
export type WowDataUpdatePhase = 'checking' | 'exporting' | 'building-sqlite' | 'verifying' | 'ready' | 'failed' | 'cancelled'

/** Folder selections stay local. Renderer actions never choose output paths or commands. */
export interface WowDataUpdateConfig {
  gameRoot: string | null
  toolsRoot: string | null
}

export interface WowDataUpdateDiscovery {
  build: string | null
  previousBuild: string | null
  changed: boolean
  checkedAt: string | null
  errorCode?: WowDataUpdateError
}

export interface WowDataUpdateCheck {
  id: 'python' | 'dotnet' | 'exporter' | 'definitions' | 'offline-guard'
  status: 'unknown' | 'ready' | 'missing' | 'invalid'
}

/** Progress reports observed table counts. A null total never represents an estimated percentage. */
export interface WowDataUpdateJob {
  id: string
  phase: WowDataUpdatePhase
  build: string | null
  startedAt: string
  updatedAt: string
  completed: number
  total: number | null
  errorCode?: WowDataUpdateError
  snapshotId?: string
}

/** Only validated runner-owned snapshots can be activated or removed by this feature. */
export interface WowDataUpdateSnapshot {
  id: string
  build: string
  createdAt: string
  source: RetailDatabaseSource
  selected: boolean
}

export interface WowDataUpdateStatus {
  config: WowDataUpdateConfig
  discovery: WowDataUpdateDiscovery
  checks: WowDataUpdateCheck[]
  job: WowDataUpdateJob | null
  snapshots: WowDataUpdateSnapshot[]
  activeSnapshotId: string | null
  activeSelection: 'none' | 'external' | 'managed'
  activeSource: RetailDatabaseSource | null
  errorCode?: WowDataUpdateError
}
