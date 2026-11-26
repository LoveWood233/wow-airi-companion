// Reproduce the eight-class preview with one session and a deterministic virtual clock.
// Run without arguments to verify the replay, or pass --out <existing-directory>
// to save the inputs, simulated selections and assertions. --stream emits NDJSON;
// --stream --ack waits for one line of stdin after each selected motion.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'
import { chooseVisual, lowHealthDelivery, walletAction } from '../interaction-policy.mjs'

const spec = (name) => JSON.parse(readFileSync(new URL('../' + name, import.meta.url), 'utf8'))
const index = spec('interaction-animation-index.json')
const manifest = spec('eight-class-common-96.json')
const classes = Object.values(manifest.class_directories)
const keys = new Set(manifest.actions.map((a) => a.clip_key))
const byId = new Map(index.actions.map((a) => [a.id, a]))
const available = (key) => keys.has(key)
const common = index.actions.filter((a) => available(a.clip_key))
assert.equal(common.length, 96)
assert.equal(classes.length, 8)
assert.deepEqual(common.map((a) => a.id).sort(), manifest.actions.map((a) => a.id).sort())
const id = (n) => 'A' + String(n).padStart(3, '0')
const byRoute = (key) => index.actions.find((a) => a.route === key)
const withPrefix = (p) => common.filter((a) => a.route.startsWith(p))
const policyCommit = 'b96ef23c47d2d9c29a2ce7b2c51aa4b94a198f9c'

