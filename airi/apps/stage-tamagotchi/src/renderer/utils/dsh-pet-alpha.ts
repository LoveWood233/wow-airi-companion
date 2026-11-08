/** Reads the rendered 2D pet canvas in CSS coordinates. Low-alpha video noise leaves the desktop clickable. */
export function isPetCanvasTransparent(canvas: HTMLCanvasElement | undefined, clientX: number, clientY: number, radius = 0): boolean {
  if (!canvas)
    return false
  const bounds = canvas.getBoundingClientRect()
  if (!bounds.width || !bounds.height || !canvas.width || !canvas.height)
    return false
  const x = clientX - bounds.left
  const y = clientY - bounds.top
  if (x < 0 || y < 0 || x >= bounds.width || y >= bounds.height)
    return true
  const scaleX = canvas.width / bounds.width
  const scaleY = canvas.height / bounds.height
  const centerX = Math.floor(x * scaleX)
  const centerY = Math.floor(y * scaleY)
  const left = Math.max(0, centerX - Math.ceil(radius * scaleX))
  const top = Math.max(0, centerY - Math.ceil(radius * scaleY))
  const right = Math.min(canvas.width - 1, centerX + Math.ceil(radius * scaleX))
  const bottom = Math.min(canvas.height - 1, centerY + Math.ceil(radius * scaleY))
  const width = right - left + 1
  try {
    const context = canvas.getContext('2d')
    if (!context)
      return false
    const pixels = context.getImageData(left, top, width, bottom - top + 1).data
    for (let py = top; py <= bottom; py++) {
      for (let px = left; px <= right; px++) {
        if (radius && ((px - centerX) / scaleX) ** 2 + ((py - centerY) / scaleY) ** 2 > radius ** 2)
          continue
        if (pixels[((py - top) * width + px - left) * 4 + 3]! >= 32)
          return false
      }
    }
    return true
  }
  catch {
    // An unreadable frame retains pointer access so the user can change the pack or open settings.
    return false
  }
}
