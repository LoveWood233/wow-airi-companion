import type { ServerResponse } from 'node:http'

import type { BridgeStatus, GameVersion } from '../../../shared/wow-companion'

import { createServer } from 'node:http'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { CompanionBridgeClient } from './wow-companion-client'

function status(cursor: number): BridgeStatus {
  return {
    instanceId: 'decoder-1',
    status: 'waiting',
    source: 'screen',
    snapshot: null,
    lastSeen: null,
    ageSeconds: null,
    eventCursor: cursor,
    events: [],
    equipmentComparisons: [],
    equipmentComparisonError: null,
    equipmentLoadout: null,
    equipmentLoadoutError: null,
    inventory: null,
    inventoryReceivedAt: null,
    inventoryError: null,
    quests: null,
    questsReceivedAt: null,
    questsError: null,
    talents: null,
    talentsReceivedAt: null,
    talentsError: null,
    config: { x: 8, y: 8, cellSize: 2, pollMs: 500, paused: false },
    error: null,
  }
}

function respond(response: ServerResponse, cursor: number) {
  response.writeHead(200, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(status(cursor)))
}

describe('woW bridge HTTP request ordering', () => {
  const requests: { method: string | undefined, response: ServerResponse }[] = []
  let autoRead = false
  const server = createServer((request, response) => {
    requests.push({ method: request.method, response })
    request.resume()
    if (autoRead && request.method === 'GET')
      respond(response, 0)
  })
  let client: CompanionBridgeClient

  beforeEach(async () => {
    requests.length = 0
    autoRead = false
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string')
      throw new Error('Expected a loopback HTTP address')
    client = new CompanionBridgeClient(`http://127.0.0.1:${address.port}`)
  })

  afterEach(async () => {
    client.dispose()
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  })

  it('suspends new reads during a write and discards the earlier read', async () => {
    const initial = client.refresh()
    await expect.poll(() => requests.length).toBe(1)
    respond(requests[0].response, 0)
    await initial

    const oldRead = client.refresh()
    await expect.poll(() => requests.length).toBe(2)
    const write = client.update('/api/demo', { enabled: true, action: 'level_up' })
    await expect.poll(() => requests.length).toBe(3)
    respond(requests[1].response, 1)
    await oldRead
    expect(client.read().bridge?.eventCursor).toBe(0)

    // A read started during the write can return an older cursor after the command completes.
    autoRead = true
    await client.refresh()
    const readsDuringWrite = requests.filter(request => request.method === 'GET').length

    respond(requests[2].response, 2)
    await write
    expect(readsDuringWrite).toBe(2)
    expect(client.read().bridge?.eventCursor).toBe(2)
  })

  it('reads independent container pages without replacing the character status', async () => {
    const ready = client.refresh()
    await expect.poll(() => requests.length).toBe(1)
    respond(requests[0].response, 5)
    await ready
    const pending = client.readItemStorage(0)
    await expect.poll(() => requests.length).toBe(2)
    const page = { instanceId: 'decoder-1', cursor: 1, record: {
      v: 2,
      id: 1,
      session: 'session-1',
      guid: 'Player-1',
      observedAt: 1793764800,
      scope: 'bags',
      container: 1,
      capacity: 0,
      complete: true,
      cached: false,
      slots: [],
    }, hasMore: false }
    requests[1].response.writeHead(200, { 'Content-Type': 'application/json' })
    requests[1].response.end(JSON.stringify(page))
    await expect(pending).resolves.toEqual(page)
    expect(client.read().bridge?.eventCursor).toBe(5)
  })

  it('rejects a late container response after the connection generation changes', async () => {
    const ready = client.refresh()
    await expect.poll(() => requests.length).toBe(1)
    respond(requests[0].response, 0)
    await ready
    const pending = client.readItemStorage(0)
    const rejected = expect(pending).rejects.toThrow()
    await expect.poll(() => requests.length).toBe(2)
    client.invalidate()
    requests[1].response.writeHead(200, { 'Content-Type': 'application/json' })
    requests[1].response.end(JSON.stringify({ instanceId: 'decoder-1', cursor: 1, record: null, hasMore: false }))
    await rejected
    expect(client.read().bridge).toBeNull()
  })

  it('rejects an oversized declared container response before parsing the body', async () => {
    const pending = client.readItemStorage(0)
    const rejected = expect(pending).rejects.toThrow('size limit')
    await expect.poll(() => requests.length).toBe(1)
    requests[0].response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': String(3 * 1024 * 1024) })
    requests[0].response.end('{}')
    await rejected
  })

  it('retains the newest command when write responses arrive in reverse order', async () => {
    const first = client.update('/api/demo', { enabled: true })
    await expect.poll(() => requests.length).toBe(1)
    const second = client.update('/api/demo', { enabled: true, action: 'level_up' })
    await expect.poll(() => requests.length).toBe(2)
    respond(requests[1].response, 2)
    await second
    respond(requests[0].response, 1)
    await first
    expect(client.read().bridge?.eventCursor).toBe(2)
  })

  it('resumes polling after a failed command', async () => {
    const command = client.update('/api/config', { cellSize: 2 })
    const rejected = expect(command).rejects.toThrow('"status":500')
    await expect.poll(() => requests.length).toBe(1)
    requests[0].response.writeHead(500)
    requests[0].response.end()
    await rejected

    const next = client.refresh()
    await expect.poll(() => requests.length).toBe(2)
    respond(requests[1].response, 3)
    await next
    expect(client.read().bridge?.eventCursor).toBe(3)
    expect(client.read().error).toBeNull()
  })

  it('does not restore cached observations after settings invalidate a pending read', async () => {
    const read = client.refresh()
    await expect.poll(() => requests.length).toBe(1)
    client.invalidate()
    respond(requests[0].response, 1)
    await read
    expect(client.read().bridge).toBeNull()
  })

  it.each([
    { game: 'retail' as const, identity: { game: 'forever', protocol: 'WCF1' } },
    { game: 'forever' as const, identity: { game: 'retail', protocol: 'WCP1' } },
    { game: 'forever' as const, identity: {} },
  ])('rejects observations from another game for $game', async ({ game, identity }) => {
    const address = server.address()
    if (!address || typeof address === 'string')
      throw new Error('Expected a loopback HTTP address')
    client.dispose()
    client = new CompanionBridgeClient(`http://127.0.0.1:${address.port}`, game)
    const read = client.refresh()
    await expect.poll(() => requests.length).toBe(1)
    requests[0].response.writeHead(200, { 'Content-Type': 'application/json' })
    requests[0].response.end(JSON.stringify({ ...status(1), ...identity }))
    await read
    expect(client.read().bridge).toBeNull()
    expect(client.read().error).toContain(`"game":"${game}"`)
  })

  it('keeps Forever events and capture writes separate from Retail', async () => {
    const otherRequests: { method: string | undefined, body: string }[] = []
    const other = createServer((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk: string) => {
        body += chunk
      })
      request.on('end', () => {
        otherRequests.push({ method: request.method, body })
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ ...status(50), game: 'forever' satisfies GameVersion, protocol: 'WCF1', instanceId: 'forever-1' }))
      })
    })
    await new Promise<void>(resolve => other.listen(0, '127.0.0.1', resolve))
    const address = other.address()
    if (!address || typeof address === 'string')
      throw new Error('Expected a loopback HTTP address')
    const forever = new CompanionBridgeClient(`http://127.0.0.1:${address.port}`, 'forever')
    try {
      const retailRead = client.refresh()
      await expect.poll(() => requests.length).toBe(1)
      respond(requests[0].response, 4)
      await retailRead
      await forever.refresh()
      await forever.update('/api/config', { x: 88 })
      expect(client.read().bridge?.eventCursor).toBe(4)
      expect(client.read().bridge?.instanceId).toBe('decoder-1')
      expect(forever.read().bridge?.eventCursor).toBe(50)
      expect(forever.read().bridge?.instanceId).toBe('forever-1')
      expect(requests).toHaveLength(1)
      expect(otherRequests).toEqual([{ method: 'GET', body: '' }, { method: 'POST', body: '{"x":88}' }])
      forever.dispose()
      expect(client.read().bridge?.eventCursor).toBe(4)
    }
    finally {
      forever.dispose()
      other.closeAllConnections()
      await new Promise<void>((resolve, reject) => other.close(error => error ? reject(error) : resolve()))
    }
  })

  it('preserves scene metadata from the decoder HTTP response', async () => {
    const read = client.refresh()
    await expect.poll(() => requests.length).toBe(1)
    requests[0].response.writeHead(200, { 'Content-Type': 'application/json' })
    requests[0].response.end(JSON.stringify({
      ...status(1),
      status: 'live',
      snapshot: {
        v: 3,
        session: 'instance-test',
        seq: 1,
        tick: 1,
        guid: 'Player-test',
        name: 'Traveler',
        realm: 'Realm',
        level: 30,
        class: 'MAGE',
        faction: 'Alliance',
        race: 'Human',
        spec: 64,
        map: 1461,
        zone: 'Battleground',
        instanceType: 'pvp',
        instanceID: 529,
        combat: false,
        dead: false,
        online: true,
        account: 'account-test',
        moneyEpoch: 'epoch-test',
        copper: 0,
        earned: 0,
        spent: 0,
      },
    }))
    await read
    expect(client.read().error).toBeNull()
    expect(client.read().bridge?.snapshot?.instanceType).toBe('pvp')
    expect(client.read().bridge?.snapshot?.instanceID).toBe(529)
  })

  it('sends an explicit reconnect and preserves receiver diagnostics from the reply', async () => {
    const request = client.update('/api/reconnect', {})
    await expect.poll(() => requests.length).toBe(1)
    expect(requests[0].method).toBe('POST')
    expect(requests[0].response.req.url).toBe('/api/reconnect')
    requests[0].response.writeHead(200, { 'Content-Type': 'application/json' })
    requests[0].response.end(JSON.stringify({ ...status(5), connection: { phase: 'validating', reason: null, attempts: 1, consecutive: 2, lastFrameAt: null, calibratedAt: null, retrySeconds: 0, calibration: null }, transfers: [{ kind: 'gear', phase: 'receiving', received: 2, total: 20, elapsedSeconds: 3, timeoutSeconds: 1200 }] }))
    await request
    expect(client.read().bridge?.connection?.consecutive).toBe(2)
    expect(client.read().bridge?.transfers?.[0].received).toBe(2)
  })
})