// One simulated player session drives all eight renderers. Only input events
// advance time. Clip names in menu events are player choices; other routes are
// derived from observed changes and the clock.
export class Replay {
  constructor() {
    this.s = {
      now: 0,
      sessionId: 'connected-1',
      characterId: 'demo-player',
      online: true,
      alive: true,
      inCombat: false,
      safeSince: 0,
      atBoundary: true,
      allowAlertAudio: true,
      allowAlertCaption: true,
      shownRequestIds: new Set(),
    }
    this.rows = []
    this.history = []
    this.receipts = []
    this.combatCount = 0
    this.leaves = 0
    this.clickCount = 0
    this.lastClick = -Infinity
    this.lastMenu = -Infinity
    this.lastTopic = 0
    this.lastAccent = 0
    this.idleSince = 0
    this.budget = []
    this.feedCount = 0
    this.voiceDeaths = new Set()
    this.rewards = new Set()
    this.requestNo = 0
    this.lastGate = new Map()
    this.theme = ''
    this.night = false
  }
  step(input) {
    const state = this.s
    assert(Number.isSafeInteger(input.at_ms) && input.at_ms >= state.now, 'monotonic events')
    state.now = input.at_ms
    this.history.push(input)
    const safe = state.alive && !state.inCombat
    const now = state.now
    const receipt = (kind, detail) =>
      this.receipts.push({ event: this.history.length, at_ms: now, kind, detail })
    const show = (a, why, opts = {}) => {
      if (!a || !available(a.clip_key)) return null
      const route = opts.route ?? a.route
      const menu = route.startsWith('menu.')
      if (menu && (!safe || now - this.lastMenu < 10000)) return null
      const priority = menu ? 'manual' : a.priority
      const decorated =
        priority === 'normal' || priority === 'proactive' || (priority === 'idle' && a.id !== 'A079')
      this.budget = this.budget.filter((t) => now - t < 60000)
      if (decorated && this.budget.length >= 2) return null
      const origin =
        opts.origin ?? (menu ? 'menu' : priority === 'proactive' ? 'approved_proactive' : a.entry)
      const event = opts.event ?? (menu ? 'menu_confirmed' : (a.bridge_event ?? a.route))
      const q = {
        id: a.id,
        requestId: 'r' + ++this.requestNo,
        sessionId: state.sessionId,
        characterId: state.characterId,
        combatId: state.combatId,
        eligible: true,
        origin,
        event,
        route,
        observedAt: opts.observedAt ?? now,
        receivedAt: now,
        expiresAt: menu ? now + 12000 : null,
        ...opts.request,
      }
      // Pointer capture controls the picture before normal candidate arbitration.
      const chosen = opts.capture ? (state.dragging ? q : null) : chooseVisual(index, state, [q])
      if (!chosen) return null
      state.shownRequestIds.add(q.requestId)
      if (decorated) this.budget.push(now)
      if (menu) this.lastMenu = now
      if (a.entry === 'idle' && !menu && a.id !== 'A079') this.lastAccent = now
      const row = {
        id: a.id,
        clip_key: a.clip_key,
        entry: a.entry,
        route,
        primary_route: a.route,
        priority,
        at_ms: now,
        trigger: why,
        scene: a.scene,
        input: input.type,
        event_no: this.history.length,
        request_id: q.requestId,
        combat_id: state.combatId ?? null,
        game_state: state.alive ? (state.inCombat ? '战斗' : '脱战') : '死亡',
        alive: state.alive,
        in_combat: state.inCombat,
        dragging: !!state.dragging,
        session_id: state.sessionId,
        allowed_by: opts.capture ? 'pointer capture' : 'PR chooseVisual',
        voice_type: a.voice.type,
      }
      this.rows.push(row)
      receipt('visual-selected', row.id)
      return row
    }
    switch (input.type) {
      case 'session.connected':
        return show(byRoute('idle.breath'), '陪伴连接已建立，舞台进入基础呼吸')
      case 'combat.enter':
        if (!state.inCombat && state.alive) {
          state.inCombat = true
          state.combatId = 'battle-' + ++this.combatCount
          state.latestHealth = null
          state.lowHealthLedger = null
          this.alarm = null
        }
        break
      case 'combat.leave':
        if (state.inCombat) {
          state.inCombat = false
          state.safeSince = now
          this.leaves++
          this.idleSince = now
          this.alarm = null
        }
        break
      case 'player.died':
        if (!state.alive) return null
        state.alive = false
        this.episode = 'death-' + this.combatCount
        this.alarm = null
        if (!this.voiceDeaths.has(this.episode)) {
          this.voiceDeaths.add(this.episode)
          receipt('comfort-voice-intent', this.episode)
        }
        return show(byRoute('game.death.console'), '本场死亡已确认，取消未交付低血并叹气')
      case 'player.revived':
        if (!state.alive) {
          state.alive = true
          state.safeSince = now
          this.revivedAt = now
        }
        break
      case 'revive.settled':
        if (safe && this.revivedAt != null) {
          const t = this.revivedAt
          this.revivedAt = null
          return show(byRoute('game.revive.courtesy'), '复活已确认，安全脱战 10 秒；沿用本轮安慰收据', {
            observedAt: t,
          })
        }
        break
      case 'pointer.move':
        if (this.down && input.max_px > 6 && !state.dragging) {
          state.dragging = true
          return show(
            byRoute('pointer.drag.suspend'),
            '位移 ' + input.max_px + ' CSS 像素，捕获指针并持续跟手',
            { capture: true },
          )
        }
        break
      case 'pointer.down':
        this.down = true
        break
      case 'pointer.up':
        if (!this.down) return null
        this.down = false
        if (state.dragging) {
          state.dragging = false
          state.lastDragReleaseAt = now
          receipt('release', 'consume gesture')
          return null
        }
        if (input.max_px > 6 || now - this.lastClick < 700 || now < (this.clickUntil ?? 0)) return null
        this.lastClick = now
        this.clickUntil = now + 1000
        {
          const choices = [13, 9, 10, 11, 12]
          const a = byId.get(id(choices[this.clickCount++ % 5]))
          return show(
            a,
            '松开手势，位移 ' +
              input.max_px +
              ' 像素。' +
              (a.id === 'A013' ? '首次问候挥手' : '固定测试轮换选中「' + a.clip_key + '」'),
          )
        }
      case 'health.alert': {
        const a = byRoute('game.low_health.startle'),
          q = {
            id: a.id,
            requestId: 'low-' + this.combatCount,
            origin: 'game',
            event: 'low_health',
            eligible: true,
            sessionId: state.sessionId,
            characterId: state.characterId,
            combatId: state.combatId,
            healthPercent: input.percent,
            observedAt: now,
            receivedAt: now,
            expiresAt: now + 10000,
          }
        this.alarm = q
        const d = lowHealthDelivery(index, state, q)
        if (d.audio || d.caption) {
          state.lowHealthLedger = {
            ...state.lowHealthLedger,
            sessionId: state.sessionId,
            characterId: state.characterId,
            combatId: state.combatId,
            audioDisposition: d.audioDisposition,
            captionDelivered: d.caption || state.lowHealthLedger?.captionDelivered,
          }
          if (d.audio) receipt('low-health-voice-intent', 'reserved')
        }
        const v = show(a, '战斗中出现 ' + input.percent + '% 的低血事件', { request: q })
        if (v) state.lowHealthLedger.visualDelivered = true
        return v
      }
      case 'health.read': {
        state.latestHealth = {
          verified: true,
          sessionId: state.sessionId,
          characterId: state.characterId,
          combatId: state.combatId,
          at: now,
          percent: input.percent,
        }
        if (!this.alarm) return null
        const v = show(
          byRoute('game.low_health.startle'),
          '松手后复核同角色、同一战斗血量仍为 ' + input.percent + '%，补播画面',
          { request: this.alarm },
        )
        if (v) state.lowHealthLedger.visualDelivered = true
        return v
      }
      case 'zone.gate':
        if (
          safe &&
          input.requiredLevel > input.playerLevel &&
          now - (this.lastGate.get(input.zone) ?? -Infinity) >= 120000
        ) {
          const v = show(
            byRoute('game.level_gate.pace'),
            '进入野外边界，当前等级 ' + input.playerLevel + '，区域要求 ' + input.requiredLevel,
          )
          if (v) this.lastGate.set(input.zone, now)
          return v
        }
        break
      case 'reward':
        if (this.rewards.has(input.outcome)) return null
        {
          const boss = input.bossConfirmed && input.participated && input.won && input.permits
          if (!boss && !input.levelUp) return null
          const opts = boss
            ? { route: 'confirmed_boss_victory', origin: 'game', event: 'boss_defeated' }
            : {}
          const v = show(
            byRoute('game.level_up.celebrate'),
            boss
              ? '已核实本人参战并击败首领，主动许可有效，同一战果升级只庆祝一次'
              : '桥接确认当前角色升级',
            opts,
          )
          if (v) this.rewards.add(input.outcome)
          return v
        }
      case 'loot.item':
        if (!this.loot || now - this.loot.last > 8000)
          this.loot = { first: now, last: now, ids: new Set() }
        if (!this.loot.ids.has(input.item)) {
          this.loot.ids.add(input.item)
          this.loot.last = now
        }
        break
      case 'loot.flush':
        if (this.loot && now - this.loot.last >= 8000) {
          const l = this.loot
          this.loot = null
          const route = input.archiveBusy ? 'game.loot.record' : 'game.loot.archive'
          return show(
            byRoute(route),
            '8 秒窗口已关闭，' +
              l.ids.size +
              ' 次独立掉落合成一批，' +
              (input.archiveBusy ? '首选收纳段本次不可用，采用记录替补' : '首选清点归档') +
              '；整批静音',
            { observedAt: l.first },
          )
        }
        break
      case 'menu.pick': {
        const a = index.actions.find((x) => x.clip_key === input.clip)
        if (!a) return null
        const route = a.route.startsWith('menu.') ? a.route : a.secondary_route
        if (!route) return null
        return show(a, '玩家点名「' + a.clip_key + '」，在安全片尾接受此菜单请求', { route })
      }
      case 'feed.start':
        if (safe && !this.feed) {
          this.feed = 'enter'
          this.feedCount++
          return show(
            byId.get(id(this.feedCount % 2 ? 14 : 15)),
            '玩家启动第 ' + this.feedCount + ' 轮喂饭，轮换入场',
          )
        }
        break
      case 'feed.enter-ended':
        if (this.feed === 'enter') {
          this.feed = 'wait'
          this.feedWait = now
          if (!input.food) return show(byId.get('A016'), '入场结束，尚未选食物，等待投喂')
        } else break
      // A preselected food can be handed off at the entrance boundary.
      case 'feed.choose':
        if (
          this.feed === 'wait' &&
          now - this.feedWait < 20000 &&
          ['碗饭', '饭团'].includes(input.food)
        ) {
          this.feed = null
          return show(
            byId.get(id(input.food === '碗饭' ? 17 : 18)),
            '本轮已选「' + input.food + '」，消费一次选择并退出喂饭',
          )
        }
        break
      case 'question':
        this.turn = {
          id: input.turn,
          kind: input.kind,
          at: now,
          answered: false,
          spoken: false,
          waiting: false,
          story: input.story === true,
        }
        if (input.kind === 'food') return show(byRoute('dialogue.food_choice'), '本轮明确询问要吃什么')
        if (input.kind === 'thinking')
          return show(byRoute('dialogue.thinking'), '新问题已提交，答案尚未就绪')
        break
      case 'query.timer':
        if (
          this.turn &&
          !this.turn.answered &&
          !this.turn.waiting &&
          ['bag', 'character'].includes(this.turn.kind) &&
          now - this.turn.at > 2000
        ) {
          this.turn.waiting = true
          return show(
            byId.get(id(this.turn.kind === 'character' ? 74 : 75)),
            '本轮' +
              (this.turn.kind === 'character' ? '角色资料' : '背包') +
              '查询等待 ' +
              (now - this.turn.at) +
              ' 毫秒且尚未返回',
          )
        }
        break
      case 'answer':
        if (!this.turn || input.turn !== this.turn.id || !input.approved || this.turn.stopped)
          return null
        this.turn.answered = true
        if (this.turn.story && !this.turn.spoken && input.progressOk && input.consent) {
          this.turn.spoken = true
          receipt('segment-intent', input.turn)
          return show(byRoute('dialogue.speaking'), '玩家同意听与当前进度相符的故事，首段正文获准', {
            route: 'consented_story_first_segment',
            origin: 'interaction',
            event: 'consented_story_segment_ready',
          })
        }
        break
      case 'quiet':
        this.quiet = true
        if (this.turn) this.turn.stopped = true
        receipt('cancel-speech', 'stop current & remaining segments')
        break
      case 'wallet': {
        const n = walletAction(index, {
          requested: true,
          verified: input.verified === true,
          characterId: input.characterId,
          activeCharacterId: state.characterId,
          balanceCopper: input.balance,
          targetCopper: input.target,
        })
        if (n)
          return show(
            byId.get(n),
            '主动查钱袋，同角色余额 ' + input.balance + ' 铜，目标 ' + input.target + ' 铜',
          )
        break
      }
      case 'proactive':
        if (
          !this.quiet &&
          safe &&
          input.approved &&
          state.now - state.safeSince >= 10000 &&
          this.leaves >= 5 &&
          now - this.lastTopic >= 300000 &&
          !state.playerSpeaking
        ) {
          const v = show(
            byId.get(id(input.topic === '收拾' ? 71 : 72)),
            '话题「' +
              input.topic +
              '」已获准，累积 ' +
              this.leaves +
              ' 次脱战且距上次主动话题至少 5 分钟',
          )
          if (v) {
            this.leaves = 0
            this.lastTopic = now
          }
          return v
        }
        break
      case 'nap.start':
        if (safe && !this.nap) {
          this.nap = { stage: 'enter', at: now }
          return show(byRoute('nap.enter'), '玩家主动选择小睡，开启 10 分钟计时')
        }
        break
      case 'nap.enter-ended':
        if (this.nap?.stage === 'enter') {
          this.nap.stage = 'loop'
          return show(byRoute('nap.loop'), '本次小睡尚未被唤醒，开始段自然结束')
        }
        break
      case 'nap.wake':
        if (this.nap && (input.tap || now - this.nap.at >= 600000)) {
          this.nap = null
          this.idleSince = this.lastAccent = now
          return show(
            byRoute('nap.wake'),
            input.tap ? '玩家轻点唤醒，消费这一手势' : '同一轮小睡到达 10 分钟，立即唤醒',
          )
        }
        break
      case 'idle.preferences':
        this.night = input.night
        this.theme = input.theme
        this.idleLocalHour = input.localHour
        break
      case 'idle.tick': {
        if (
          !safe ||
          this.nap ||
          this.feed ||
          state.dragging ||
          now - this.lastAccent < 45000 ||
          now - this.lastAccent > 90000
        )
          return null
        const pool = withPrefix('idle.')
          .filter(
            (a) =>
              a.route === 'idle.look' ||
              a.route.startsWith('idle.variation/') ||
              a.route.startsWith('idle.pastime/'),
          )
          .filter(
            (a) => !['A083', 'A084'].includes(a.id) || this.night || now - this.idleSince >= 300000,
          )
          .filter(
            (a) =>
              a.id !== 'A086' ||
              (this.theme === '夏日' && this.idleLocalHour >= 8 && this.idleLocalHour < 18),
          )
          .filter((a) => a.id !== 'A087' || (this.idleLocalHour >= 6 && this.idleLocalHour < 10))
          .filter((a) => !a.route.startsWith('idle.pastime/') || now - this.idleSince >= 180000)
          .filter((a) => !(this.idleSeen ?? new Set()).has(a.id))
        // Fixed order is a deterministic coverage seed for the eligible idle pool.
        const a = pool[0]
        if (!a) return null
        const v = show(a, '安全待机轮换已到，' + a.requires)
        if (v) {
          this.idleSeen ??= new Set()
          this.idleSeen.add(a.id)
        }
        return v
      }
      default:
        throw Error('Unknown input: ' + input.type)
    }
    return null
  }
}

