import type { MenuItemConstructorOptions } from 'electron'

import { describe, expect, it } from 'vitest'

import { createI18n } from '../i18n'
import { applicationMenuTemplate } from './application-menu'

function roles(menu: MenuItemConstructorOptions[]): string[] {
  return menu.flatMap(item => Array.isArray(item.submenu)
    ? item.submenu.flatMap(child => child.role ? [child.role] : [])
    : [])
}

describe('localized native application menu', () => {
  it('changes labels while preserving native editing, window and quit commands', () => {
    const i18n = createI18n({
      locale: 'en',
      fallbackLocale: 'en',
      messages: {
        en: { 'companion-ui': { menu: { file: 'File', edit: 'Edit' } } },
        fr: { 'companion-ui': { menu: { file: 'Fichier', edit: 'Édition' } } },
      },
    })
    const english = applicationMenuTemplate(i18n)
    i18n.locale('fr')
    const french = applicationMenuTemplate(i18n)
    expect(english[0].label).toBe('File')
    expect(french[0].label).toBe('Fichier')
    expect(french[1].label).toBe('Édition')
    expect(roles(french)).toEqual(roles(english))
    expect(roles(french)).toEqual(expect.arrayContaining(['copy', 'paste', 'close', 'quit', 'togglefullscreen']))
  })
})
