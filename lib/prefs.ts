// The theme and language the studio starts with. Shared by the browser and the
// tests, so it has no node imports and takes its environment as an argument.

export type Theme = 'dark' | 'light'
export type StartLang = 'en' | 'zh'

/** The part of `window` this needs. The real `window` fits, and so does a fake in a test. */
export type StudioEnv = {
  location: { hash: string; search: string }
  localStorage: { getItem(key: string): string | null }
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
 * choice counts. Without either, the studio is dark and English: the system colour
 * scheme and the browser language are not consulted, so every first visit looks the
 * same.
 */
export function startPrefs(env: StudioEnv): StartPrefs {
  const hash = new URLSearchParams(env.location.hash.replace(/^#/, ''))
  const query = new URLSearchParams(env.location.search)

  const wanted = hash.get('theme') || query.get('theme') || read(() => env.localStorage.getItem('aria_theme'))
  const theme: Theme = wanted === 'light' ? 'light' : 'dark'

  const fromUrl = (hash.get('lang') || query.get('lang') || '').toLowerCase()
  const saved = read(() => env.localStorage.getItem('aria_lang')).toLowerCase()
  const pick = fromUrl.startsWith('zh') || fromUrl === 'en' ? fromUrl : saved
  const langChosen = pick.startsWith('zh') || pick === 'en'

  return { theme, lang: pick.startsWith('zh') ? 'zh' : 'en', langChosen }
}
