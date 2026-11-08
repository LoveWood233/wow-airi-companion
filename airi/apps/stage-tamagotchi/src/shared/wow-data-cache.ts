/** Policy and measurements refer only to disposable application-managed query cache files. */
export interface WowDataCacheStatus {
  entries: number
  bytes: number
  maxBytes: number
  staticTtlMs: number
  priceTtlMs: number
  errorCode?: 'cache-unavailable'
}
