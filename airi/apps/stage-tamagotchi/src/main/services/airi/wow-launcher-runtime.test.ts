import type { LauncherExecutable } from '../../../shared/wow-launcher'
import type { LauncherPlatform } from './wow-launcher-runtime'

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { LauncherFailure, WowLauncher } from './wow-launcher-runtime'

const directories: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'airi-launcher-test-'))
  directories.push(directory)
  const file = join(directory, 'launcher.json')
  const inspect = vi.fn<LauncherPlatform['inspect']>(async (target, path) => ({ target, path, productName: 'World of Warcraft', fileVersion: '12.0.0' }))
  const launch = vi.fn<LauncherPlatform['launch']>(async () => {})
  const platform = { supported: true, inspect, launch }
  return { directory, file, platform, inspect, launch, runtime: new WowLauncher(file, platform) }
}

describe('persisted Warcraft launch configuration', () => {
  it('starts unconfigured and refuses to launch before a path is saved', async () => {
    const { runtime, inspect, launch } = await fixture()
    expect(await runtime.read()).toMatchObject({ defaultTarget: 'battle-net', supported: true, paths: { retail: '' } })
    expect(await runtime.launch({})).toEqual({ ok: false, code: 'not-configured' })
    expect(inspect).not.toHaveBeenCalled()
    expect(launch).not.toHaveBeenCalled()
  })

  it('saves only the inspected canonical path and restores the default after restart', async () => {
    const { runtime, file, platform, inspect, launch } = await fixture()
    inspect.mockResolvedValueOnce({ target: 'retail', path: 'E:\\Games\\_retail_\\Wow.exe', productName: 'World of Warcraft', fileVersion: '12.0' })
    const result = await runtime.save({ target: 'retail', path: '  E:\\Games\\_retail_\\WOW.EXE  ', makeDefault: true })
    expect(result.ok).toBe(true)
    expect(inspect).toHaveBeenCalledWith('retail', 'E:\\Games\\_retail_\\WOW.EXE')
    expect(launch).not.toHaveBeenCalled()
    const reopened = new WowLauncher(file, platform)
    expect(await reopened.read()).toMatchObject({ defaultTarget: 'retail', paths: { retail: 'E:\\Games\\_retail_\\Wow.exe' } })
  })

  it('keeps the previous configuration when replacement validation fails', async () => {
    const { runtime, file, inspect } = await fixture()
    await runtime.save({ target: 'retail', path: 'E:\\Game\\Wow.exe', makeDefault: true })
    const saved = await readFile(file, 'utf8')
    inspect.mockRejectedValueOnce(new LauncherFailure('wrong-version'))
    expect(await runtime.save({ target: 'retail', path: 'E:\\Game\\WowClassic.exe', makeDefault: false })).toEqual({ ok: false, code: 'wrong-version' })
    expect(await readFile(file, 'utf8')).toBe(saved)
    expect(await runtime.read()).toMatchObject({ defaultTarget: 'retail', paths: { retail: 'E:\\Game\\Wow.exe' } })
  })

  it('clears one target without changing other paths', async () => {
    const { runtime, inspect } = await fixture()
    await runtime.save({ target: 'retail', path: 'E:\\Game\\Wow.exe', makeDefault: true })
    await runtime.save({ target: 'battle-net', path: 'E:\\Game\\Battle.net.exe', makeDefault: false })
    inspect.mockClear()
    expect((await runtime.save({ target: 'retail', path: ' ', makeDefault: false })).ok).toBe(true)
    expect(await runtime.read()).toMatchObject({ paths: { retail: '', 'battle-net': 'E:\\Game\\Battle.net.exe' } })
    expect(inspect).not.toHaveBeenCalled()
    expect(await runtime.launch({})).toEqual({ ok: false, code: 'not-configured' })
  })

  it('rejects malformed IPC requests and extra command arguments', async () => {
    const { runtime, inspect, launch } = await fixture()
    expect(await runtime.save({ target: 'retail', path: 'E:\\Game\\Wow.exe', makeDefault: true, args: ['--anything'] })).toEqual({ ok: false, code: 'invalid-request' })
    expect(await runtime.save({ target: 'other-game', path: 'E:\\Game\\Other.exe', makeDefault: false })).toEqual({ ok: false, code: 'invalid-request' })
    expect(await runtime.launch({ target: 'retail', path: 'E:\\unsaved.exe' })).toEqual({ ok: false, code: 'invalid-request' })
    expect(await runtime.launch({ target: 'retail', args: ['--exec=bad'] })).toEqual({ ok: false, code: 'invalid-request' })
    expect(inspect).not.toHaveBeenCalled()
    expect(launch).not.toHaveBeenCalled()
  })

  it('does not overwrite a corrupt configuration file', async () => {
    const { file, platform, inspect } = await fixture()
    await writeFile(file, '{broken', 'utf8')
    const runtime = new WowLauncher(file, platform)
    expect(await runtime.read()).toMatchObject({ error: 'storage-error' })
    expect(await runtime.save({ target: 'retail', path: 'E:\\Game\\Wow.exe', makeDefault: true })).toEqual({ ok: false, code: 'storage-error' })
    expect(await readFile(file, 'utf8')).toBe('{broken')
    expect(inspect).not.toHaveBeenCalled()
  })

  it('does not change memory when the atomic configuration write fails', async () => {
    const { directory, platform } = await fixture()
    const blocked = join(directory, 'not-a-directory')
    const runtime = new WowLauncher(join(blocked, 'launcher.json'), platform)
    await runtime.read()
    await writeFile(blocked, 'occupied', 'utf8')
    expect(await runtime.save({ target: 'retail', path: 'E:\\Game\\Wow.exe', makeDefault: true })).toEqual({ ok: false, code: 'storage-error' })
    expect(await runtime.read()).toMatchObject({ defaultTarget: 'battle-net', paths: { retail: '' } })
    expect(await readFile(blocked, 'utf8')).toBe('occupied')
  })

  it('reports unsupported operating systems without inspecting or launching paths', async () => {
    const { file, platform, inspect, launch } = await fixture()
    const runtime = new WowLauncher(file, { ...platform, supported: false })
    expect(await runtime.read()).toMatchObject({ supported: false })
    expect(await runtime.save({ target: 'retail', path: 'E:\\Game\\Wow.exe', makeDefault: true })).toEqual({ ok: false, code: 'unsupported-platform' })
    expect(await runtime.launch({})).toEqual({ ok: false, code: 'unsupported-platform' })
    expect(inspect).not.toHaveBeenCalled()
    expect(launch).not.toHaveBeenCalled()
  })
})

