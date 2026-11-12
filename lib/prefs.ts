// The theme and language the studio starts with. Shared by the browser and the
// tests, so it has no node imports and takes its environment as an argument.

export type Theme = 'dark' | 'light'
export type StartLang = 'en' | 'zh'

/** The part of `window` this needs. The real `window` fits, and so does a fake in a test. */
export type StudioEnv = {
  location: { hash: string; search: string }
  localStorage: { getItem(key: string): string | null }
  matchMedia(query: string): { matches: boolean }
}

export type StartPrefs = {
  theme: Theme
  lang: StartLang
  /** true when a link or a saved choice set the language, false when it is the default */
  langChosen: boolean
}

function read(fn: () => string | null | undefined): string {
  try {
    return fn() ?? ''
  } catch {
    return '' // storage can be blocked, for example in a private window
  }
}

/**
 * A link can pin both (#theme=, ?theme=, #lang=, ?lang=). Then the visitor's saved
 * choice counts. Without either, the theme follows the system setting and the
 * language is English.
 */
export function startPrefs(env: StudioEnv): StartPrefs {
  const hash = new URLSearchParams(env.location.hash.replace(/^#/, ''))
  const query = new URLSearchParams(env.location.search)

  let theme = hash.get('theme') || query.get('theme') || read(() => env.localStorage.getItem('aria_theme'))
  if (theme !== 'light' && theme !== 'dark') {
    theme = read(() => (env.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')) || 'dark'
  }

  const fromUrl = (hash.get('lang') || query.get('lang') || '').toLowerCase()
  const saved = read(() => env.localStorage.getItem('aria_lang')).toLowerCase()
  const pick = fromUrl.startsWith('zh') || fromUrl === 'en' ? fromUrl : saved
  const langChosen = pick.startsWith('zh') || pick === 'en'

  return { theme: theme as Theme, lang: pick.startsWith('zh') ? 'zh' : 'en', langChosen }
}
