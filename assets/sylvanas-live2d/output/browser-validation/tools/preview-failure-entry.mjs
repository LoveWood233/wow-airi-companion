import { Ticker } from '@pixi/ticker'
import 'airi-live2d-zip-loader'
import { loadLive2DModelPreview } from 'airi-live2d-preview'

window.live2dValidation = {
  ready: true,
  probe() {
    return { coreVersion: Live2DCubismCore.Version.csmGetVersion() }
  },
  async run() {
    const resources = () => ({ canvasCount: document.querySelectorAll('canvas').length, tickerListeners: Ticker.shared.count, textures: Object.keys(window.PIXI.utils.TextureCache).length, baseTextures: Object.keys(window.PIXI.utils.BaseTextureCache).length })
    const before = resources()
    const result = await loadLive2DModelPreview(new File(['This is intentionally not a ZIP archive.'], 'invalid-archive.zip', { type: 'application/zip' }))
    await new Promise(resolve => setTimeout(resolve, 100))
    const after = resources()
    return { ok: result === undefined && Object.keys(before).every(key => before[key] === after[key]), purpose: 'Negative malformed-input cleanup inspection. The production function emits an expected console error retained by this harness.', returnedUndefined: result === undefined, resourcesRestored: Object.keys(before).every(key => before[key] === after[key]), before, after }
  },
}
