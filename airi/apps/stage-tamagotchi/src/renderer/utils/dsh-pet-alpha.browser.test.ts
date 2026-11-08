import { afterEach, expect, it } from 'vitest'

import { isPetCanvasTransparent } from './dsh-pet-alpha'

let canvas: HTMLCanvasElement | undefined
afterEach(() => canvas?.remove())

it('keeps the 2D pet body interactive and ignores transparent video noise at scaled coordinates', () => {
  canvas = document.createElement('canvas')
  canvas.width = 200
  canvas.height = 200
  canvas.style.cssText = 'position:fixed;left:0;top:0;width:100px;height:100px'
  document.body.append(canvas)
  const context = canvas.getContext('2d')!
  context.fillStyle = 'rgba(0,0,0,0.02)'
  context.fillRect(0, 0, 200, 200)
  context.fillStyle = 'white'
  context.fillRect(80, 80, 40, 40)
  expect(isPetCanvasTransparent(canvas, 10, 10)).toBe(true)
  expect(isPetCanvasTransparent(canvas, 50, 50)).toBe(false)
  expect(isPetCanvasTransparent(canvas, 30, 50, 15)).toBe(false)
  expect(isPetCanvasTransparent(canvas, 10, 10, 15)).toBe(true)
  expect(isPetCanvasTransparent(canvas, -1, 50)).toBe(true)
  expect(isPetCanvasTransparent(undefined, 50, 50)).toBe(false)
})
