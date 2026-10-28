import type { MenuItemConstructorOptions } from 'electron'

import type { I18n } from '../i18n'

/** Native commands retain their Electron roles when the interface language changes. */
export function applicationMenuTemplate(i18n: Pick<I18n, 't'>): MenuItemConstructorOptions[] {
  const item = (role: NonNullable<MenuItemConstructorOptions['role']>, key: string): MenuItemConstructorOptions => ({
    role,
    label: i18n.t(`companion-ui.menu.${key}`),
  })
  return [
    { label: i18n.t('companion-ui.menu.file'), submenu: [item('close', 'close'), item('quit', 'quit')] },
    {
      label: i18n.t('companion-ui.menu.edit'),
      submenu: [item('undo', 'undo'), item('redo', 'redo'), { type: 'separator' }, item('cut', 'cut'), item('copy', 'copy'), item('paste', 'paste'), item('selectAll', 'select-all')],
    },
    {
      label: i18n.t('companion-ui.menu.view'),
      submenu: [item('reload', 'reload'), item('forceReload', 'force-reload'), item('toggleDevTools', 'devtools'), { type: 'separator' }, item('resetZoom', 'actual-size'), item('zoomIn', 'zoom-in'), item('zoomOut', 'zoom-out'), { type: 'separator' }, item('togglefullscreen', 'fullscreen')],
    },
    { label: i18n.t('companion-ui.menu.window'), submenu: [item('minimize', 'minimize'), item('zoom', 'zoom'), item('front', 'front')] },
  ]
}
