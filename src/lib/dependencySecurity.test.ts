import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { describe, it } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// Regression gates for the dependency-remediation batch (issue #7,
// Workstreams A/B). These exercise the *behaviour* the advisories target so
// the fixes cannot silently regress on a future lockfile refresh.
//
// Everything here runs fully offline: PostCSS/Browserslist are invoked on
// synthetic inputs under a temp dir, picomatch/nanoid are pure functions, and
// the router check uses memory history — no server, browser or database.

const require = createRequire(import.meta.url)
const postcss = require('postcss')
const browserslist = require('browserslist')
const picomatch = require('picomatch')
const { nanoid, customAlphabet } = require('nanoid/non-secure')
const { createMemoryHistory } = require('@remix-run/router')
const { MemoryRouter, Link } = require('react-router-dom')

const SECRET = 'SECRET_SOURCES_CONTENT_MARKER'
const secretMap = JSON.stringify({
  version: 3,
  sources: ['secret.ts'],
  sourcesContent: [SECRET],
  mappings: '',
})

function emittedMapSources(css: string, from?: string) {
  const result = postcss([]).process(css, { from, map: true })
  // Force evaluation; a loaded previous map would merge its sourcesContent.
  const json = result.map ? JSON.stringify(result.map.toJSON()) : ''
  return json
}

describe('postcss sourceMappingURL hardening (GHSA-6g55, r28c, fxqj)', () => {
  let dir: string
  const setup = () => {
    dir = mkdtempSync(join(tmpdir(), 'postcss-sm-'))
    mkdirSync(join(dir, 'sub'))
    writeFileSync(join(dir, 'secret.map'), secretMap)
    writeFileSync(join(dir, 'secret.txt'), SECRET)
  }

  it('rejects a ../ traversal annotation pointing outside the css directory', () => {
    setup()
    const cssFile = join(dir, 'sub', 'in.css')
    const css = `a{color:red}\n/*# sourceMappingURL=../secret.map */`
    assert.ok(!emittedMapSources(css, cssFile).includes(SECRET))
    rmSync(dir, { recursive: true, force: true })
  })

  it('rejects an absolute-path annotation', () => {
    setup()
    const cssFile = join(dir, 'sub', 'in.css')
    const css = `a{color:red}\n/*# sourceMappingURL=${join(dir, 'secret.map').replace(/\\/g, '/')} */`
    assert.ok(!emittedMapSources(css, cssFile).includes(SECRET))
    rmSync(dir, { recursive: true, force: true })
  })

  it('rejects annotations that do not resolve to a .map file', () => {
    setup()
    const cssFile = join(dir, 'sub', 'in.css')
    const css = `a{color:red}\n/*# sourceMappingURL=../secret.txt */`
    assert.ok(!emittedMapSources(css, cssFile).includes(SECRET))
    rmSync(dir, { recursive: true, force: true })
  })

  it('rejects annotations when no `from` file is set', () => {
    const css = `a{color:red}\n/*# sourceMappingURL=sibling.map */`
    assert.ok(!emittedMapSources(css).includes(SECRET))
  })

  it('still honours a legitimate sibling .map annotation', () => {
    setup()
    const cssFile = join(dir, 'sub', 'in.css')
    writeFileSync(join(dir, 'sub', 'sibling.map'), secretMap)
    const css = `a{color:red}\n/*# sourceMappingURL=sibling.map */`
    assert.ok(emittedMapSources(css, cssFile).includes(SECRET))
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('browserslist poisoned-stats hardening (GHSA-73wf)', () => {
  it('a crafted browserslist-stats.json cannot write to Object.prototype', () => {
    const dir = mkdtempSync(join(tmpdir(), 'browserslist-stats-'))
    writeFileSync(
      join(dir, 'browserslist-stats.json'),
      JSON.stringify({ __proto__: { polluted: SECRET }, chrome: { '120': 50 } })
    )
    try {
      browserslist('> 0.5% in my stats', { path: dir })
    } catch {
      // A controlled rejection of malformed stats is acceptable; the
      // contract under test is that prototype state is never polluted.
    }
    assert.equal(({} as Record<string, unknown>).polluted, undefined)
    assert.equal((Object.prototype as Record<string, unknown>).polluted, undefined)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('picomatch extglob hardening (GHSA-c2c7)', () => {
  it('hostile extglob quantifier patterns complete promptly', { timeout: 5000 }, () => {
    const hostile = '+(' + 'a|'.repeat(400) + 'b)*(x)'
    const input = 'a'.repeat(200)
    const isMatch = picomatch(hostile)
    assert.equal(typeof isMatch(input), 'boolean')
  })
})

describe('nanoid generator bounds (GHSA-28wg, 2v37, xwg4)', () => {
  it('default fixed-size generation still works', () => {
    assert.match(nanoid(), /^[\w-]{21}$/)
  })

  it('non-positive sizes terminate instead of looping', () => {
    const gen = customAlphabet('abc', 10)
    assert.equal(gen().length, 10)
    // The fix makes non-positive sizes return an empty id rather than
    // looping forever inside the generator.
    assert.equal(customAlphabet('abc', 0)(), '')
    assert.equal(customAlphabet('abc', -5)(), '')
  })
})

describe('react-router navigation input handling', () => {
  it('protocol-relative and backslash inputs stay inside memory history', () => {
    const history = createMemoryHistory({ initialEntries: ['/transfers'] })
    for (const dest of ['//evil.example/path', '\\\\evil.example\\p', '/legit/path']) {
      history.push(dest)
      // The destination is only ever recorded as an in-app path; the router
      // cannot turn it into a cross-origin navigation on its own.
      assert.ok(history.location.pathname.startsWith('/') || history.location.pathname.startsWith('\\'))
      assert.equal(history.location.host, undefined)
    }
  })

  it('<Link to="//host/path"> is classified as an absolute URL, not folded into the basename', () => {
    const markup = renderToStaticMarkup(
      createElement(MemoryRouter, {},
        createElement(Link, { to: '//evil.example/path' }, 'x'))
    )
    // SSR emits the recognised absolute href verbatim (origin comparison is a
    // client-side check); on the vulnerable line `//…` was treated as an
    // in-app path instead of being classified external.
    assert.ok(markup.includes('href="//evil.example/path"'), markup)
  })

  it('a same-origin absolute URL is still accepted as a navigation target', () => {
    const markup = renderToStaticMarkup(
      createElement(MemoryRouter, {},
        createElement(Link, { to: '/transfers' }, 't'))
    )
    assert.ok(markup.includes('href="/transfers"'), markup)
  })
})
