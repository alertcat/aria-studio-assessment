import { tenantCookie, validateProviderKey, keyFromRequest, providerBalance, PILOT, tenantIdFor } from '@/lib/tenant'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Pilot login: the customer's render API key is the account. It arrives in
// the Authorization header, is checked against the render provider, and is not kept: the
// cookie only carries a signed tenant id.
export async function POST(req: Request) {
  if (!PILOT) return Response.json({ ok: true, demo: true })
  const key = keyFromRequest(req)
  if (!key || !(await validateProviderKey(key))) {
    return Response.json({ error: 'invalid key' }, { status: 401 })
  }
  const id = tenantIdFor(key)
  const balance = await providerBalance(key)
  return new Response(JSON.stringify({ ok: true, tenant: id, balance }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': tenantCookie(id) },
  })
}
