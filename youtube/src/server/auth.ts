import fs from 'node:fs'
import path from 'node:path'
import { randomBytes, randomInt } from 'node:crypto'
import nodemailer from 'nodemailer'

const DATA_DIR = path.join(process.cwd(), 'data')
fs.mkdirSync(DATA_DIR, { recursive: true })

const USERS_FILE = path.join(DATA_DIR, 'users.json')
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json')
const CODES_FILE = path.join(DATA_DIR, 'pending_codes.json')

type User = { email: string; createdAt: string; lastLoginAt: string }
type Session = { email: string; createdAt: string; expiresAt: string }
type PendingCode = { code: string; expiresAt: string; attempts: number }

const CODE_TTL_MS = 10 * 60 * 1000
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const MAX_ATTEMPTS = 5

function readJson<T>(file: string, fallback: T): T {
  try {
    if (!fs.existsSync(file)) return fallback
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

function writeJson<T>(file: string, data: T) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

function getUsers(): Record<string, User> { return readJson<Record<string, User>>(USERS_FILE, {}) }
function saveUsers(users: Record<string, User>) { writeJson(USERS_FILE, users) }
function getSessions(): Record<string, Session> { return readJson<Record<string, Session>>(SESSIONS_FILE, {}) }
function saveSessions(sessions: Record<string, Session>) { writeJson(SESSIONS_FILE, sessions) }
function getPendingCodes(): Record<string, PendingCode> { return readJson<Record<string, PendingCode>>(CODES_FILE, {}) }
function savePendingCodes(codes: Record<string, PendingCode>) { writeJson(CODES_FILE, codes) }

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)
}

function canSendEmail(): boolean {
  return Boolean(process.env.SMTP_HOST)
}

async function sendCodeByEmail(email: string, code: string) {
  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT ?? 587)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  const from = process.env.SMTP_FROM ?? user ?? 'no-reply@savetube.app'

  const transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: user && pass ? { user, pass } : undefined })
  await transporter.sendMail({
    from,
    to: email,
    subject: 'Seu código de acesso SaveTube',
    text: `Seu código de acesso SaveTube é: ${code}\n\nEle expira em 10 minutos. Se você não solicitou, ignore este e-mail.`
  })
}

export async function requestEmailCode(email: string): Promise<{ ok: true; devCode?: string } | { ok: false; error: string }> {
  const normalized = normalizeEmail(email)
  if (!isValidEmail(normalized)) return { ok: false, error: 'E-mail inválido.' }

  const code = String(randomInt(0, 1000000)).padStart(6, '0')
  const codes = getPendingCodes()
  codes[normalized] = { code, expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString(), attempts: 0 }
  savePendingCodes(codes)

  if (canSendEmail()) {
    try {
      await sendCodeByEmail(normalized, code)
      return { ok: true }
    } catch (error) {
      console.error('[auth] falha ao enviar e-mail:', error)
      return { ok: false, error: 'Não foi possível enviar o e-mail. Verifique a configuração de SMTP.' }
    }
  }

  // Modo desenvolvimento: sem SMTP configurado, retorna o código para facilitar testes.
  console.log(`[auth] código de acesso para ${normalized}: ${code}`)
  return { ok: true, devCode: code }
}

export function verifyEmailCode(email: string, code: string): { ok: true; token: string; email: string } | { ok: false; error: string } {
  const normalized = normalizeEmail(email)
  const codes = getPendingCodes()
  const pending = codes[normalized]
  if (!pending) return { ok: false, error: 'Nenhum código solicitado para este e-mail. Clique em "Enviar código" primeiro.' }
  if (pending.expiresAt && Date.now() > new Date(pending.expiresAt).getTime()) {
    delete codes[normalized]
    savePendingCodes(codes)
    return { ok: false, error: 'Código expirado. Solicite um novo.' }
  }
  pending.attempts += 1
  if (pending.attempts > MAX_ATTEMPTS) {
    delete codes[normalized]
    savePendingCodes(codes)
    return { ok: false, error: 'Muitas tentativas. Solicite um novo código.' }
  }
  if (pending.code !== code.trim()) {
    savePendingCodes(codes)
    return { ok: false, error: 'Código incorreto.' }
  }

  delete codes[normalized]
  savePendingCodes(codes)

  const users = getUsers()
  const now = new Date().toISOString()
  users[normalized] = { email: normalized, createdAt: users[normalized]?.createdAt ?? now, lastLoginAt: now }
  saveUsers(users)

  const token = randomBytes(32).toString('hex')
  const sessions = getSessions()
  sessions[token] = { email: normalized, createdAt: now, expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString() }
  saveSessions(sessions)

  return { ok: true, token, email: normalized }
}

export function getSessionEmail(token: string): string | null {
  const sessions = getSessions()
  const session = sessions[token]
  if (!session) return null
  if (Date.now() > new Date(session.expiresAt).getTime()) {
    delete sessions[token]
    saveSessions(sessions)
    return null
  }
  return session.email
}

export function logoutSession(token: string) {
  const sessions = getSessions()
  delete sessions[token]
  saveSessions(sessions)
}
