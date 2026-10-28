import type { ExecutableEvidence } from './wow-launcher-windows'

import process from 'node:process'

import { EventEmitter } from 'node:events'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { validateLauncherEvidence, WindowsLauncherPlatform } from './wow-launcher-windows'

const os = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal<typeof import('node:child_process')>(), spawn: os.spawn }))

const retailPath = 'E:\\World of Warcraft\\_retail_\\Wow.exe'
const wowEvidence: ExecutableEvidence = {
  signature: 'Valid',
  signer: 'Blizzard Entertainment, Inc.',
  companyName: 'Blizzard Entertainment',
  originalFilename: 'WoW.exe',
  productName: 'World of Warcraft',
  fileVersion: '12.1.5.70448',
}

function installation(product: string, version = wowEvidence.fileVersion, active = '1') {
  return {
    flavor: `Product Flavor!STRING:0\r\n${product}\r\n`,
    buildInfo: `Branch!STRING:0|Active!DEC:1|Version!STRING:0|Product!STRING:0\r\ncn|${active}|${version}|${product}\r\n`,
  }
}

afterEach(() => vi.clearAllMocks())

describe('windows launcher identity', () => {
  it('accepts a verified Retail installation with a region in the Branch column', () => {
    expect(validateLauncherEvidence('retail', retailPath, wowEvidence, installation('WoW')).target).toBe('retail')
  })

  it.each([
    ['Battle.net.exe', 'Battle.net'],
    ['Battle.net Launcher.exe', 'Battle.net Launcher'],
    ['World of Warcraft Launcher.exe', 'World of Warcraft Launcher'],
  ])('accepts the signed %s as a Battle.net entry only', (filename, productName) => {
    const evidence = { ...wowEvidence, originalFilename: filename, productName }
    const path = `E:\\Games\\${filename}`
    expect(validateLauncherEvidence('battle-net', path, evidence).target).toBe('battle-net')
    expect(() => validateLauncherEvidence('forever', path, evidence)).toThrow('wrong-version')
  })

  it('rejects an unsigned or invalidly signed renamed program', () => {
    expect(() => validateLauncherEvidence('retail', retailPath, { ...wowEvidence, signature: 'NotSigned' }, installation('wow'))).toThrow('invalid-signature')
    expect(() => validateLauncherEvidence('retail', retailPath, { ...wowEvidence, signature: 'HashMismatch' }, installation('wow'))).toThrow('invalid-signature')
  })

  it('requires the exact publisher identity, original filename, and product', () => {
    expect(() => validateLauncherEvidence('retail', retailPath, { ...wowEvidence, signer: 'Not Blizzard Entertainment, Inc.' }, installation('wow'))).toThrow('invalid-signature')
    expect(() => validateLauncherEvidence('retail', retailPath, { ...wowEvidence, originalFilename: 'Agent.exe' }, installation('wow'))).toThrow('wrong-product')
    expect(() => validateLauncherEvidence('retail', retailPath, { ...wowEvidence, productName: 'Diablo IV' }, installation('wow'))).toThrow('wrong-product')
  })

  it('distinguishes Forever from Retail even though both use Wow.exe', () => {
    const foreverPath = 'E:\\World of Warcraft\\_forever_\\Wow.exe'
    const evidence = { ...wowEvidence, fileVersion: '1.60.0.70000' }
    expect(validateLauncherEvidence('forever', foreverPath, evidence, installation('wowf', evidence.fileVersion)).target).toBe('forever')
    expect(() => validateLauncherEvidence('retail', foreverPath, evidence, installation('wowf', evidence.fileVersion))).toThrow('wrong-version')
    expect(() => validateLauncherEvidence('forever', foreverPath, wowEvidence, installation('wowf'))).toThrow('wrong-version')
    expect(() => validateLauncherEvidence('forever', retailPath, wowEvidence, installation('wow'))).toThrow('wrong-version')
    const future = { ...evidence, fileVersion: '1.61.0.71000' }
    expect(() => validateLauncherEvidence('forever', foreverPath, future, installation('wowf', future.fileVersion))).toThrow('unrecognized-version')
  })

  it.each([
    ['wow_classic', '_classic_', '5.5.0.60000'],
    ['wow_classic_era', '_classic_era_', '1.15.7.60000'],
    ['wow_classic_titan', '_classic_titan_', '3.80.0.60000'],
    ['wow_anniversary', '_anniversary_', '2.5.6.70577'],
  ])('recognizes the Classic product %s without borrowing Forever identity', (product, directory, version) => {
    const evidence = { ...wowEvidence, originalFilename: 'WoWClassic.exe', fileVersion: version }
    const path = `E:\\World of Warcraft\\${directory}\\WoWClassic.exe`
    expect(validateLauncherEvidence('classic', path, evidence, installation(product, version)).target).toBe('classic')
    expect(() => validateLauncherEvidence('forever', path, evidence, installation(product, version))).toThrow('wrong-version')
  })

  it('recognizes the documented ARM64 executable variant', () => {
    const evidence = { ...wowEvidence, originalFilename: 'Wow-ARM64.exe' }
    expect(validateLauncherEvidence('retail', 'E:\\WoW\\_retail_\\Wow-ARM64.exe', evidence, installation('wow')).target).toBe('retail')
  })

  it('rejects missing, stale, inactive, or unknown product metadata', () => {
    expect(() => validateLauncherEvidence('retail', retailPath, wowEvidence)).toThrow('unrecognized-version')
    expect(() => validateLauncherEvidence('retail', retailPath, wowEvidence, installation('wow', '12.1.0.60000'))).toThrow('unrecognized-version')
    expect(() => validateLauncherEvidence('retail', retailPath, wowEvidence, installation('wow', wowEvidence.fileVersion, '0'))).toThrow('unrecognized-version')
    expect(() => validateLauncherEvidence('retail', retailPath, wowEvidence, installation('wow_cn_beta'))).toThrow('unrecognized-version')
  })

  it('rejects inconsistent installation directories and a game exe selected for Battle.net', () => {
    expect(() => validateLauncherEvidence('retail', 'E:\\Games\\Wow.exe', wowEvidence, installation('wow'))).toThrow('wrong-version')
    expect(() => validateLauncherEvidence('battle-net', retailPath, wowEvidence)).toThrow('wrong-version')
  })
})

