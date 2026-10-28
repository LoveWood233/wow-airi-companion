import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { all } from '../src/index'

const directory = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'locales')

function flatten(value: unknown, path = ''): Map<string, string> {
  if (typeof value === 'string')
    return new Map([[path, value]])

  if (!value || typeof value !== 'object')
    throw new Error(`Expected a translated string at ${path}`)

  return new Map(Object.entries(value).flatMap(([key, child]) => [...flatten(child, path ? `${path}.${key}` : key)]))
}

function placeholders(value: string): string[] {
  return (value.match(/\{[a-z][\w-]*\}/gi) ?? []).sort()
}

async function yamlFiles(path: string, prefix = ''): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const filename = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory())
      files.push(...await yamlFiles(join(path, entry.name), filename))
    else if (entry.name.endsWith('.yaml'))
      files.push(filename)
  }
  return files
}

describe('companion message catalogs', () => {
  it.each(Object.keys(all))('translates every source message in %s', async (locale) => {
    for (const filename of await yamlFiles(join(directory, 'en'))) {
      const source = flatten(parse(await readFile(join(directory, 'en', filename), 'utf8')))
      const translated = flatten(parse(await readFile(join(directory, locale, filename), 'utf8')))
      const missing = [...source.keys()].filter(key => !translated.has(key))
      const mismatched = [...source].filter(([key, value]) => {
        const target = translated.get(key)
        return target !== undefined && placeholders(value).join('|') !== placeholders(target).join('|')
      }).map(([key]) => key)

      expect(missing, `${locale}/${filename}`).toEqual([])
      expect(mismatched, `${locale}/${filename}`).toEqual([])
    }
  })

  it.each(Object.keys(all))('provides complete companion messages in %s', async (locale) => {
    for (const namespace of ['companion-errors', 'companion-ui', 'wow-addons', 'wow-companion']) {
      const source = flatten(parse(await readFile(join(directory, 'en', `${namespace}.yaml`), 'utf8')))
      const translated = flatten(parse(await readFile(join(directory, locale, `${namespace}.yaml`), 'utf8')))

      expect([...translated.keys()].sort(), `${locale}/${namespace}`).toEqual([...source.keys()].sort())

      for (const [key, value] of translated) {
        expect(value.trim(), `${locale}/${namespace}.${key}`).not.toBe('')
        expect(placeholders(value), `${locale}/${namespace}.${key}`).toEqual(placeholders(source.get(key)!))
      }
    }
  })

  it.each(Object.keys(all))('uses the same product name in %s', async (locale) => {
    const interfaceMessages = flatten(parse(await readFile(join(directory, locale, 'companion-ui.yaml'), 'utf8')))
    const companionMessages = flatten(parse(await readFile(join(directory, locale, 'wow-companion.yaml'), 'utf8')))

    expect(companionMessages.get('title')).toBe(interfaceMessages.get('app.name'))
  })
})
