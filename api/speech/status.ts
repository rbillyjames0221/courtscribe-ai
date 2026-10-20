/**
 * GET /api/speech/status — reports which server-side speech providers are configured.
 * Never returns secrets. Runs as a Vercel Function.
 */
export function GET(): Response {
  const azure = Boolean(process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION)
  const google = Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || process.env.GOOGLE_STT_PROJECT_ID)
  const streaming = Boolean(process.env.STREAMING_SERVICE_URL)
  return Response.json(
    {
      ok: true,
      providers: { azure, google, streamingService: streaming },
      note: 'Credentials live only in Vercel environment variables. The web app never receives provider keys.',
    },
    { headers: { 'cache-control': 'no-store' } },
  )
}
