import assert from 'node:assert/strict'
import test from 'node:test'
import { TailMotionScheduler } from '../tail-motion-scheduler.mjs'

const sessionId = 'demo'
const baseline = 'respiration'
const ok = () => true
const newStage = (options = {}) => new TailMotionScheduler({
  sessionId, startedAt: 1000, initialPlaybackId: baseline, ...options,
})

function request(stage, at, id, options = {}) {
  return stage.accept(at, {
    sessionId,
    visual: { id, clipKey: id, eligible: true, ...options.visual },
    voice: { id, text: 'say ' + id, approved: true, ...options.voice },
    settlement: options.settlement,
  })
}

function prepared(stage, at, requestId, ready = true) {
  return stage.preparation(at, { sessionId, requestId, ready })
}

function tail(stage, at, playbackId = baseline, cycle = 1, overrides = {}, present = ok) {
  return stage.completeTail(at, {
    sessionId, playbackId, cycle, lastFrameFinished: true, finishedAt: at, ...overrides,
  }, present)
}

test('every visual route waits for the current completed tail; speech is available at input time', () => {
  const stage = newStage()
  for (const [i, id] of ['manual', 'captured-drag', 'low-health', 'death'].entries()) {
    const at = 1100 + i
    assert.equal(request(stage, at, id, { visual: { rank: i } }).visual, 'pending')
    assert.equal(prepared(stage, at, id), true)
    assert.equal(stage.takeSpeech().id, id)
    assert.equal(stage.presentOnHeldTail(at, { sessionId, playbackId: baseline }, ok), null)
  }
  for (const invalid of [
    { lastFrameFinished: false }, { finishedAt: 1130 }, { sessionId: 'another' },
    { playbackId: 'old video' }, { cycle: 0 },
  ]) {
    assert.equal(tail(stage, 1200, baseline, 1, invalid), null)
  }
  const result = tail(stage, 1300)
  assert.equal(result.requestId, 'death')
  assert.equal(result.presentedAt, 1300)
  assert.equal(result.count, 1)
  assert.equal(tail(stage, 1301, baseline), null)
})

test('fixed session windows debit successful first frames; no backlog or speech quota between windows', () => {
  const stage = newStage()
  // Epoch 1000 means [1000,61000) and [61000,121000). The bucket does
  // not start on first input, first visual or a wall-clock minute boundary.
  let current = baseline
  for (const [at, id, window, count] of [
    [60996,'a',0,1], [60997,'b',0,2], [61000,'c',1,1], [61001,'d',1,2],
  ]) {
    request(stage, at, id)
    prepared(stage, at, id)
    const result = tail(stage, at, current)
    assert.deepEqual([result.window,result.count,result.presentedAt],[window,count,at])
    current = result.playbackId
    if (id === 'b') assert.equal(request(stage, 60998, 'excess').visual, 'window-full')
  }
  assert.deepEqual(Array.from({length:5},()=>stage.takeSpeech().id), ['a','b','excess','c','d'])
  assert.equal(stage.takeSpeech(), null)
  const other = newStage({windowMs:100,limit:1})
  request(other, 1099, 'old'); prepared(other,1099,'old')
  assert.equal(tail(other,1100),null)
  assert.equal(request(other,1101,'late',{visual:{observedAt:1099}}).visual,'outside-current-window')
  request(other,1101,'fresh'); prepared(other,1101,'fresh')
  assert.equal(other.presentOnHeldTail(1101,{sessionId,playbackId:baseline},ok).window,1)
})

test('loop needs a fresh completed cycle; one-shot may keep its verified last frame', () => {
  const stage = newStage({looping:true})
  request(stage,1100,'walk')
  assert.equal(tail(stage,1110),null) // Decoder not ready when the first cycle ends.
  prepared(stage,1120,'walk')
  assert.equal(stage.presentOnHeldTail(1120,{sessionId,playbackId:baseline},ok),null)
  assert.equal(tail(stage,1130),null) // duplicate completed cycle
  assert.equal(tail(stage,1140,baseline,2,{finishedAt:1135}),null) // delayed callback
  assert.equal(tail(stage,1119,baseline,2),null) // callback from a superseded display tick
  const walk = tail(stage,1150,baseline,2)
  assert.equal(walk.requestId,'walk')
  assert.equal(tail(stage,1160,walk.playbackId),null)
  request(stage,1170,'bow'); prepared(stage,1170,'bow')
  assert.equal(stage.presentOnHeldTail(1180,{sessionId,playbackId:walk.playbackId},ok).requestId,'bow')
})

test('decoding errors, stale preparation, expiry and a failed display consume no visual quota', () => {
  const stage = newStage({limit:1})
  request(stage,1100,'first')
  request(stage,1101,'second')
  assert.equal(prepared(stage,1102,'first'),false)
  assert.equal(prepared(stage,1103,'second',false),true)
  request(stage,1104,'expired',{visual:{expiresAt:1106}});prepared(stage,1105,'expired')
  assert.equal(tail(stage,1106),null)
  request(stage,1107,'bad-display');prepared(stage,1107,'bad-display')
  assert.equal(stage.presentOnHeldTail(1108,{sessionId,playbackId:baseline},()=>false),null)
  request(stage,1109,'healthy');prepared(stage,1109,'healthy')
  assert.equal(stage.presentOnHeldTail(1110,{sessionId,playbackId:baseline},ok).count,1)
  assert.deepEqual(Array.from({length:5},()=>stage.takeSpeech().id),
    ['first','second','expired','bad-display','healthy'])
})

