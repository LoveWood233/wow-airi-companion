import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const directory = path.resolve(process.argv[2])
if (!process.argv[3]) throw new Error('Usage: node render-candidate-evidence.mjs OUTPUT_DIRECTORY TOOLCHAIN_NODE_MODULES [CHROMIUM_EXECUTABLE]')
const { chromium } = await import(pathToFileURL(path.join(path.resolve(process.argv[3]), 'playwright/index.mjs')).href)
const report = JSON.parse(await fs.readFile(path.join(directory, 'report.json'), 'utf8'))
const states = report.result.runtime.sampledStates
const labels = [
  ['default', '默认状态', '左右眼 1，口型 0。'],
  ['eyes-closed', '两眼闭合 0', '两条闭眼线已分离，鼻梁间隙清晰。仍为浅红直线。'],
  ['mouth-0', '口型 0', '闭嘴图层 1，开嘴图层 0。'],
  ['mouth-0_005', '口型 0.005', '两图层各 0.5。过渡区仍有很窄的双线。'],
  ['mouth-0_01', '口型 0.01', '仅开嘴图层，呈单条细线。'],
  ['mouth-0_25', '口型 0.25', '开口开始增高，没有分离的第二条嘴线。'],
  ['mouth-0_5', '口型 0.5', '口型正常，旧版明显双嘴重影已消除。'],
  ['mouth-1', '口型 1', '完整开口。'],
]
const cards = labels.map(([name, title, note]) => {
  const state = states.find(state => state.name === name)
  return `<section id="${name}" class="card"><h2>${title}</h2><div class="crop"><img src="./${state.image.file}" alt="${title}"></div><p>${note}</p></section>`
}).join('')
const html = `<!doctype html><meta charset="utf-8"><title>候选模型运行截图对照</title><style>body{margin:24px;background:#303541;color:#f6f3ff;font:20px 'Microsoft YaHei',sans-serif}h1{font-size:28px;margin:0 0 8px}.scope{margin:0 0 24px;color:#c8cdda}.grid{display:grid;grid-template-columns:704px 704px;gap:22px}.card{background:#51596b;border:1px solid #8892a8;padding:10px}.card h2{font-size:23px;margin:0 0 10px}.card p{font-size:17px;line-height:1.5;margin:8px 0 0;height:52px}.crop{width:704px;height:384px;position:relative;overflow:hidden;background:#737e93}.crop img{position:absolute;width:2240px;height:2688px;left:-768px;top:-720px;max-width:none}</style><h1>候选模型：真实浏览器运行截图对照</h1><p class="scope">原始 ZIP 未修改。下图仅通过 HTML 裁切、放大实际 1400 × 1680 渲染截图。详细运行与清理错误见 report.json。</p><main class="grid">${cards}</main>`
const filename = path.join(directory, 'visual-evidence.html')
await fs.writeFile(filename, html)
const animation = report.result.runtime.animation
const idleFrames = states.filter(state => state.name.startsWith('idle-'))
const motionHtml = `<!doctype html><meta charset="utf-8"><title>真实 Idle 采样</title><style>body{margin:24px;background:#303541;color:white;font:20px 'Microsoft YaHei',sans-serif}img{width:560px;background:#657087}section{display:inline-block;vertical-align:top;margin-right:28px}input{width:1000px}pre{white-space:pre-wrap;font:17px monospace}</style><h1>实际 Idle 4 秒采样</h1><p>已删除 SDK 默认 breath。此页面展示保存的真实运行帧，滑条不会重新驱动模型。</p><input type="range" min="0" max="${idleFrames.length - 1}" value="0" step="1"><pre id="value"></pre><section><h2>采样帧</h2><img id="sample"></section><section><h2>呼吸参数 0 → 1 对照</h2><img id="endpoint" src="./${states.find(state => state.name === 'breath-1').image.file}"></section><script>const frames=${JSON.stringify(idleFrames.map(state => ({ file: state.image.file, values: state.parameters, name: state.name })))};const slider=document.querySelector('input');function show(){const frame=frames[Number(slider.value)];document.querySelector('#sample').src='./'+frame.file;document.querySelector('#value').textContent=frame.name+'  '+JSON.stringify(frame.values)}slider.oninput=show;show()</script><pre>${JSON.stringify({ sdkBreathDisabled: animation.sdkBreathDisabledThroughout, idleBreathRange: animation.idle.breathRange, bodyVertexDelta: animation.idle.maximumBodyVertexDelta, nativeBlinkDuringIdle: animation.nativeBlinkDuringIdle, groupsBlinkWithoutIdle: animation.groupsBlinkControl.blinkObserved, controlBreathRange: animation.groupsBlinkControl.breathRange }, null, 2)}</pre>`
await fs.writeFile(path.join(directory, 'idle-sampling.html'), motionHtml)
const browser = await chromium.launch({ executablePath: process.argv[4] ? path.resolve(process.argv[4]) : undefined, headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1540, height: 1100 }, deviceScaleFactor: 1 })
  await page.goto(pathToFileURL(filename).href)
  await page.evaluate(() => Promise.all(Array.from(document.images, image => image.decode())))
  await page.screenshot({ path: path.join(directory, 'face-comparison.png'), fullPage: true })
  for (const name of ['mouth-0_005', 'mouth-0_5', 'eyes-closed']) await page.locator(`#${name}`).screenshot({ path: path.join(directory, `${name}-detail.png`) })
}
finally { await browser.close() }
console.log(JSON.stringify({ evidence: filename, animationEvidence: path.join(directory, 'idle-sampling.html') }))
