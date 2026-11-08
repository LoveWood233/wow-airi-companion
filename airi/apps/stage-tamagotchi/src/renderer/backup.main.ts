import messages from '@proj-airi/i18n/locales'

/**
 * Storage maintenance starts without app stores, cloud sync, or chat queues.
 *
 * Call stack:
 * Electron startup
 *   -> index.html (maintenance)
 *     -> Eventa handlers
 *       -> {@link BrowserBackupStorage}
 */
import { defineInvokeHandler } from '@moeru/eventa'
import { getElectronEventaContext, useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { resolveSupportedLocale } from '@proj-airi/i18n'
import { createI18n } from 'vue-i18n'

import { wowBackupColdApply, wowBackupColdRead, wowBackupColdReady } from '../shared/eventa/wow-backup'
import { BrowserBackupStorage } from './utils/wow-browser-backup'

const locale = resolveSupportedLocale((localStorage.getItem('settings/language') || navigator.language).replace(/^"|"$/g, ''), Object.keys(messages))
const i18n = createI18n({ legacy: false, locale, fallbackLocale: 'en', messages })
const element = document.createElement('p')
element.setAttribute('role', 'status')
element.textContent = i18n.global.t('wow-companion.backup.recovering')
document.getElementById('app')?.replaceChildren(element)
document.body.style.cssText = 'margin:0;padding:32px;color:#e5e7eb;background:#171717;font:16px/1.6 system-ui,sans-serif'

const browser = new BrowserBackupStorage()
const context = getElectronEventaContext()
defineInvokeHandler(context, wowBackupColdRead, input => browser.read(input.includeChats, input.portable, input.includeSettings))
defineInvokeHandler(context, wowBackupColdApply, async (task) => {
  if (!task.data || !task.selection)
    throw new Error('backup-invalid')
  await browser.apply(task.data, task.selection, !!task.rollback)
})
void useElectronEventaInvoke(wowBackupColdReady)()
