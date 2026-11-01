import process from 'node:process'

import { WowAddonRecommendations } from '../src/main/services/airi/wow-addon-recommendations'
import { CurseForgeCatalog } from '../src/main/services/airi/wow-addons-catalog'
import { resolveAddonVersionType } from '../src/shared/wow-addons'

// Explicit, read-only acceptance check. Supply the key through the environment, never a command argument or log.
const apiKey = process.env.WOW_ADDONS_API_KEY
delete process.env.WOW_ADDONS_API_KEY
if (!apiKey)
  throw new Error('WOW_ADDONS_API_KEY is required')
const catalog = new CurseForgeCatalog(apiKey)
try {
  const metadata = await catalog.getMetadata()
  const version = resolveAddonVersionType(metadata, 'retail', null)
  if (!version)
    throw new Error('Retail version could not be resolved')
  const report = await new WowAddonRecommendations(catalog).search({ game: 'retail', query: 'bags' }, metadata, version)
  console.info(JSON.stringify({ checkedAt: new Date().toISOString(), categoryCount: metadata.categories.length, version: version.name, count: report.addons.length, addons: report.addons.map(addon => ({ name: addon.name, downloadCount: addon.downloadCount, gameVersions: addon.gameVersions, websiteUrl: addon.websiteUrl, installable: addon.installable, unavailableReason: addon.unavailableReason })) }, null, 2))
}
finally {
  catalog.dispose()
}