export function replay(events, deliver = () => {}) {
  const machine = new Replay()
  for (const event of events) {
    const row = machine.step(event)
    if (row) deliver(row, event)
  }
  return machine
}

// Advance a single clock. Press/release, combat, loot, story and feeding state
// persist until a recorded input changes them. Clock advances are virtual.
function scenario() {
  const events = []
  let t = 0
  function send(type, params = {}, delta = 18000) {
    t += delta
    events.push({ at_ms: t, type, ...params })
  }
  const pick = (a) => send('menu.pick', { clip: a.clip_key })
  const fights = () => {
    for (let n = 0; n < 5; n++) {
      send('combat.enter', {}, 1000)
      send('combat.leave', {}, 1000)
    }
  }
  send('session.connected', {}, 0)
  send('combat.enter', {}, 1000)
  send('pointer.down', {}, 17500)
  send('pointer.move', { max_px: 9 }, 0)
  send('health.alert', { percent: 19 }, 17000)
  send('pointer.up', { max_px: 9 }, 1000)
  send('health.read', { percent: 18 }, 100)
  send('player.died')
  send('combat.leave', {}, 1000)
  send('player.revived', {}, 7000)
  send('revive.settled', {}, 10100)
  send('loot.item', { item: 501 }, 25000)
  send('loot.item', { item: 502 }, 1900)
  send('loot.flush', { archiveBusy: false }, 8100)
  send('loot.item', { item: 581 }, 34800)
  send('loot.flush', { archiveBusy: true }, 8100)
  send('zone.gate', { zone: '荒原', requiredLevel: 55, playerLevel: 46 }, 38000)
  send(
    'reward',
    {
      outcome: 'boss7-level',
      bossConfirmed: true,
      participated: true,
      won: true,
      permits: true,
      levelUp: true,
    },
    35000,
  )
  for (let k = 0; k < 5; k++) {
    send('pointer.down')
    send('pointer.up', { max_px: 3 }, 60)
  }
  fights()
  send('proactive', { topic: '收拾', approved: true }, 20000)
  send('feed.start')
  send('feed.enter-ended')
  send('feed.choose', { food: '碗饭' }, 17000)
  send('feed.start')
  send('feed.enter-ended', { food: '饭团' })
  for (const a of common.filter((a) => a.route.startsWith('menu.'))) pick(a)
  fights()
  send('proactive', { topic: '闲谈', approved: true }, 20000)
  send('question', { turn: 'd1', kind: 'food' })
  send('answer', { turn: 'd1', approved: true }, 1500)
  send('question', { turn: 'd2', kind: 'thinking' })
  send('answer', { turn: 'd2', approved: true }, 1600)
  send('question', { turn: 'q1', kind: 'character' })
  send('query.timer', {}, 2100)
  send('answer', { turn: 'q1', approved: true }, 16100)
  send('question', { turn: 'q2', kind: 'bag' })
  send('query.timer', {}, 2500)
  send('answer', { turn: 'q2', approved: true }, 16100)
  send('question', { turn: 's1', kind: 'story', story: true })
  send('answer', { turn: 's1', approved: true, consent: true, progressOk: true }, 1050)
  send('quiet', {}, 16500)
  for (const balance of [10000, 7500, 4000, 1500, 1, 0])
    send('wallet', { balance, target: 10000, verified: true, characterId: 'demo-player' })
  send('nap.start')
  send('nap.enter-ended')
  send('nap.wake', { tap: false }, 582000)
  // The clock advances continuously over one morning. Summer ambience is a
  // user preference, and the breakfast/midday/evening clips below are requests.
  send('idle.preferences', { theme: '夏日', localHour: 8, night: false }, 0)
  for (let n = 0; n < 9; n++) send('idle.tick', {}, 60000)
  // The only shared pastime (撸猫) has appeared at the last idle tick.
  for (const a of common.filter((a) => a.secondary_route && !a.route.startsWith('idle.pastime/')))
    pick(a)
  return events
}

