import type { WowScreenGame } from '../../../shared/wow-screen-assist'
import type { GameCapturePlatform, GameCaptureWindow } from './wow-screen-assist-runtime'

import process from 'node:process'

import { execFile } from 'node:child_process'
import { win32 } from 'node:path'
import { promisify } from 'node:util'

import { desktopCapturer } from 'electron'
import { array, boolean, integer, minValue, number, object, parse, pipe, string } from 'valibot'

import { WindowsLauncherPlatform } from './wow-launcher-windows'
import { ScreenCaptureFailure } from './wow-screen-assist-runtime'

const execute = promisify(execFile)
const windowsSchema = array(object({
  handle: string(),
  processId: pipe(number(), integer(), minValue(1)),
  processStartedAt: string(),
  path: string(),
  title: string(),
  minimized: boolean(),
  visible: boolean(),
}))

// The process list supplies executable paths. No renderer string enters this fixed native query.
const discoveryScript = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class WarcraftWindowState {
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out int value, int size);
  public static bool Visible(IntPtr handle) {
    int cloaked;
    return IsWindowVisible(handle) && (DwmGetWindowAttribute(handle, 14, out cloaked, 4) != 0 || cloaked == 0);
  }
  public static uint Owner(IntPtr handle) { uint processId; GetWindowThreadProcessId(handle, out processId); return processId; }
}
'@
$entries = @()
foreach ($gameProcess in @(Get-Process -Name 'Wow','WowClassic','Wow-arm64','WowClassic-arm64' -ErrorAction SilentlyContinue)) {
  try {
    $handle = $gameProcess.MainWindowHandle
    if ($handle -eq [IntPtr]::Zero -or [WarcraftWindowState]::Owner($handle) -ne $gameProcess.Id) { continue }
    $program = $gameProcess.Path
    if ([string]::IsNullOrEmpty($program)) { continue }
    $entries += @{
      handle = $handle.ToInt64().ToString()
      processId = [int]$gameProcess.Id
      processStartedAt = $gameProcess.StartTime.ToUniversalTime().Ticks.ToString()
      path = $program
      title = $gameProcess.MainWindowTitle
      minimized = [WarcraftWindowState]::IsIconic($handle)
      visible = [WarcraftWindowState]::Visible($handle)
    }
  } catch { }
}
ConvertTo-Json -InputObject @($entries) -Compress
`

function gameForPath(path: string): WowScreenGame | undefined {
  switch (win32.basename(win32.dirname(path)).toLowerCase()) {
    case '_retail_': return 'retail'
    case '_forever_': return 'forever'
    case '_classic_':
    case '_classic_era_':
    case '_classic_titan_':
    case '_anniversary_': return 'classic'
  }
}

/** Native discovery and Electron window capture share the Windows HWND, never a title substring or desktop coordinates. */
export class WindowsGameCapture implements GameCapturePlatform {
  readonly supported = process.platform === 'win32'
  private readonly inspector = new WindowsLauncherPlatform()

  async discover(): Promise<GameCaptureWindow[]> {
    if (!this.supported)
      throw new ScreenCaptureFailure('unsupported-platform')
    const systemRoot = Object.entries(process.env).find(([name]) => name.toLowerCase() === 'systemroot')?.[1]
    if (!systemRoot)
      throw new ScreenCaptureFailure('capture-failed')
    const powershell = win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toLowerCase() !== 'psmodulepath'))
    const result = await execute(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', discoveryScript], {
      env: { ...environment, PSMODULEPATH: win32.join(win32.dirname(powershell), 'Modules') },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 8000,
      maxBuffer: 128 * 1024,
    })
    return parse(windowsSchema, JSON.parse(result.stdout.trim())).map(window => ({ ...window, game: gameForPath(window.path) }))
  }

  async verify(window: GameCaptureWindow, game: WowScreenGame) {
    try {
      await this.inspector.inspect(game, window.path)
    }
    catch {
      throw new ScreenCaptureFailure('unverified-game')
    }
  }

  async capture(window: GameCaptureWindow) {
    // Electron identifies a Windows source as window:HWND:0. Only the matching source crosses the IPC boundary.
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1920, height: 1080 }, fetchWindowIcons: false })
    const source = sources.find(entry => entry.id === `window:${window.handle}:0`)
    if (!source)
      throw new ScreenCaptureFailure('window-changed')
    let frame = source.thumbnail
    if (frame.isEmpty())
      throw new ScreenCaptureFailure('empty-frame')
    const size = frame.getSize()
    if (size.width < 160 || size.height < 90)
      throw new ScreenCaptureFailure('empty-frame')
    if (size.width > 8192 || size.height > 8192 || size.width * size.height > 33554432)
      throw new ScreenCaptureFailure('capture-failed')
    const scale = Math.min(1, 1920 / size.width, 1080 / size.height)
    if (scale < 1)
      frame = frame.resize({ width: Math.floor(size.width * scale), height: Math.floor(size.height * scale), quality: 'best' })
    const pixels = frame.resize({ width: 80, height: 45 }).toBitmap()
    let minimum = 255
    let maximum = 0
    // Empty GPU captures can contain opaque black pixels. Reject uniform frames instead of interpreting them as terrain.
    for (let index = 0; index + 3 < pixels.length; index += 4) {
      const brightness = (pixels[index]! + pixels[index + 1]! + pixels[index + 2]!) / 3
      minimum = Math.min(minimum, brightness)
      maximum = Math.max(maximum, brightness)
    }
    if (maximum - minimum < 8)
      throw new ScreenCaptureFailure('empty-frame')
    const bytes = frame.toJPEG(85)
    if (bytes.length === 0 || bytes.length > 6 * 1024 * 1024)
      throw new ScreenCaptureFailure('capture-failed')
    const { width, height } = frame.getSize()
    return { dataUrl: `data:image/jpeg;base64,${bytes.toString('base64')}`, width, height, capturedAt: Date.now() }
  }
}
