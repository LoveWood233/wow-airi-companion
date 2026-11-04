import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** Builds a browser view of actual saved runtime frames and the canvas recording. */
async function main() {
  const [output, toolchain, executable] = process.argv.slice(2)
  if (!output || !toolchain) throw new Error('Usage: node render-v2-evidence.mjs OUTPUT_DIRECTORY TOOLCHAIN_NODE_MODULES [CHROMIUM_EXECUTABLE]')
  const directory = path.resolve(output)
  const report = JSON.parse(await fs.readFile(path.join(directory, 'report.json'), 'utf8'))
  const states = report.result.runtime.sampledStates
  const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
  const stateCard = (name, title) => {
    const frame = states.find(state => state.name === name)
    if (!frame) throw new Error(`Missing actual state: ${name}`)
    const parameters = Object.fromEntries(Object.entries(frame.parameters).map(([id, value]) => [id, Number(value.toFixed(3))]))
    return `<section class="card"><h3>${escape(title)}</h3><div class="crop"><img src="./${escape(frame.image.file)}" alt="${escape(title)}"></div><code>${escape(JSON.stringify(parameters))}</code></section>`
  }
  const directions = [
    [-1, 1, '左上'], [0, 1, '上'], [1, 1, '右上'],
    [-1, 0, '左'], [0, 0, '中心'], [1, 0, '右'],
    [-1, -1, '左下'], [0, -1, '下'], [1, -1, '右下'],
  ]
  const gazeCards = directions.map(([x, y, name]) => stateCard(`pointer-x${x}-y${y}`, name)).join('')
  const yawnCards = [0, 0.7, 1.3, 2.8, 4.1, 5.2, 6.2].map(time => stateCard(`yawn-${time.toFixed(2)}s`, `${time.toFixed(1)} 秒`)).join('')
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Live2D v2 实际动作检查</title><style>body{margin:24px;background:#303541;color:#f5f3ff;font:18px 'Microsoft YaHei',sans-serif}h1{font-size:28px}h2{font-size:24px;margin:28px 0 12px}.scope{max-width:1200px;line-height:1.6;color:#d1d7e8}.grid{display:grid;grid-template-columns:repeat(3,420px);gap:14px}.card{padding:10px;background:#51596b;border:1px solid #8892a8}.card h3{font-size:20px;margin:0 0 8px}.crop{width:400px;height:250px;position:relative;overflow:hidden;background:#737e93}.crop img{position:absolute;width:1400px;height:1680px;left:-500px;top:-430px;max-width:none}.card code{display:block;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;margin-top:8px}video{max-width:600px;background:#697589;border:1px solid #8892a8}a{color:#b6ccff}</style><h1>Live2D v2：实际动作检查</h1><p class="scope">报告状态：${report.ok ? '通过' : '未通过'}。以下素材来自真实浏览器渲染与画布录像，未修改原画。鼠标检查调用当前生产视线适配器；完整桌面应用、全局鼠标桥接和语音时序另行验收。</p><p><a href="./report.json">原始报告</a></p><video controls loop muted preload="auto" src="./gaze-and-yawn.webm"></video><h2>鼠标九方向</h2><main class="grid">${gazeCards}</main><h2>单次哈欠与闭嘴恢复</h2><main class="grid">${yawnCards}</main></html>`
  const filename = path.join(directory, 'motion-preview.html')
  await fs.writeFile(filename, html)
  const { chromium } = await import(pathToFileURL(path.join(path.resolve(toolchain), 'playwright/index.mjs')).href)
  const browser = await chromium.launch({ executablePath: executable ? path.resolve(executable) : undefined, headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1360, height: 1000 }, deviceScaleFactor: 1 })
    await page.goto(pathToFileURL(filename).href)
    await page.evaluate(() => Promise.all(Array.from(document.images, image => image.decode())))
    await page.screenshot({ path: path.join(directory, 'motion-overview.png'), fullPage: true })
    await page.locator('.grid').first().screenshot({ path: path.join(directory, 'gaze-comparison.png') })
    const video = await page.locator('video').evaluate(async element => {
      if (element.readyState < 1) await new Promise(resolve => element.addEventListener('loadedmetadata', resolve, { once: true }))
      return { width: element.videoWidth, height: element.videoHeight, readyState: element.readyState }
    })
    if (video.width === 0 || video.height === 0) throw new Error('Recorded WebM has no decodable video dimensions')
    await fs.writeFile(path.join(directory, 'video-metadata.json'), `${JSON.stringify(video, null, 2)}\n`)
  }
  finally { await browser.close() }
  console.log(JSON.stringify({ evidence: filename, sourceReportPassed: report.ok }))
}

await main()
