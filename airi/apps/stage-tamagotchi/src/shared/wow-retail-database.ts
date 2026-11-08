/** Local configuration stays in the desktop UI. Model results never include a filesystem path. */
export interface WowRetailDatabaseStatus {
  configured: boolean
  path?: string
  revision: number
  errorCode?: string
}
