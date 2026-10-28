import type { ChatRequestContextInput } from '@proj-airi/stage-ui/stores/chat/request-context'

import type { WowScreenCaptureResult } from '../../shared/wow-screen-assist'
import type { ScreenAssistSettings } from './wow-screen-assist-controller'

import { describe, expect, it, vi } from 'vitest'

import { WowScreenAssistController } from './wow-screen-assist-controller'

function request(text = '你帮我看看我面前这个地形我走的过去吗'): ChatRequestContextInput {
  return { sessionId: 'owner', turnId: 'new-turn', text, signal: new AbortController().signal }
}

function image(): WowScreenCaptureResult {
  return { ok: true, image: { dataUrl: 'data:image/png;base64,cGl4ZWxz', width: 1280, height: 720, capturedAt: Date.now(), game: 'retail', windowTitle: 'World of Warcraft' } }
}

const settings: ScreenAssistSettings = { enabled: true, game: 'auto', selection: { provider: 'configured-vision', model: 'selected-model' } }

function setup() {
  const capture = vi.fn(async (): Promise<WowScreenCaptureResult> => image())
  const read = vi.fn(async () => 'A path turns left around a cliff. The lower area is hidden.')
  const report = vi.fn()
  const controller = new WowScreenAssistController({ capture, read, report })
  return { controller, capture, read, report }
}

describe('on-demand Warcraft screen assistance', () => {
  it('captures only after a visual request and passes a fresh frame to the selected vision model', async () => {
    const { controller, capture, read, report } = setup()
    const result = await controller.assist(request(), settings)
    expect(capture).toHaveBeenCalledOnce()
    expect(capture).toHaveBeenCalledWith({})
    expect(read).toHaveBeenCalledWith(expect.objectContaining({
      imageDataUrl: 'data:image/png;base64,cGl4ZWxz',
      selection: settings.selection,
      workloadId: 'screen:understand',
    }))
    expect(result).toContain('A path turns left')
    expect(result).not.toContain('base64')
    expect(report.mock.calls.map(call => call[0])).toEqual(['capturing', 'analyzing', 'ready'])
  })

  it('does not capture ordinary chat, a negative request, or a disabled feature', async () => {
    const { controller, capture, read } = setup()
    expect(await controller.assist(request('DZ是什么职业？'), settings)).toBeUndefined()
    expect(await controller.assist(request('不要截图，我只是聊聊任务'), settings)).toBeUndefined()
    expect(await controller.assist(request(), { ...settings, enabled: false })).toBeUndefined()
    expect(capture).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
  })

  it('checks vision configuration before it captures', async () => {
    const { controller, capture, report } = setup()
    const result = await controller.assist(request(), { ...settings, selection: { provider: '', model: '' } })
    expect(result).toContain('vision-not-configured')
    expect(result).toContain('No screenshot observations')
    expect(capture).not.toHaveBeenCalled()
    expect(report).toHaveBeenCalledWith('error', 'vision-not-configured')
  })

  it('uses the configured game and does not analyze a failed capture', async () => {
    const { controller, capture, read } = setup()
    capture.mockResolvedValue({ ok: false, code: 'ambiguous-window' })
    const result = await controller.assist(request(), { ...settings, game: 'classic' })
    expect(capture).toHaveBeenCalledWith({ game: 'classic' })
    expect(result).toContain('ambiguous-window')
    expect(result).toContain('No screenshot observations')
    expect(read).not.toHaveBeenCalled()
  })

  it('rejects old frames instead of pretending that they describe the current game', async () => {
    const { controller, capture, read } = setup()
    const frame = image()
    if (!frame.ok)
      throw new Error('Invalid test image')
    frame.image.capturedAt -= 30_000
    capture.mockResolvedValue(frame)
    expect(await controller.assist(request(), settings)).toContain('capture-timeout')
    expect(read).not.toHaveBeenCalled()
  })

  it('reports a failed or empty visual read without leaking provider error details', async () => {
    const { controller, read } = setup()
    read.mockRejectedValueOnce(new Error('Request failed: private provider detail'))
    const result = await controller.assist(request(), settings)
    expect(result).toContain('vision-failed')
    expect(result).not.toContain('private provider detail')
    read.mockResolvedValueOnce(' ')
    expect(await controller.assist(request(), settings)).toContain('no-description')
  })

  it('releases a cancelled turn and ignores its late capture', async () => {
    const { controller, capture, read } = setup()
    const pending = Promise.withResolvers<WowScreenCaptureResult>()
    capture.mockReturnValueOnce(pending.promise)
    const abort = new AbortController()
    const result = controller.assist({ ...request(), signal: abort.signal }, settings)
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    abort.abort()
    await assertion
    pending.resolve(image())
    await Promise.resolve()
    expect(read).not.toHaveBeenCalled()
    expect(await controller.assist(request(), settings)).toContain('A path turns left')
  })

  it('discards inference after the user disables the feature and starts no second concurrent capture', async () => {
    const { controller, capture, read } = setup()
    const pending = Promise.withResolvers<string>()
    read.mockReturnValueOnce(pending.promise)
    const first = controller.assist(request(), settings)
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce())
    expect(await controller.assist({ ...request(), sessionId: 'other' }, settings)).toContain('busy')
    expect(capture).toHaveBeenCalledOnce()
    controller.stop()
    expect(await first).toBeUndefined()
    pending.resolve('Obsolete game screen')
  })
})
