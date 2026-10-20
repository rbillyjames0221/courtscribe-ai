/**
 * POST /api/speech/token — server-side provider seam.
 *
 * Exchanges server-held credentials for a SHORT-LIVED, session-scoped token so the browser
 * (or the Cloud Run streaming service) can talk to the speech provider without ever seeing
 * the long-lived key.
 *
 *  - Azure Speech: set AZURE_SPEECH_KEY + AZURE_SPEECH_REGION. Returns a 10-minute STS token
 *    from https://{region}.api.cognitive.microsoft.com/sts/v1.0/issueToken.
 *  - Google Cloud STT: browsers cannot stream to Google directly with a short token; deploy the
 *    streaming relay (see /server/README.md) and set STREAMING_SERVICE_URL + STREAMING_SHARED_SECRET.
 *    This route then mints an HMAC-signed ticket the relay verifies.
 *
 * TODO before production: authenticate the caller (user session), rate-limit, audit-log.
 */
import { createHmac, randomUUID } from 'node:crypto'

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get('origin')
  const host = request.headers.get('host')
  if (origin && host && new URL(origin).host !== host) return Response.json({ error: 'forbidden_origin' }, { status: 403 })

  let language = 'en-PH'
  try {
    const body = (await request.json()) as { language?: string }
    if (body.language && /^(en-PH|fil-PH|mixed)$/.test(body.language)) language = body.language
  } catch {
    /* empty body is fine */
  }

  const relaySecret = process.env.STREAMING_SHARED_SECRET
  if (process.env.STREAMING_SERVICE_URL && relaySecret) {
    const exp = Math.floor(Date.now() / 1000) + 300
    const payload = Buffer.from(JSON.stringify({ sid: randomUUID(), lang: language, exp })).toString('base64url')
    const sig = createHmac('sha256', relaySecret).update(payload).digest('base64url')
    return Response.json({ provider: 'relay', token: `${payload}.${sig}`, expiresAt: exp }, { headers: { 'cache-control': 'no-store' } })
  }

  const key = process.env.AZURE_SPEECH_KEY
  const region = process.env.AZURE_SPEECH_REGION
  if (key && region) {
    const r = await fetch(`https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, { method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': key, 'content-length': '0' } })
    if (!r.ok) return Response.json({ error: 'provider_token_failed', status: r.status }, { status: 502 })
    return Response.json({ provider: 'azure', region, token: await r.text(), expiresInSec: 540 }, { headers: { 'cache-control': 'no-store' } })
  }

  return Response.json(
    { error: 'not_configured', message: 'No server-side speech provider is configured for this deployment. Browser (Web Speech API) recognition is used instead.' },
    { status: 501, headers: { 'cache-control': 'no-store' } },
  )
}
