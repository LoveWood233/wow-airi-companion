import process from 'node:process'

import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const execute = promisify(execFile)
const helper = resolve(import.meta.dirname, '../resources/wow-local-update.ps1')
const fixtureSource = `using System;
using System.Diagnostics;
using System.IO;
using System.Threading;

class Fixture {
  static void Main(string[] args) {
    if (args.Length > 0) return;
    var user = Environment.GetEnvironmentVariable("APP_USER_DATA_PATH");
    var id = Environment.GetEnvironmentVariable("APP_COMPANION_UPDATE_ID");
    var rollback = Environment.GetEnvironmentVariable("APP_COMPANION_ROLLBACK_ID");
    var root = AppDomain.CurrentDomain.BaseDirectory;
    var name = new DirectoryInfo(root).Name;
    File.WriteAllText(Path.Combine(user, "started-" + name + ".txt"), Process.GetCurrentProcess().Id + "," + (id ?? "none"));
    var mode = File.ReadAllText(Path.Combine(root, "mode.txt"));
    if (name == "old") {
      if (mode == "exit") return;
      var journal = Path.Combine(user, "companion-backups", "restore-journal.json");
      if (mode != "ack-with-journal") {
        File.WriteAllText(Path.Combine(user, "recovered-journal.json"), File.ReadAllText(journal));
        File.Delete(journal);
      }
      var ack = Path.Combine(user, "companion-updates", "rollback-ack-" + rollback + ".json");
      File.WriteAllText(ack, "{\\\"id\\\":\\\"" + rollback + "\\\"}");
      Thread.Sleep(500);
      return;
    }
    if (mode == "exit") return;
    if (mode == "ack") {
      var ack = Path.Combine(user, "companion-updates", "ack-" + id + ".json");
      File.WriteAllText(ack, "{\\\"id\\\":\\\"" + id + "\\\"}");
      Thread.Sleep(500);
      return;
    }
    if (mode == "wrong-ack") {
      var ack = Path.Combine(user, "companion-updates", "ack-" + id + ".json");
      File.WriteAllText(ack, "{\\\"id\\\":\\\"different-job\\\"}");
    }
    Thread.Sleep(30000);
  }
}`

interface HelperJob {
  id: string
  parentPid: number
  oldExecutable: string
  newExecutable: string
  userData: string
  checkpoint: string
  rollbackJournal: string
}