function assertions() {
  const checks = []
  function check(name, expect, actual) {
    assert.deepEqual(actual, expect, name)
    checks.push({ name, expected: expect, observed: actual, pass: true })
  }
  function make() {
    const m = new Replay()
    let t = 0
    return { m, send: (type, p = {}, d = 100) => m.step({ at_ms: (t += d), type, ...p })?.id ?? null }
  }
  for (const [pct, expected] of [
    [18, 'A002'],
    [20, null],
    [null, null],
  ]) {
    const { m, send } = make()
    send('combat.enter')
    send('pointer.down')
    send('pointer.move', { max_px: 7 })
    check('拖动不抢画面，松手分支 ' + pct, null, send('health.alert', { percent: 19 }))
    send('pointer.up', { max_px: 7 })
    if (pct !== null) check('释放复核 ' + pct, expected, send('health.read', { percent: pct }))
    if (pct === null)
      check('缺释放读数时原请求仍被拒绝', null, chooseVisual(index, m.s, [m.alarm])?.id ?? null)
    check(
      '同场提醒一次，松手分支 ' + pct,
      1,
      m.receipts.filter((e) => e.kind === 'low-health-voice-intent').length,
    )
  }
  {
    const { m, send } = make()
    send('combat.enter')
    send('pointer.down')
    send('pointer.move', { max_px: 8 })
    send('health.alert', { percent: 19 })
    send('pointer.up', { max_px: 8 })
    check('延迟 10 秒过期警报', null, send('health.read', { percent: 18 }, 10000))
    send('player.died')
    send('combat.leave')
    send('player.revived')
    check(
      '复活时旧死亡不复播',
      null,
      chooseVisual(index, m.s, [
        {
          id: 'A007',
          requestId: 'old',
          origin: 'game',
          event: 'death',
          eligible: true,
          sessionId: m.s.sessionId,
          characterId: m.s.characterId,
          observedAt: m.s.now,
          receivedAt: m.s.now,
          expiresAt: null,
        },
      ])?.id ?? null,
    )
    check('安全复活行礼', 'A001', send('revive.settled', {}, 10100))
    check('死到复活一个安慰意图', 1, m.receipts.filter((e) => e.kind === 'comfort-voice-intent').length)
  }
  {
    const { m, send } = make()
    check('普通脱战不当作首领战果', null, send('reward', { outcome: 'a', levelUp: false }, 10500))
    check(
      '升级和首领同一战果一次',
      'A006',
      send('reward', {
        outcome: 'a',
        bossConfirmed: true,
        participated: true,
        won: true,
        permits: true,
        levelUp: true,
      }),
    )
    check('同战果随后抵达不叠加', null, send('reward', { outcome: 'a', levelUp: true }))
    send('question', { turn: 't', kind: 'bag' })
    check('查询正好 2 秒不入等待', null, send('query.timer', {}, 2000))
    check('查询 2001 毫秒入等待', 'A075', send('query.timer', {}, 1))
    send('answer', { turn: 't', approved: true })
    check('已返回的查询不重演等待', null, send('query.timer'))
    send('question', { turn: 'n', kind: 'story', story: true })
    send('answer', { turn: 'n', approved: true, consent: true, progressOk: true })
    send('quiet')
    check(
      '安静时取消当前和后续语段',
      null,
      send('answer', { turn: 'n', approved: true, consent: true, progressOk: true }),
    )
    check(
      '安静时有终止收据且无告别',
      ['segment-intent', 'cancel-speech'],
      m.receipts.filter((r) => /segment-intent|cancel-speech|farewell/.test(r.kind)).map((r) => r.kind),
    )
    for (let i = 0; i < 5; i++) {
      send('combat.enter')
      send('combat.leave')
    }
    check('安静后不启动主动话题', null, send('proactive', { topic: '闲谈', approved: true }, 330000))
    check('七职业缺片，小提琴点名拒绝', null, send('menu.pick', { clip: '小提琴演奏' }))
    send('pointer.down')
    check('正好 6 像素是轻点', 'A013', send('pointer.up', { max_px: 6 }))
    send('pointer.down')
    check('重复轻点合并', null, send('pointer.up', { max_px: 0 }))
    check(
      '缺金额不伪造钱袋档位',
      null,
      send('wallet', { target: 10000, balance: null, verified: true, characterId: 'demo-player' }),
    )
  }
  return checks
}

