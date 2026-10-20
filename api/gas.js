import crypto from 'node:crypto'

const allowedActions = new Set([
  'health', 'login', 'register', 'logout', 'listTests', 'getTest', 'startAttempt',
  'saveResponse', 'submitAttempt', 'listStudents', 'listResults', 'saveTest',
  'publishTest', 'unpublishTest', 'getDashboard'
])

function json(status, body) {
  return { status, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) }
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ success: false, error: 'POST is required.' })
  const gasUrl = process.env.GAS_URL
  if (!gasUrl) return response.status(503).json({ success: false, error: 'The Google Apps Script service is not configured. Set GAS_URL in Vercel project settings.' })

  let payload
  try {
    payload = typeof request.body === 'string' ? JSON.parse(request.body) : request.body
  } catch {
    return response.status(400).json({ success: false, error: 'Request body must be valid JSON.' })
  }
  if (!payload || typeof payload.action !== 'string' || !allowedActions.has(payload.action)) {
    return response.status(400).json({ success: false, error: 'Unsupported backend action.' })
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  try {
    const upstream = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Request-Id': crypto.randomUUID() },
      body: JSON.stringify({ ...payload, gatewaySecret: process.env.BACKEND_SECRET }),
      signal: controller.signal,
      redirect: 'follow'
    })
    const text = await upstream.text()
    let data
    try { data = JSON.parse(text) } catch { return response.status(502).json({ success: false, error: 'The Apps Script service returned malformed JSON.' }) }
    return response.status(upstream.ok ? 200 : 502).json(data)
  } catch (error) {
    const message = error?.name === 'AbortError' ? 'The Apps Script service timed out.' : 'The Apps Script service is unavailable.'
    return response.status(504).json({ success: false, error: message })
  } finally {
    clearTimeout(timeout)
  }
}