describe.skipIf(process.platform !== 'win32')('windows local update helper with isolated executables', () => {
  let root: string
  let fixture: string
  let directory: string
  let job: HelperJob
  let jobPath: string
  let journalText: string

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'wow-update-helper-tests-'))
    fixture = join(root, 'fixture.exe')
    const source = join(root, 'fixture.cs')
    await writeFile(source, fixtureSource)
    const windows = process.env.WINDIR
    if (!windows)
      throw new Error('Windows directory is missing')
    await execute(join(windows, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'), ['/nologo', '/target:exe', `/out:${fixture}`, source], { windowsHide: true })
  })

  beforeEach(async () => {
    directory = await mkdtemp(join(root, 'case-'))
    const userData = join(directory, '用户资料')
    const backups = join(userData, 'companion-backups')
    const updates = join(userData, 'companion-updates')
    await Promise.all([mkdir(backups, { recursive: true }), mkdir(updates, { recursive: true }), mkdir(join(directory, 'old')), mkdir(join(directory, 'new'))])
    const id = randomUUID()
    job = { id, userData, parentPid: 0, oldExecutable: join(directory, 'old', 'wow-companion.exe'), newExecutable: join(directory, 'new', 'wow-companion.exe'), checkpoint: join(backups, `before-restore-1700000000000-${id}.wowbackup.json`), rollbackJournal: join(backups, `update-rollback-${id}.json`) }
    await Promise.all([cp(fixture, job.oldExecutable), cp(fixture, job.newExecutable), writeFile(job.checkpoint, '{}'), writeFile(join(dirname(job.oldExecutable), 'mode.txt'), 'ack')])
    journalText = JSON.stringify({ phase: 'applying', selection: { settings: true, history: true, chats: true }, previous: { browser: { preferences: [], chats: [] }, files: [] }, checkpoint: basename(job.checkpoint) })
    await writeFile(job.rollbackJournal, journalText)
    const parent = spawn(fixture, ['exit'], { windowsHide: true })
    await once(parent, 'exit')
    job.parentPid = parent.pid!
    jobPath = join(updates, `job-${id}.json`)
    await writeFile(jobPath, JSON.stringify(job))
  })

  afterEach(async () => {
    // Each executable can only live inside this test case. Close a leftover fixture before deleting its verified temp tree.
    const marker = await readFile(join(job.userData, 'started-new.txt'), 'utf8').catch(() => '')
    if (marker) {
      const pid = Number(marker.split(',')[0])
      await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$p=Get-Process -Id $args[0] -ErrorAction SilentlyContinue; if ($p -and $p.Path -eq $args[1]) { Stop-Process -InputObject $p -Force }', String(pid), job.newExecutable], { windowsHide: true }).catch(() => {})
    }
    const target = resolve(directory)
    expect(target.startsWith(`${resolve(root)}\\case-`)).toBe(true)
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  })

  afterAll(async () => {
    const target = resolve(root)
    expect(target.startsWith(`${resolve(tmpdir())}\\wow-update-helper-tests-`)).toBe(true)
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  })

  async function run(mode: string, parentWait = '2', validateOnly = false) {
    await writeFile(join(dirname(job.newExecutable), 'mode.txt'), mode)
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-JobPath', jobPath, '-ParentWaitSeconds', parentWait, '-ReadyWaitSeconds', '2']
    if (validateOnly)
      args.push('-ValidateOnly')
    return execute('powershell.exe', args, { windowsHide: true, timeout: 20_000 }).then(result => ({ ...result, code: 0 }), (error: unknown) => {
      if (!(error instanceof Error) || !('code' in error))
        throw error
      return { code: error.code, stdout: '', stderr: error.message }
    })
  }

  async function result() {
    return JSON.parse(await readFile(join(job.userData, 'companion-updates', 'result.json'), 'utf8')) as { id: string, outcome: string, checkpoint: string, at: number }
  }

  it('accepts a matching readiness acknowledgment and preserves both app folders', async () => {
    const status = await run('ack')
    expect(status.code).toBe(0)
    expect(await result()).toMatchObject({ id: job.id, outcome: 'updated', checkpoint: job.checkpoint })
    expect((await readFile(join(job.userData, 'started-new.txt'), 'utf8')).split(',')[1]).toBe(job.id)
    await expect(readFile(join(job.userData, 'started-old.txt'))).rejects.toThrow()
    await expect(readFile(join(dirname(job.rollbackJournal), 'restore-journal.json'))).rejects.toThrow()
    expect(await readFile(job.oldExecutable)).toEqual(await readFile(fixture))
    expect(await readFile(job.newExecutable)).toEqual(await readFile(fixture))
  }, 30_000)

  it.each(['exit', 'hang', 'wrong-ack'])('schedules exact cold rollback and starts the old app when the new app uses %s', async (mode) => {
    const status = await run(mode)
    expect(status.code).toBe(0)
    expect((await result()).outcome).toBe('rolled-back')
    expect(await readFile(join(job.userData, 'recovered-journal.json'), 'utf8')).toBe(journalText)
    await expect(readFile(join(dirname(job.rollbackJournal), 'restore-journal.json'))).rejects.toThrow()
    if (mode !== 'exit') {
      const marker = await readFile(join(job.userData, 'started-new.txt'), 'utf8')
      const pid = Number(marker.split(',')[0])
      expect(() => process.kill(pid, 0)).toThrow()
    }
    const oldMarker = join(job.userData, 'started-old.txt')
    await expect.poll(() => readFile(oldMarker, 'utf8')).toMatch(/,none$/)
  }, 30_000)

  it('preserves an existing restore request and does not start the old app over it', async () => {
    const restore = join(dirname(job.rollbackJournal), 'restore-journal.json')
    await writeFile(restore, 'existing recovery')
    const status = await run('exit')
    expect(status.code).toBe(3)
    expect((await result()).outcome).toBe('recovery-required')
    expect(await readFile(restore, 'utf8')).toBe('existing recovery')
    await expect(readFile(join(job.userData, 'started-old.txt'))).rejects.toThrow()
  }, 30_000)

  it('does not terminate a parent that has not completed its shutdown', async () => {
    job.parentPid = process.pid
    await writeFile(jobPath, JSON.stringify(job))
    const status = await run('ack', '1')
    expect(status.code).toBe(3)
    expect((await result()).outcome).toBe('recovery-required')
    await expect(readFile(join(job.userData, 'started-new.txt'))).rejects.toThrow()
    await expect(readFile(join(dirname(job.rollbackJournal), 'restore-journal.json'))).rejects.toThrow()
  }, 30_000)

  it('refuses a forged job location before launching an executable', async () => {
    jobPath = join(directory, 'outside-job.json')
    await writeFile(jobPath, JSON.stringify(job))
    const status = await run('ack')
    expect(status.code).toBe(2)
    await expect(readFile(join(job.userData, 'started-new.txt'))).rejects.toThrow()
    await expect(result()).rejects.toThrow()
  }, 30_000)

  it('does not accept a stale acknowledgment left before the new process starts', async () => {
    await writeFile(join(dirname(jobPath), `ack-${job.id}.json`), JSON.stringify({ id: job.id }))
    expect((await run('ack')).code).toBe(2)
    await expect(readFile(join(job.userData, 'started-new.txt'))).rejects.toThrow()
  }, 30_000)

  it('refuses an executable directory redirected through a junction', async () => {
    const redirected = join(directory, 'redirected')
    await symlink(dirname(job.newExecutable), redirected, 'junction')
    job.newExecutable = join(redirected, 'wow-companion.exe')
    await writeFile(jobPath, JSON.stringify(job))
    expect((await run('ack', '2', true)).code).toBe(2)
    await expect(readFile(join(job.userData, 'started-new.txt'))).rejects.toThrow()
  }, 30_000)

  it('validates a prepared job without waiting for its live parent or starting either app', async () => {
    job.parentPid = process.pid
    await writeFile(jobPath, JSON.stringify(job))
    expect((await run('ack', '2', true)).code).toBe(0)
    await expect(readFile(join(job.userData, 'started-new.txt'))).rejects.toThrow()
    await expect(readFile(join(job.userData, 'started-old.txt'))).rejects.toThrow()
    await expect(result()).rejects.toThrow()
  }, 30_000)

  it.each(['exit', 'ack-with-journal'])('requires completed recovery acknowledgment when the previous app uses %s', async (mode) => {
    await writeFile(join(dirname(job.oldExecutable), 'mode.txt'), mode)
    expect((await run('exit')).code).toBe(3)
    expect((await result()).outcome).toBe('recovery-required')
    expect(await readFile(join(dirname(job.rollbackJournal), 'restore-journal.json'), 'utf8')).toBe(journalText)
    await expect.poll(() => readFile(join(job.userData, 'started-old.txt'), 'utf8')).toMatch(/,none$/)
  }, 30_000)

  it('rejects a stale rollback acknowledgment during preflight', async () => {
    await writeFile(join(dirname(jobPath), `rollback-ack-${job.id}.json`), JSON.stringify({ id: job.id }))
    expect((await run('ack', '2', true)).code).toBe(2)
    await expect(readFile(join(job.userData, 'started-new.txt'))).rejects.toThrow()
    await expect(result()).rejects.toThrow()
  }, 30_000)
})
