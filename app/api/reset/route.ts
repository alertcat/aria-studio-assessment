import { storeForRequest, unauthorized, readOnlyDemo } from '@/lib/ctx'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const readOnly = readOnlyDemo()
  if (readOnly) return readOnly
  const st = storeForRequest(req)
  if (!st) return unauthorized()
  st.resetCompany()
  return Response.json({ ok: true })
}