describe('windows process launch', () => {
  it('passes a spaced executable path as one executable and never constructs a shell command', async () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
    os.spawn.mockReturnValue(child)
    const platform = new WindowsLauncherPlatform()
    const promise = platform.launch({ target: 'retail', path: retailPath, productName: 'World of Warcraft', fileVersion: wowEvidence.fileVersion })
    child.emit('spawn')
    await promise
    expect(os.spawn).toHaveBeenCalledWith(retailPath, [], expect.objectContaining({ shell: false, detached: true, cwd: 'E:\\World of Warcraft\\_retail_' }))
    expect(child.unref).toHaveBeenCalledOnce()
  })

  it.each([
    ['_classic_titan_', '-initialgamemode=standard'],
    ['_anniversary_', '-initialgamemode=bccfresh'],
  ])('uses only the documented constant argument for %s', async (directory, argument) => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
    os.spawn.mockReturnValue(child)
    const platform = new WindowsLauncherPlatform()
    const path = `E:\\WoW\\${directory}\\WowClassic.exe`
    const promise = platform.launch({ target: 'classic', path, productName: 'World of Warcraft', fileVersion: '3.80.0.60000' })
    child.emit('spawn')
    await promise
    expect(os.spawn).toHaveBeenCalledWith(path, [argument], expect.objectContaining({ shell: false }))
  })

  it('does not apply game arguments to a Battle.net program inside a game directory', async () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
    os.spawn.mockReturnValue(child)
    const path = 'E:\\WoW\\_anniversary_\\Battle.net.exe'
    const promise = new WindowsLauncherPlatform().launch({ target: 'battle-net', path, productName: 'Battle.net', fileVersion: '2.53.5.17932' })
    child.emit('spawn')
    await promise
    expect(os.spawn).toHaveBeenCalledWith(path, [], expect.objectContaining({ shell: false }))
  })

  it('reports a process creation failure', async () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
    os.spawn.mockReturnValue(child)
    const promise = new WindowsLauncherPlatform().launch({ target: 'retail', path: retailPath, productName: 'World of Warcraft', fileVersion: wowEvidence.fileVersion })
    const assertion = expect(promise).rejects.toThrow('Access denied')
    child.emit('error', new Error('Access denied'))
    await assertion
    expect(child.unref).not.toHaveBeenCalled()
  })
})

describe.runIf(process.platform === 'win32')('windows path inspection', () => {
  it.each([
    ['Wow.exe', 'invalid-path'],
    ['https://example.com/Wow.exe', 'invalid-path'],
    ['\\\\server\\Games\\Wow.exe', 'invalid-path'],
    ['C:\\Games\\Wow.exe:other', 'invalid-path'],
    ['C:\\Games\\wow.cmd', 'not-executable'],
    ['C:\\Games\\wow.lnk', 'not-executable'],
    ['C:\\Games\\Wow.exe --some-option', 'not-executable'],
  ])('rejects %s before inspection or execution', async (path, code) => {
    await expect(new WindowsLauncherPlatform().inspect('retail', path)).rejects.toThrow(code)
    expect(os.spawn).not.toHaveBeenCalled()
  })
})
