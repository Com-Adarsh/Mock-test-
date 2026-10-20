import crypto from 'node:crypto'

const PASSWORD_HASH_ITERATIONS = 600000
const allowedActions = new Set([
  'health', 'register', 'studentLogin', 'requestStudentActivation', 'activateStudent',
  'sessionInfo', 'modLogin', 'logout', 'listTests', 'getTest', 'getQuestions', 'startAttempt',
  'saveResponse', 'submitAttempt', 'myResults', 'listStudents', 'listResults', 'saveTest',
  'publishTest', 'unpublishTest', 'getDashboard', 'modSaveTest', 'modGetTests',
  'modDeleteTest', 'modPublishTest', 'modGetResults', 'modGetStudents'
])

const actionAliases = {
  health: 'health',
  getTest: 'getQuestions',
  listStudents: 'modGetStudents',
  listResults: 'modGetResults',
  saveTest: 'modSaveTest',
  publishTest: 'modPublishTest',
  unpublishTest: 'modPublishTest',
  getDashboard: 'health'
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

function passwordError(password, confirmation) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) {
    return 'Use a password between 12 and 256 characters.'
  }
  if (password !== confirmation) return 'Passwords do not match.'
  return ''
}

function isPasswordInput(password) {
  return typeof password === 'string' && password.length >= 12 && password.length <= 256
}

function createPasswordHash(password) {
  const salt = crypto.randomBytes(16)
  const derived = crypto.pbkdf2Sync(password, salt, PASSWORD_HASH_ITERATIONS, 32, 'sha256')
  return 'pbkdf2-sha256$' + PASSWORD_HASH_ITERATIONS + '$' + salt.toString('hex') + '$' + derived.toString('hex')
}

function verifyPassword(password, encodedHash) {
  const parts = String(encodedHash || '').split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256' ||
      parts[1] !== String(PASSWORD_HASH_ITERATIONS) ||
      !/^[0-9a-f]{32}$/i.test(parts[2]) || !/^[0-9a-f]{64}$/i.test(parts[3])) return false
  const actual = crypto.pbkdf2Sync(password, Buffer.from(parts[2], 'hex'), PASSWORD_HASH_ITERATIONS, 32, 'sha256')
  const expected = Buffer.from(parts[3], 'hex')
  return crypto.timingSafeEqual(actual, expected)
}

async function callAppsScript(gasUrl, secret, payload) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  try {
    const upstream = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Request-Id': crypto.randomUUID() },
      body: JSON.stringify({ ...payload, gatewaySecret: secret }),
      signal: controller.signal,
      redirect: 'follow'
    })
    const text = await upstream.text()
    let data
    try { data = JSON.parse(text) } catch { throw new Error('The Apps Script service returned malformed JSON.') }
    if (!upstream.ok) throw new Error('The Apps Script service rejected the request.')
    return data
  } finally {
    clearTimeout(timeout)
  }
}

function invalidCredentials(response, message) {
  return response.status(200).json({ success: false, message: message })
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ success: false, error: 'POST is required.' })
  const gasUrl = process.env.GAS_URL
  if (!gasUrl) return response.status(503).json({ success: false, error: 'The Google Apps Script service is not configured. Set GAS_URL in Vercel project settings.' })
  const backendSecret = process.env.BACKEND_SECRET
  if (!backendSecret) return response.status(503).json({ success: false, error: 'The private backend gateway is not configured. Set BACKEND_SECRET in Vercel project settings.' })

  let payload
  try {
    payload = typeof request.body === 'string' ? JSON.parse(request.body) : request.body
  } catch {
    return response.status(400).json({ success: false, error: 'Request body must be valid JSON.' })
  }
  if (!payload || typeof payload.action !== 'string' || !allowedActions.has(payload.action)) {
    return response.status(400).json({ success: false, error: 'Unsupported backend action.' })
  }

  try {
    if (payload.action === 'register' || payload.action === 'activateStudent') {
      const message = passwordError(payload.password, payload.confirmPassword)
      if (message) return response.status(400).json({ success: false, message: message })
      const passwordHash = createPasswordHash(payload.password)
      const upstreamPayload = { ...payload, passwordHash: passwordHash }
      delete upstreamPayload.password
      delete upstreamPayload.confirmPassword
      return response.status(200).json(await callAppsScript(gasUrl, backendSecret, upstreamPayload))
    }

    if (payload.action === 'studentLogin') {
      if (!isPasswordInput(payload.password)) {
        return invalidCredentials(response, 'Invalid roll number or password.')
      }
      const credentialResponse = await callAppsScript(gasUrl, backendSecret, {
        action: 'getStudentCredential',
        rollNumber: payload.rollNumber
      })
      const credential = credentialResponse && credentialResponse.credential
      if (!credential || !verifyPassword(String(payload.password || ''), credential.passwordHash)) {
        return invalidCredentials(response, 'Invalid roll number or password. Existing accounts without a password can be activated using the registered email.')
      }
      return response.status(200).json(await callAppsScript(gasUrl, backendSecret, {
        action: 'createStudentSession',
        rollNumber: credential.rollNumber
      }))
    }

    if (payload.action === 'modLogin') {
      if (!isPasswordInput(payload.password)) {
        return invalidCredentials(response, 'Invalid moderator credentials.')
      }
      const credentialResponse = await callAppsScript(gasUrl, backendSecret, { action: 'getModeratorCredential' })
      const credential = credentialResponse && credentialResponse.credential
      if (!credential || normalizeEmail(payload.email) !== normalizeEmail(credential.email) ||
          !verifyPassword(payload.password, credential.passwordHash)) {
        return invalidCredentials(response, 'Invalid moderator credentials.')
      }
      return response.status(200).json(await callAppsScript(gasUrl, backendSecret, {
        action: 'createModeratorSession'
      }))
    }

    const upstreamPayload = { ...payload, action: actionAliases[payload.action] || payload.action }
    delete upstreamPayload.gatewaySecret
    if (payload.sessionToken && !payload.token) upstreamPayload.token = payload.sessionToken
    delete upstreamPayload.sessionToken
    if (payload.action === 'unpublishTest') upstreamPayload.publish = false
    if (payload.action === 'publishTest') upstreamPayload.publish = true
    return response.status(200).json(await callAppsScript(gasUrl, backendSecret, upstreamPayload))
  } catch (error) {
    const message = error?.name === 'AbortError'
      ? 'The Apps Script service timed out.'
      : error?.message === 'The Apps Script service returned malformed JSON.'
        ? error.message
        : 'The Apps Script service is unavailable.'
    const status = error?.name === 'AbortError' ? 504 : 502
    return response.status(status).json({ success: false, error: message })
  }
}
