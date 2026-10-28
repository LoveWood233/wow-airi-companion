import { parse } from 'valibot'
import { describe, expect, it } from 'vitest'

import { macroImportSchema } from './wow-macro-import'

describe('macro import request', () => {
  it('preserves actual multiline macro text and normalizes Windows newlines', () => {
    expect(parse(macroImportSchema, { game: 'retail', body: '\r\n#showtooltip\r\n/targetexact 测试\r\n' })).toEqual({
      game: 'retail',
      body: '#showtooltip\n/targetexact 测试',
    })
  })

  it.each(['', '```lua\n/cast Test\n```', `/cast ${'测'.repeat(100)}`, '/cast x\0', '/cast \uD800', 'hello\n/cast Test'])(
    'rejects invalid input before invoking native input: %j',
    (body) => {
      expect(() => parse(macroImportSchema, { game: 'retail', body })).toThrow()
    },
  )

  it('accepts the byte limit without truncation', () => {
    const body = `/cast ${'x'.repeat(249)}`
    expect(parse(macroImportSchema, { game: 'forever', body }).body).toBe(body)
    expect(() => parse(macroImportSchema, { game: 'forever', body: `${body}x` })).toThrow()
  })

  it('rejects unsupported game profiles', () => {
    expect(() => parse(macroImportSchema, { game: 'classic', body: '/cast Test' })).toThrow()
  })
})
