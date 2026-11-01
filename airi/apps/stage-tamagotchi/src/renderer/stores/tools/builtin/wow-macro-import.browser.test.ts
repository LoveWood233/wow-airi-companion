import type { MacroImportResult } from '../../../../shared/wow-macro-import'

import { createContext, defineInvokeHandler } from '@moeru/eventa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'vue-sonner'

import { wowMacroImport } from '../../../../shared/eventa/wow-macro-import'
import { i18n } from '../../../modules/i18n'
import { wowMacroImportTools } from './wow-macro-import'

const boundary = vi.hoisted(() => ({
  context: undefined as ReturnType<typeof createContext<unknown, { raw?: unknown }>> | undefined,
  invoke: vi.fn<() => Promise<MacroImportResult>>(),
}))
vi.mock('@moeru/eventa/adapters/electron/renderer', () => ({
  createContext: () => ({ context: boundary.context }),
}))

const originalLocale = i18n.global.locale.value
beforeEach(() => {
  boundary.context = createContext<unknown, { raw?: unknown }>()
  boundary.invoke.mockReset()
  defineInvokeHandler(boundary.context, wowMacroImport, boundary.invoke)
  vi.stubGlobal('electron', { ipcRenderer: {} })
  vi.spyOn(toast, 'loading')
  vi.spyOn(toast, 'info')
  vi.spyOn(toast, 'dismiss')
  i18n.global.locale.value = 'zh-Hans'
})
afterEach(() => {
  toast.dismiss('wow-macro-import')
  i18n.global.locale.value = originalLocale
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function importMacro() {
  const [tool] = await wowMacroImportTools()
  const raw = await tool!.execute({ game: 'retail', body: '/cast 战斗怒吼' }, { messages: [], toolCallId: 'macro-1' })
  if (typeof raw !== 'string')
    throw new TypeError('Macro import must return JSON text')
  return JSON.parse(raw)
}

describe('macro import focus feedback', () => {
  it('explains initial focus failure and requests a deliberate retry', async () => {
    boundary.invoke.mockResolvedValue({ ok: false, code: 'focus-not-acquired' })

    const result = await importMacro()

    expect(result.ok).toBe(false)
    expect(result.userMessage).toContain('请先切回魔兽世界')
    expect(result.userMessage).not.toContain('focus-not-acquired')
    expect(result.recoveryAction).toBe('switch-to-game-and-request-import-again')
    expect(toast.loading).toHaveBeenCalledWith(expect.stringContaining('请切换到魔兽世界'), { id: 'wow-macro-import' })
    expect(toast.info).toHaveBeenCalledWith(result.userMessage, { id: 'wow-macro-import' })
    expect(boundary.invoke).toHaveBeenCalledTimes(1)
  })

  it('explains that input stopped when focus changed during import', async () => {
    boundary.invoke.mockResolvedValue({ ok: false, code: 'focus-lost' })

    const result = await importMacro()

    expect(result.userMessage).toContain('已停止输入')
    expect(result.userMessage).not.toContain('focus-lost')
    expect(boundary.invoke).toHaveBeenCalledTimes(1)
  })

  it('uses the selected English locale for recovery', async () => {
    i18n.global.locale.value = 'en'
    boundary.invoke.mockResolvedValue({ ok: false, code: 'focus-not-acquired' })

    const result = await importMacro()

    expect(result.userMessage).toContain('Warcraft')
    expect(result.userMessage).not.toContain('focus-not-acquired')
  })

  it('reports only the saved receipt as successful and clears the pending prompt', async () => {
    const receipt = { ok: true, code: 'saved', macroName: 'WCP Import', requestId: 'request-1' }
    boundary.invoke.mockResolvedValue(receipt)

    expect(await importMacro()).toEqual(receipt)
    expect(toast.dismiss).toHaveBeenCalledWith('wow-macro-import')
    expect(boundary.invoke).toHaveBeenCalledTimes(1)
  })

  it('clears the prompt when the desktop rejects the operation', async () => {
    boundary.invoke.mockRejectedValue(new Error('desktop unavailable'))

    await expect(importMacro()).rejects.toThrow('desktop unavailable')
    expect(toast.dismiss).toHaveBeenCalledWith('wow-macro-import')
    expect(boundary.invoke).toHaveBeenCalledTimes(1)
  })
})
