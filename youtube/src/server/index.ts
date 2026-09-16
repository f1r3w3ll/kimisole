import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { getVouchers, saveVouchers, createVouchers, redeemVoucher, getUsage, saveUsage, getConfig, getRegionConfig, saveConfig, canUseFree, incrementFreeDownloads, consumeCredit, incrementPaidDownloads, getBalance, addCredits } from './credits'
import { requestEmailCode, verifyEmailCode, getSessionEmail, logoutSession } from './auth'
import { startWhatsAppBot, getWhatsAppStatus, requestNewPairingCode } from './whatsapp'
import QRCode from 'qrcode'

type Job = { id: string; status: string; events: object[]; clients: express.Response[]; process?: ReturnType<typeof spawn>; file?: string; error?: string; mode?: 'inspect' | 'free' | 'server'; email?: string; refunded?: boolean }
const app = express()
const port = Number(process.env.PORT ?? 8787)
const root = path.resolve(process.cwd())
const downloads = path.join(root, 'storage', 'downloads')
fs.mkdirSync(downloads, { recursive: true })
const jobs = new Map<string, Job>()
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'admin'
const FREE_DAILY_LIMIT = Number(process.env.FREE_DAILY_LIMIT ?? 3)

app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5180', 'http://127.0.0.1:5180'] }))
app.use(express.json({ limit: '1mb' }))

function getClientIp(req: express.Request): string {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim()
  if (Array.isArray(forwarded)) return forwarded[0].trim()
  return req.socket.remoteAddress ?? 'unknown'
}

function emit(job: Job, event: object) { job.events.push(event); for (const client of job.clients) client.write(`data: ${JSON.stringify(event)}\n\n`) }

function runWorker(job: Job, payload: object) {
  const python = process.env.PYTHON_BIN ?? 'python'
  console.log(`[worker ${job.id}] spawning: ${python} ${path.join(root, 'python', 'worker.py')} in ${root}`)
  job.status = 'running'; emit(job, { type: 'status', status: 'running' })
  const child = spawn(python, [path.join(root, 'python', 'worker.py')], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] })
  job.process = child
  child.stdout.setEncoding('utf8')
  let buffer = ''
  child.stdout.on('data', (chunk: string) => { buffer += chunk; const lines = buffer.split(/\r?\n/); buffer = lines.pop() ?? ''; for (const line of lines) { if (!line.trim()) continue; try { const event = JSON.parse(line); emit(job, event); if (event.type === 'finished') { job.status = 'completed'; job.file = event.file } if (event.type === 'error') { job.status = 'failed'; job.error = event.message } } catch { emit(job, { type: 'log', message: line }) } } })
  child.stderr.on('data', (chunk: Buffer) => { const text = chunk.toString().trim(); console.error(`[worker ${job.id}] stderr:`, text); emit(job, { type: 'log', message: text }) })
  child.on('error', (error) => { console.error(`[worker ${job.id}] spawn error:`, error); job.status = 'failed'; job.error = error.message; emit(job, { type: 'error', message: `Python indisponível: ${error.message}` }) })
  child.on('close', (code) => { console.log(`[worker ${job.id}] exited with code ${code}`); if (job.status === 'running') { job.status = code === 0 ? 'completed' : 'failed'; emit(job, { type: 'status', status: job.status, code }) } for (const client of job.clients) client.end(); job.clients = [] })
  child.stdin.write(`${JSON.stringify(payload)}\n`); child.stdin.end()
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const auth = req.headers.authorization
  if (auth !== `Bearer ${ADMIN_PASSWORD}`) return res.status(401).json({ error: 'Não autorizado.' })
  next()
}

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Não autenticado.' })
  const token = auth.slice('Bearer '.length)
  const email = getSessionEmail(token)
  if (!email) return res.status(401).json({ error: 'Sessão inválida ou expirada.' })
  res.locals.email = email
  res.locals.token = token
  next()
}

function getRegionFromRequest(req: express.Request): 'BR' | 'default' {
  const query = req.query.region
  if (query === 'BR' || query === 'default') return query
  const accept = req.headers['accept-language'] || ''
  if (/\bpt-?BR\b/i.test(accept) || accept.toLowerCase().startsWith('pt')) return 'BR'
  return 'default'
}

// Public config
app.get('/api/health', (_req, res) => res.json({ ok: true, python: process.env.PYTHON_BIN ?? 'python', downloads }))
app.get('/api/config', (req, res) => {
  const region = getRegionFromRequest(req)
  const cfg = getRegionConfig(region)
  res.json({
    region,
    currency: cfg.currency,
    symbol: cfg.symbol,
    creditPrice: cfg.creditPrice,
    whatsapp: cfg.whatsapp,
    donations: cfg.donations.filter((d) => d.active && (!d.region || d.region === region || d.region === 'all'))
  })
})

