// Provider endpoints come from the environment. There are no defaults: an unset
// base means that capability is not configured and the call fails with a clear error.

function need(name: string): string {
  const v = (process.env[name] || '').replace(/\/+$/, '')
  if (!v) throw new Error(`${name} is not set`)
  return v
}

/** Root of the render provider's OpenAI-style API (video, image, model list, billing), without /v1. */
export const renderBase = () => need('RENDER_API_BASE')

/** Root of the provider's asset library, used to register virtual talent portraits. */
export const assetBase = () => need('RENDER_ASSET_BASE')