test('event settlements survive a replaced, missing or capped visual and are issued once after the tail', () => {
  const stage = newStage({limit:1})
  const meal = id=>({id,approved:true,payload:{food:'饭团'}})
  request(stage,1100,'feed',{settlement:meal('meal1')})
  request(stage,1101,'reward',{settlement:meal('meal1')})
  assert.equal(stage.takeSettlement(),null)
  prepared(stage,1102,'reward')
  assert.equal(tail(stage,1103,baseline,1,{lastFrameFinished:false}),null)
  assert.equal(stage.takeSettlement(),null)
  const reward=tail(stage,1104)
  assert.equal(reward.requestId,'reward')
  const one=stage.takeSettlement()
  assert.deepEqual(one,{id:'meal1',payload:{food:'饭团'},sessionId,releasedAt:1104})
  assert.equal(stage.takeSettlement(),null)
  assert.equal(request(stage,1110,'capped',{settlement:meal('meal2')}).visual,'window-full')
  assert.equal(request(stage,1111,'missing',{visual:{eligible:false},settlement:meal('meal3')}).visual,'ineligible')
  assert.equal(stage.takeSettlement(),null)
  assert.equal(tail(stage,1112,reward.playbackId),null)
  assert.deepEqual([stage.takeSettlement().id,stage.takeSettlement().id],['meal2','meal3'])
  assert.equal(stage.takeSettlement(),null)
  assert.equal(request(stage,1113,'capped',{settlement:meal('meal2')}).settlement,'duplicate')
  assert.equal(stage.accept(1113,{sessionId,settlement:meal('meal4')}).settlement,'pending-tail')
  stage.presentOnHeldTail(1114,{sessionId,playbackId:reward.playbackId},ok)
  assert.equal(stage.takeSettlement().id,'meal4')
})

test('gated result speech waits for committed business outcome; other visual drops cannot remove FIFO entries', () => {
  const stage=newStage({limit:0})
  const meal={id:'feed-transaction',approved:true}
  request(stage,1100,'receipt',{settlement:meal,voice:{afterSettlement:meal.id}})
  request(stage,1101,'next')
  request(stage,1102,'next-two')
  assert.deepEqual([stage.takeSpeech().id,stage.takeSpeech().id],['next','next-two'])
  assert.equal(stage.takeSpeech(),null) // Only the dependent result is still waiting.
  assert.equal(stage.confirmSettlement({sessionId,id:meal.id,committed:true}),false)
  tail(stage,1110)
  assert.equal(stage.takeSettlement().id,meal.id)
  assert.equal(stage.takeSpeech(),null) // Submission is not business confirmation.
  assert.equal(stage.confirmSettlement({sessionId:'old',id:meal.id,committed:true}),false)
  assert.equal(stage.confirmSettlement({sessionId,id:meal.id,committed:true}),true)
  assert.equal(stage.confirmSettlement({sessionId,id:meal.id,committed:true}),false)
  request(stage,1110,'later')
  assert.deepEqual([stage.takeSpeech().id,stage.takeSpeech().id],['receipt','later'])
  assert.equal(request(stage,1111,'next').voice,'duplicate')
  assert.equal(stage.takeSpeech(),null)
})

test('explicit mute or silence cancels queued speech; a failed business result never claims success', () => {
  const stage=newStage()
  request(stage,1100,'early')
  stage.setSpeechEnabled(false)
  assert.equal(stage.takeSpeech(),null)
  assert.equal(request(stage,1101,'muted').voice,'suppressed-by-preference')
  stage.setSpeechEnabled(true)
  assert.equal(request(stage,1102,'muted').voice,'duplicate')
  request(stage,1103,'success',{settlement:{id:'x',approved:true},voice:{afterSettlement:'x'}})
  assert.equal(stage.takeSpeech(),null)
  tail(stage,1110)
  stage.takeSettlement()
  stage.confirmSettlement({sessionId,id:'x',committed:false})
  request(stage,1111,'failure-report')
  assert.equal(stage.takeSpeech().id,'failure-report')
  assert.equal(stage.takeSpeech(),null)
})

test('host revalidates at the presentation tick; revoked consent does not cut the clip or consume quota', () => {
  const stage = newStage({ limit: 1 })
  const stillAllowed = new Set(['story', 'fresh'])
  const displayed = []
  const presentIfAllowed = (next) => {
    if (!stillAllowed.has(next.requestId)) return false
    displayed.push(next.clipKey)
    return true
  }

  request(stage, 1100, 'story')
  prepared(stage, 1101, 'story')
  stillAllowed.delete('story')
  assert.equal(tail(stage, 1102, baseline, 1, {}, presentIfAllowed), null)
  assert.deepEqual(displayed, [])

  request(stage, 1103, 'fresh')
  prepared(stage, 1104, 'fresh')
  const result = stage.presentOnHeldTail(1105, { sessionId, playbackId: baseline }, presentIfAllowed)
  assert.equal(result.count, 1)
  assert.deepEqual(displayed, ['fresh'])
})