describe('validated game launch', () => {
  it('inspects a saved executable again before every launch', async () => {
    const { runtime, inspect, launch } = await fixture()
    await runtime.save({ target: 'retail', path: 'E:\\Game\\Wow.exe', makeDefault: true })
    inspect.mockRejectedValueOnce(new LauncherFailure('invalid-signature'))
    expect(await runtime.launch({})).toEqual({ ok: false, code: 'invalid-signature' })
    expect(inspect).toHaveBeenCalledTimes(2)
    expect(launch).not.toHaveBeenCalled()
  })

  it('launches the configured default without executing during save', async () => {
    const { runtime, launch } = await fixture()
    await runtime.save({ target: 'classic', path: 'E:\\Game\\_classic_\\WowClassic.exe', makeDefault: true })
    expect(launch).not.toHaveBeenCalled()
    expect((await runtime.launch({})).ok).toBe(true)
    expect(launch).toHaveBeenCalledWith({ target: 'classic', path: 'E:\\Game\\_classic_\\WowClassic.exe', productName: 'World of Warcraft', fileVersion: '12.0.0' })
  })

  it('supports an explicitly selected saved target without changing the default', async () => {
    const { runtime, launch } = await fixture()
    await runtime.save({ target: 'retail', path: 'E:\\Game\\Wow.exe', makeDefault: true })
    await runtime.save({ target: 'battle-net', path: 'E:\\Game\\Battle.net.exe', makeDefault: false })
    expect((await runtime.launch({ target: 'battle-net' })).ok).toBe(true)
    expect(launch.mock.calls[0]?.[0].target).toBe('battle-net')
    expect((await runtime.read()).defaultTarget).toBe('retail')
  })

  it('returns a translated error code when process creation fails', async () => {
    const { runtime, launch } = await fixture()
    await runtime.save({ target: 'retail', path: 'E:\\Game\\Wow.exe', makeDefault: true })
    launch.mockRejectedValueOnce(new Error('Private operating system failure detail'))
    expect(await runtime.launch({})).toEqual({ ok: false, code: 'launch-failed' })
  })

  it('blocks overlapping saves and launch clicks while inspection is pending', async () => {
    const { runtime, inspect, launch } = await fixture()
    const gate = Promise.withResolvers<LauncherExecutable>()
    inspect.mockReturnValueOnce(gate.promise)
    const saving = runtime.save({ target: 'retail', path: 'E:\\Game\\Wow.exe', makeDefault: true })
    await vi.waitFor(() => expect(inspect).toHaveBeenCalledTimes(1))
    expect(await runtime.save({ target: 'classic', path: 'E:\\Game\\WowClassic.exe', makeDefault: false })).toEqual({ ok: false, code: 'busy' })
    expect(await runtime.launch({})).toEqual({ ok: false, code: 'busy' })
    gate.resolve({ target: 'retail', path: 'E:\\Game\\Wow.exe', productName: 'World of Warcraft', fileVersion: '12.0' })
    await runtime.flush()
    expect((await saving).ok).toBe(true)
    expect(launch).not.toHaveBeenCalled()
  })

  it('suppresses repeated launch clicks during startup and allows a later launch', async () => {
    const { runtime, launch } = await fixture()
    await runtime.save({ target: 'retail', path: 'E:\\Game\\Wow.exe', makeDefault: true })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-28T10:00:00Z'))
    expect((await runtime.launch({})).ok).toBe(true)
    expect(await runtime.launch({})).toEqual({ ok: false, code: 'busy' })
    vi.setSystemTime(new Date('2026-10-28T10:00:04Z'))
    expect((await runtime.launch({})).ok).toBe(true)
    expect(launch).toHaveBeenCalledTimes(2)
  })
})
