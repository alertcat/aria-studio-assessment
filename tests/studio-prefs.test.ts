import { describe, expect, it, vi } from 'vitest'
import { startPrefs } from '@/lib/prefs'

// What the studio looks like when a visitor opens it for the first time: dark and
// English. The system colour scheme and the browser language do not decide that.
// A link can pin both, and a choice the visitor made earlier is kept.

/** A stand-in for `window`: a visitor whose system is light and whose browser is Chinese. */
function visitor(opts: { hash?: string; search?: string; saved?: Record<string, string>; blockedStorage?: boolean } = {}) {
  const matchMedia = vi.fn((query: string) => ({ matches: query.includes('light') }))
  return {
    location: { hash: opts.hash ?? '', search: opts.search ?? '' },
    localStorage: {
      getItem(key: string): string | null {
        if (opts.blockedStorage) throw new Error('storage is blocked')
        return opts.saved?.[key] ?? null
      },
    },
    navigator: { language: 'zh-CN' },
    matchMedia,
  }
}

describe('how the studio starts', () => {
  it('is dark and English for a first visit, whatever the system and the browser prefer', () => {
    const env = visitor()
    expect(startPrefs(env)).toEqual({ theme: 'dark', lang: 'en', langChosen: false })
    expect(env.matchMedia).not.toHaveBeenCalled()
  })

  it('keeps the theme and language the visitor chose earlier', () => {
    expect(startPrefs(visitor({ saved: { aria_theme: 'light', aria_lang: 'zh' } }))).toEqual({
      theme: 'light',
      lang: 'zh',
      langChosen: true,
    })
    expect(startPrefs(visitor({ saved: { aria_theme: 'dark', aria_lang: 'en' } }))).toEqual({
      theme: 'dark',
      lang: 'en',
      langChosen: true,
    })
  })

  it.each([
    ['#theme=light&lang=zh', '', { theme: 'light', lang: 'zh', langChosen: true }],
    ['', '?theme=light&lang=zh-CN', { theme: 'light', lang: 'zh', langChosen: true }],
    ['#theme=dark&lang=en', '', { theme: 'dark', lang: 'en', langChosen: true }],
  ])('lets a link pin both: hash %j, query %j', (hash, search, expected) => {
    // the saved choice says the opposite, and the link wins
    const saved = { aria_theme: expected.theme === 'light' ? 'dark' : 'light', aria_lang: expected.lang === 'zh' ? 'en' : 'zh' }
    expect(startPrefs(visitor({ hash, search, saved }))).toEqual(expected)
  })

  it('ignores values it does not know and falls back to dark and English', () => {
    expect(startPrefs(visitor({ search: '?theme=blue&lang=fr' }))).toEqual({ theme: 'dark', lang: 'en', langChosen: false })
    expect(startPrefs(visitor({ saved: { aria_theme: 'neon', aria_lang: 'de' } }))).toEqual({ theme: 'dark', lang: 'en', langChosen: false })
  })

  it('is dark and English when storage is blocked, and a link still works', () => {
    expect(startPrefs(visitor({ blockedStorage: true }))).toEqual({ theme: 'dark', lang: 'en', langChosen: false })
    expect(startPrefs(visitor({ blockedStorage: true, hash: '#theme=light' })).theme).toBe('light')
  })
})
