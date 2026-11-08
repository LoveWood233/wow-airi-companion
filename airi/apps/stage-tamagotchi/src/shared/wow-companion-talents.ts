import type { InferOutput } from 'valibot'

import { array, boolean, check, integer, literal, maxLength, maxValue, minValue, nullable, number, picklist, pipe, regex, strictObject, string } from 'valibot'

const id = pipe(number(), integer(), minValue(1), maxValue(2147483647))
const rank = nullable(pipe(number(), integer(), minValue(0), maxValue(1000)))
const identity = (maximum: number) => pipe(string(), regex(/^[\w-]+$/), maxLength(maximum))
const pair = strictObject({ treeID: id, nodeID: id })
const ascending = (values: number[]) => values.every((value, index) => index === 0 || values[index - 1]! < value)
function ordered(nodes: Array<{ treeID: number, nodeID: number }>) {
  return nodes.every((value, index) => index === 0
    || nodes[index - 1]!.treeID < value.treeID || (nodes[index - 1]!.treeID === value.treeID && nodes[index - 1]!.nodeID < value.nodeID))
}

/** Stable active configuration only. Staged or inaccessible reads cannot supply learned nodes or zero-rank evidence. */
export const talentSnapshotSchema = pipe(strictObject({
  v: literal(1),
  id,
  session: identity(40),
  guid: identity(48),
  observedAt: pipe(number(), integer(), minValue(1), maxValue(4102444800)),
  source: literal('class-traits'),
  clientBuild: nullable(pipe(string(), maxLength(40), regex(/^\d+\.\d+\.\d+\.\d+$/))),
  locale: nullable(pipe(string(), regex(/^[a-z]{2}[A-Z]{2}$/))),
  class: nullable(pipe(string(), maxLength(20), regex(/^[A-Z][A-Z_]+$/))),
  classID: nullable(id),
  specID: nullable(id),
  configID: nullable(id),
  configName: nullable(pipe(string(), maxLength(128), check(value => !/[\u0000-\u001F\u007F-\u009F]/u.test(value)))),
  configType: nullable(pipe(number(), integer(), minValue(0), maxValue(1000))),
  status: picklist(['active', 'staged', 'unknown', 'inaccessible']),
  hasStagedChanges: nullable(boolean()),
  scope: literal('selected-nodes'),
  complete: boolean(),
  truncated: boolean(),
  treeIDs: pipe(array(id), maxLength(8)),
  knownZeroNodes: pipe(array(pair), maxLength(1024)),
  nodes: pipe(array(strictObject({
    treeID: id,
    nodeID: id,
    ranksPurchased: rank,
    activeRank: rank,
    maxRanks: rank,
    isAvailable: nullable(boolean()),
    isVisible: nullable(boolean()),
    meetsEdgeRequirements: nullable(boolean()),
    entriesComplete: boolean(),
    entries: pipe(array(strictObject({ entryID: id, definitionID: nullable(id), spellID: nullable(id), rank, isActive: nullable(boolean()) })), maxLength(8)),
    conditionsComplete: boolean(),
    conditions: pipe(array(strictObject({
      conditionID: id,
      isMet: nullable(boolean()),
      playerLevel: nullable(pipe(number(), integer(), minValue(0), maxValue(255))),
      spentAmountRequired: nullable(pipe(number(), integer(), minValue(0), maxValue(2147483647))),
      traitCurrencyID: nullable(id),
    })), maxLength(8)),
  })), maxLength(128)),
}), check(value => ascending(value.treeIDs) && ordered(value.nodes) && ordered(value.knownZeroNodes)
  && [...value.nodes, ...value.knownZeroNodes].every(node => value.treeIDs.includes(node.treeID))
  && value.nodes.every(node => ascending(node.entries.map(entry => entry.entryID)) && ascending(node.conditions.map(condition => condition.conditionID))
    && ((node.ranksPurchased ?? 0) > 0 || (node.activeRank ?? 0) > 0))
  && value.knownZeroNodes.every(node => !value.nodes.some(selected => selected.treeID === node.treeID && selected.nodeID === node.nodeID))
  && (value.status !== 'active' || (value.hasStagedChanges === false && value.configID !== null && [1, 4].includes(value.configType ?? -1) && value.treeIDs.length > 0))
  && (value.status !== 'staged' || value.hasStagedChanges === true)
  && (value.status === 'active' || (!value.complete && value.nodes.length === 0 && value.knownZeroNodes.length === 0))
  && (!value.complete || !value.truncated)
  && new TextEncoder().encode(JSON.stringify(value)).length <= 65536, 'Invalid committed talent evidence, ordering, coverage, or size'))

export type TalentSnapshot = InferOutput<typeof talentSnapshotSchema>