// Media inspection
app.post('/api/media/inspect', (req, res) => {
  const { url } = req.body ?? {}
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Informe uma URL HTTP/HTTPS válida.' })
  const job: Job = { id: randomUUID(), status: 'queued', events: [], clients: [], mode: 'inspect' }
  jobs.set(job.id, job)
  runWorker(job, { action: 'inspect', url })
  res.status(202).json({ id: job.id })
})

// Free download (local)
app.post('/api/media/jobs', (req, res) => {
  const { url, format, audio = false } = req.body ?? {}
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Informe uma URL HTTP/HTTPS válida.' })
  const ip = getClientIp(req)
  if (!canUseFree(ip, FREE_DAILY_LIMIT)) return res.status(429).json({ error: `Limite diário de ${FREE_DAILY_LIMIT} downloads grátis atingido. Compre créditos para continuar.` })
  incrementFreeDownloads(ip)
  const job: Job = { id: randomUUID(), status: 'queued', events: [], clients: [], mode: 'free' }
  jobs.set(job.id, job)
  runWorker(job, { action: 'download', url, format, audio, output: path.join(downloads, `${job.id}-%(title)s.%(ext)s`) })
  res.status(202).json({ id: job.id, mode: 'free' })
})

// Paid download (server)
app.post('/api/media/jobs/server', requireAuth, (req, res) => {
  const { url, format, audio = false } = req.body ?? {}
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Informe uma URL HTTP/HTTPS válida.' })
  const result = consumeCredit(res.locals.email)
  if (!result.ok) return res.status(402).json({ error: result.error, balance: result.balance })
  incrementPaidDownloads(getClientIp(req))
  const job: Job = { id: randomUUID(), status: 'queued', events: [], clients: [], mode: 'server', email: res.locals.email }
  jobs.set(job.id, job)
  runWorker(job, { action: 'download', url, format, audio, output: path.join(downloads, `${job.id}-%(title)s.%(ext)s`) })
  res.status(202).json({ id: job.id, mode: 'server', balance: result.balance })
})