async function main() {
  const events = scenario()
  if (process.argv.includes('--stream')) {
    // A line of stdin releases the consumer's last visual. Leave no unobserved
    // input promise in flight; the next transition happens only after that ack.
    const input = process.argv.includes('--ack')
      ? createInterface({ input: process.stdin, terminal: false })
      : null
    const ack = input?.[Symbol.asyncIterator]()
    const machine = new Replay()
    for (const e of events) {
      const row = machine.step(e)
      if (row) {
        process.stdout.write(JSON.stringify(row) + '\n')
        if (ack && (await ack.next()).done) throw Error('ACK stream closed before all visuals finished')
      }
    }
    input?.close()
    process.stdin.unref?.()
    return
  }
  const m = replay(events)
  const counts = Object.fromEntries(
    common.map((a) => [a.id, m.rows.filter((r) => r.id === a.id).length]),
  )
  assert.equal(m.rows.length, 96, JSON.stringify(Object.entries(counts).filter(([, n]) => n !== 1)))
  assert(
    Object.values(counts).every((n) => n === 1),
    'each shared clip appears once',
  )
  for (let j = 1; j < m.rows.length; j++)
    assert(m.rows[j].at_ms - m.rows[j - 1].at_ms >= 16000, 'minimum display interval ' + m.rows[j].id)
  assert.deepEqual(replay(events).rows, m.rows, 'deterministic')
  const outFlag = process.argv.indexOf('--out')
  const output = outFlag < 0 ? null : process.argv[outFlag + 1]
  if (outFlag >= 0 && !output) throw Error('--out requires an existing destination directory')
  const checks = assertions()
  if (output) {
    const write = (f, data) => writeFileSync(join(output, f), JSON.stringify(data, null, 2) + '\n')
    write('events.json', { clock: 'monotonic-ms', events })
    write('timeline.json', {
      media_commit: manifest.source.commit,
      policy_commit: policyCommit,
      scope: '单会话虚拟输入。rows 是参考逻辑产生的选片，不代表客户端实际渲染或发声。',
      virtual_duration_ms: m.s.now,
      classes,
      count: m.rows.length,
      rows: m.rows,
      receipts: m.receipts,
    })
    write('replay-checks.json', { count: checks.length, checks })
  }
  console.log(
    m.rows.length +
      ' shared motions, ' +
      events.length +
      ' ordered inputs, ' +
      checks.length +
      ' boundary checks; ' +
      m.s.now +
      ' virtual ms',
  )
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