app.get('/api/media/jobs/:id', (req, res) => { const job = jobs.get(req.params.id); if (!job) return res.status(404).json({ error: 'Job não encontrado.' }); res.json({ id: job.id, status: job.status, events: job.events, file: job.file, error: job.error }) })
app.get('/api/media/jobs/:id/events', (req, res) => { const job = jobs.get(req.params.id); if (!job) return res.status(404).end(); res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive'); for (const event of job.events) res.write(`data: ${JSON.stringify(event)}\n\n`); job.clients.push(res); req.on('close', () => { job.clients = job.clients.filter((client) => client !== res) }) })
app.delete('/api/media/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id)
  if (!job) return res.status(404).end()
  const wasActive = job.status === 'queued' || job.status === 'running'
  if (wasActive && job.mode === 'server' && job.email && !job.refunded) {
    job.refunded = true
    const refundedBalance = addCredits(job.email, 1)
    emit(job, { type: 'status', status: 'cancelled', refunded: true, balance: refundedBalance })
    console.log(`[worker ${job.id}] download pago cancelado — 1 crédito devolvido para ${job.email}`)
  }
  const pid = job.process?.pid
  if (pid) {
    try {
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
      killer.on('error', () => { try { job.process?.kill() } catch { /* ignore */ } })
    } catch {
      try { job.process?.kill() } catch { /* ignore */ }
    }
  } else {
    try { job.process?.kill() } catch { /* ignore */ }
  }
  job.status = 'cancelled'
  emit(job, { type: 'status', status: 'cancelled' })
  res.json({ ok: true, status: 'cancelled' })
})

// Auth (e-mail com código de confirmação)
app.post('/api/auth/request-code', async (req, res) => {
  const { email } = req.body ?? {}
  if (typeof email !== 'string') return res.status(400).json({ error: 'Informe o e-mail.' })
  const result = await requestEmailCode(email)
  if (!result.ok) return res.status(400).json({ error: result.error })
  res.json({ ok: true, devCode: result.devCode })
})

app.post('/api/auth/verify-code', (req, res) => {
  const { email, code } = req.body ?? {}
  if (typeof email !== 'string' || typeof code !== 'string') return res.status(400).json({ error: 'Informe o e-mail e o código.' })
  const result = verifyEmailCode(email, code)
  if (!result.ok) return res.status(400).json({ error: result.error })
  res.json({ token: result.token, email: result.email })
})

app.get('/api/auth/me', requireAuth, (_req, res) => {
  res.json({ email: res.locals.email })
})

app.post('/api/auth/logout', requireAuth, (_req, res) => {
  logoutSession(res.locals.token)
  res.json({ ok: true })
})

// Credits
app.get('/api/credits/balance', requireAuth, (_req, res) => {
  res.json({ balance: getBalance(res.locals.email) })
})

app.post('/api/credits/redeem', requireAuth, (req, res) => {
  const { code } = req.body ?? {}
  if (typeof code !== 'string') return res.status(400).json({ error: 'Informe o código do voucher.' })
  const result = redeemVoucher(code, res.locals.email)
  if (!result.ok) return res.status(400).json({ error: result.error })
  res.json({ credits: result.credits, balance: result.balance })
})

// Admin
app.post('/api/admin/vouchers', requireAdmin, (req, res) => {
  const { amount = 1, credits = 1 } = req.body ?? {}
  const created = createVouchers(Number(amount), Number(credits))
  res.json({ vouchers: created })
})

app.get('/api/admin/vouchers', requireAdmin, (_req, res) => {
  res.json({ vouchers: getVouchers() })
})

app.post('/api/admin/config', requireAdmin, (req, res) => {
  const config = getConfig()
  const { regions, exchangeRate, creditPrice, whatsapp, donations } = req.body ?? {}
  if (exchangeRate !== undefined) config.exchangeRate = Number(exchangeRate)
  if (regions && typeof regions === 'object') {
    config.regions = { ...config.regions, ...regions }
  }
  // Legacy admin update support: update BR region when flat fields are sent
  if (creditPrice !== undefined || whatsapp !== undefined || donations !== undefined) {
    if (!config.regions) config.regions = {
      BR: { currency: 'BRL', symbol: 'R$', creditPrice: 1.3, donations: [] },
      default: { currency: 'USD', symbol: 'US$', creditPrice: 0.25, donations: [] }
    }
    if (!config.regions.BR) config.regions.BR = { currency: 'BRL', symbol: 'R$', creditPrice: 1.3, donations: [] }
    if (!config.regions.default) config.regions.default = { currency: 'USD', symbol: 'US$', creditPrice: 0.25, donations: [] }
    if (creditPrice !== undefined) config.regions.BR.creditPrice = Number(creditPrice)
    if (whatsapp !== undefined) config.regions.BR.whatsapp = String(whatsapp)
    if (Array.isArray(donations)) config.regions.BR.donations = donations
  }
  saveConfig(config)
  res.json({ ok: true })
})

app.get('/api/admin/stats', requireAdmin, (_req, res) => {
  res.json({ usage: getUsage(), vouchers: getVouchers().length })
})

app.post('/api/admin/refresh-cookies', requireAdmin, (_req, res) => {
  const python = process.env.PYTHON_BIN ?? 'python'
  const child = spawn(python, [path.join(root, 'python', 'youtube_auth.py')], { cwd: root, env: process.env })
  let output = ''
  let errorOutput = ''
  child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
  child.stderr.on('data', (chunk: Buffer) => { errorOutput += chunk.toString() })
  child.on('close', (code) => {
    const cookiesPath = path.join(root, 'cookies.txt')
    const exists = fs.existsSync(cookiesPath)
    const size = exists ? fs.statSync(cookiesPath).size : 0
    if (code !== 0) {
      return res.status(500).json({ ok: false, output, error: errorOutput || 'Falha ao atualizar cookies. Verifique YOUTUBE_EMAIL e YOUTUBE_PASSWORD no .env.' })
    }
    res.json({ ok: true, output, cookiesPath, size })
  })
})

app.get('/api/admin/cookies-status', requireAdmin, (_req, res) => {
  const cookiesPath = path.join(root, 'cookies.txt')
  const exists = fs.existsSync(cookiesPath)
  const size = exists ? fs.statSync(cookiesPath).size : 0
  res.json({ exists, size, active: exists && size > 256 })
})

app.get('/api/admin/whatsapp/status', requireAdmin, (_req, res) => {
  res.json(getWhatsAppStatus())
})

app.post('/api/admin/whatsapp/pair', requireAdmin, async (_req, res) => {
  const result = await requestNewPairingCode()
  if (!result.ok) return res.status(400).json({ error: result.error })
  res.json({ ok: true, pairingCode: result.code })
})

app.get('/api/admin/whatsapp/qr', requireAdmin, async (_req, res) => {
  const status = getWhatsAppStatus()
  if (!status.qr) return res.status(404).json({ error: 'QR Code ainda não disponível. Aguarde a conexão com o WhatsApp.' })
  const image = await QRCode.toDataURL(status.qr, { margin: 1, width: 520 })
  res.json({ qr: status.qr, image, connected: status.connected })
})

app.get('/whatsapp-qr', (_req, res) => {
  res.send(`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>SaveTube — Pareamento WhatsApp</title>
<style>
  body { background: #0f0f0f; color: #f1f1f1; font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  .card { background: #181818; border-radius: 16px; padding: 28px; text-align: center; max-width: 560px; width: 100%; }
  h1 { font-size: 20px; margin: 0 0 8px; }
  p { color: #aaa; font-size: 14px; }
  input { width: 100%; box-sizing: border-box; padding: 10px; border-radius: 8px; border: 1px solid #333; background: #0f0f0f; color: #f1f1f1; margin: 8px 0; }
  button { background: #25d366; border: none; color: #062; font-weight: 700; padding: 10px 18px; border-radius: 8px; cursor: pointer; }
  img { width: 320px; height: 320px; image-rendering: pixelated; margin: 16px auto; display: block; border-radius: 8px; background: white; }
  .status { font-size: 13px; color: #aaa; margin-top: 8px; }
  .error { color: #f88; }
</style>
</head>
<body>
  <div class="card">
    <h1>Pareamento do bot WhatsApp</h1>
    <p>1. No celular: WhatsApp → Aparelhos conectados → Conectar aparelho.</p>
    <p>2. Escaneie o QR Code abaixo.</p>
    <div id="login">
      <input id="password" type="password" placeholder="Senha do admin" />
      <button onclick="start()">Ver QR Code</button>
    </div>
    <div id="qrbox" style="display:none">
      <img id="qr" alt="QR Code" />
      <div class="status" id="status">Aguardando QR…</div>
    </div>
    <div class="status" id="error"></div>
  </div>
<script>
  let token = '';
  function start() {
    token = document.getElementById('password').value;
    document.getElementById('login').style.display = 'none';
    document.getElementById('qrbox').style.display = 'block';
    poll();
    setInterval(poll, 5000);
  }
  async function poll() {
    try {
      const r = await fetch('/api/admin/whatsapp/qr', { headers: { authorization: 'Bearer ' + token } });
      const data = await r.json();
      if (!r.ok) {
        document.getElementById('status').textContent = data.error || 'QR indisponível';
        document.getElementById('qr').style.display = 'none';
        return;
      }
      document.getElementById('qr').style.display = 'block';
      document.getElementById('qr').src = data.image;
      document.getElementById('status').textContent = data.connected ? '✅ Conectado!' : 'Escaneie o QR Code no WhatsApp. Atualiza a cada 5s.';
    } catch (e) {
      document.getElementById('status').textContent = 'Erro ao buscar QR. Verifique se o backend está rodando.';
    }
  }
</script>
</body>
</html>`)
})

app.use('/downloads', express.static(downloads))

// Em produção, serve o frontend buildado (dist/) na mesma porta.
const distDir = path.join(root, 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir, {
    setHeaders(res, filePath) {
      // Assets do Vite têm hash no nome — podem ser cacheados para sempre.
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      } else {
        res.setHeader('Cache-Control', 'no-cache')
      }
    }
  }))

  // Páginas SEO estáticas com URLs limpas
  const seoPages: Record<string, string> = {
    '/youtube-para-mp3': 'youtube-para-mp3.html',
    '/youtube-para-mp4': 'youtube-para-mp4.html',
    '/baixar-video-do-youtube': 'baixar-video-do-youtube.html',
    '/youtube-downloader': 'youtube-downloader.html',
    '/descargar-videos-de-youtube': 'descargar-videos-de-youtube.html',
    '/youtube-to-mp3': 'youtube-to-mp3.html',
    '/youtube-to-mp4': 'youtube-to-mp4.html',
    '/youtube-a-mp3': 'youtube-a-mp3.html',
    '/youtube-a-mp4': 'youtube-a-mp4.html',
  }
  for (const [route, file] of Object.entries(seoPages)) {
    app.get(route, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache')
      res.sendFile(path.join(distDir, file))
    })
  }

  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/downloads') && !req.path.startsWith('/whatsapp-qr')) {
      res.setHeader('Cache-Control', 'no-cache')
      return res.sendFile(path.join(distDir, 'index.html'))
    }
    next()
  })
}

const host = process.env.HOST ?? '127.0.0.1'
app.listen(port, host, () => {
  console.log(`SaveTube backend: http://${host}:${port}`)
  startWhatsAppBot().catch((error) => console.error('[whatsapp] falha ao iniciar:', error))
})
