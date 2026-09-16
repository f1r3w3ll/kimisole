import fs from 'node:fs'
import path from 'node:path'
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WAMessage,
  type WASocket
} from '@whiskeysockets/baileys'
import { createVouchers } from './credits'

export type WhatsAppStatus = {
  enabled: boolean
  connected: boolean
  qr?: string
  pairingCode?: string
  adminNumber?: string
  botNumber?: string
  lastError?: string
}

const status: WhatsAppStatus = {
  enabled: false,
  connected: false
}

let activeSock: WASocket | null = null
let activeBotNumber = ''

export function getWhatsAppStatus(): WhatsAppStatus {
  return { ...status }
}

export async function requestNewPairingCode(): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  if (!activeSock || !activeBotNumber) return { ok: false, error: 'Bot não está ativo. Configure WHATSAPP_ENABLED=true e WHATSAPP_PAIRING_NUMBER no .env.' }
  try {
    const code = await activeSock.requestPairingCode(activeBotNumber)
    setStatus({ pairingCode: code, lastError: undefined })
    console.log(`[whatsapp] novo código de pareamento: ${code}`)
    return { ok: true, code }
  } catch (error) {
    const message = `Falha ao gerar código de pareamento: ${String(error)}`
    setStatus({ lastError: message })
    return { ok: false, error: message }
  }
}

function setStatus(patch: Partial<WhatsAppStatus>) {
  Object.assign(status, patch)
}

function onlyDigits(value: string | undefined): string {
  return (value ?? '').replace(/\D/g, '')
}

function toJid(number: string): string {
  return `${onlyDigits(number)}@s.whatsapp.net`
}

function fromJid(jid: string | null | undefined): string {
  if (!jid) return ''
  return jid.replace(/@s\.whatsapp\.net$/, '')
}

function getMessageText(msg: WAMessage): string {
  const m = msg.message
  if (!m) return ''
  return m.conversation
    || m.extendedTextMessage?.text
    || m.imageMessage?.caption
    || m.videoMessage?.caption
    || m.documentMessage?.caption
    || ''
}

async function sendText(sock: WASocket, jid: string, text: string) {
  try {
    await sock.sendMessage(jid, { text })
  } catch (error) {
    console.error('[whatsapp] erro ao enviar mensagem:', error)
  }
}

function isAdminNumber(number: string): boolean {
  const admin = onlyDigits(process.env.WHATSAPP_ADMIN_NUMBER)
  return Boolean(admin) && number === admin
}

function parseVoucherCommand(text: string): { credits: number; amount: number } | null {
  const match = text.match(/^!voucher\s+(\d+)(?:\s+(\d+))?$/i)
  if (!match) return null
  const credits = Number(match[1])
  const amount = match[2] ? Number(match[2]) : 1
  if (!Number.isFinite(credits) || credits < 1 || credits > 1000) return null
  if (!Number.isFinite(amount) || amount < 1 || amount > 100) return null
  return { credits, amount }
}

function parseApproveCommand(text: string): { number: string; credits: number } | null {
  const match = text.match(/^!aprovar\s+(\d[\d\s-]{7,})\s+(\d+)$/i)
  if (!match) return null
  const number = onlyDigits(match[1])
  const credits = Number(match[2])
  if (number.length < 8 || !Number.isFinite(credits) || credits < 1 || credits > 1000) return null
  return { number, credits }
}

async function handleAdminCommand(sock: WASocket, adminJid: string, text: string) {
  const lower = text.trim()

  if (/^!help$/i.test(lower)) {
    await sendText(sock, adminJid, [
      'Comandos SaveTube:',
      '',
      '!voucher <créditos> [quantidade] — gera voucher(s)',
      '!aprovar <numero> <créditos> — aprova comprovante e envia voucher ao cliente',
      '!status — status do bot',
      '!help — esta lista'
    ].join('\n'))
    return
  }

  if (/^!status$/i.test(lower)) {
    await sendText(sock, adminJid, `Bot SaveTube conectado. Admin: ${status.adminNumber ?? '-'}`)
    return
  }

  const voucherCommand = parseVoucherCommand(lower)
  if (voucherCommand) {
    const created = createVouchers(voucherCommand.amount, voucherCommand.credits)
    const codes = created.map((v) => `${v.code} (${v.credits} crédito(s))`).join('\n')
    await sendText(sock, adminJid, `Voucher(s) gerado(s):\n${codes}`)
    return
  }

  const approveCommand = parseApproveCommand(lower)
  if (approveCommand) {
    const created = createVouchers(1, approveCommand.credits)
    const voucher = created[0]
    const customerJid = toJid(approveCommand.number)
    await sendText(sock, customerJid, `✅ Pagamento aprovado! Seu voucher SaveTube:\n\n${voucher.code}\n\nResgate no site em "Comprar créditos" → campo de voucher.`)
    await sendText(sock, adminJid, `Voucher ${voucher.code} (${voucher.credits} crédito(s)) enviado para ${approveCommand.number}.`)
    return
  }

  await sendText(sock, adminJid, 'Comando não reconhecido. Envie !help para ver a lista.')
}

async function handleCustomerMessage(sock: WASocket, senderJid: string, senderNumber: string, text: string, msg: WAMessage) {
  const adminNumber = onlyDigits(process.env.WHATSAPP_ADMIN_NUMBER)
  if (!adminNumber) return

  await sendText(sock, senderJid, '✅ Recebemos seu comprovante! Nossa equipe vai conferir e, em instantes, você recebe seu voucher aqui mesmo. Obrigado!')

  const adminJid = toJid(adminNumber)
  const caption = text.trim() ? `\nMensagem: ${text.trim()}` : ''

  try {
    await sock.sendMessage(adminJid, { forward: msg })
    await sendText(sock, adminJid, `📩 Comprovante de ${senderNumber}${caption}\n\nPara aprovar: !aprovar ${senderNumber} <créditos>`)
  } catch {
    await sendText(sock, adminJid, `📩 Comprovante recebido de ${senderNumber}${caption}\n\nPara aprovar: !aprovar ${senderNumber} <créditos>`)
  }
}

async function handleMessage(sock: WASocket, msg: WAMessage) {
  const jid = msg.key.remoteJid
  if (!jid || jid === 'status@broadcast' || jid.endsWith('@g.us') || msg.key.fromMe) return

  const senderNumber = fromJid(jid)
  const text = getMessageText(msg)

  if (isAdminNumber(senderNumber)) {
    if (text.startsWith('!')) await handleAdminCommand(sock, jid, text)
    return
  }

  await handleCustomerMessage(sock, jid, senderNumber, text, msg)
}

export async function startWhatsAppBot() {
  const enabled = process.env.WHATSAPP_ENABLED === 'true'
  status.enabled = enabled
  if (!enabled) {
    console.log('[whatsapp] bot desativado (WHATSAPP_ENABLED != true)')
    return
  }

  const adminNumber = onlyDigits(process.env.WHATSAPP_ADMIN_NUMBER)
  const botNumber = onlyDigits(process.env.WHATSAPP_PAIRING_NUMBER)
  status.adminNumber = adminNumber || undefined
  status.botNumber = botNumber || undefined

  if (!adminNumber) {
    setStatus({ lastError: 'WHATSAPP_ADMIN_NUMBER não configurado no .env' })
    console.error('[whatsapp] WHATSAPP_ADMIN_NUMBER não configurado.')
    return
  }

  const authDir = path.join(process.cwd(), 'storage', 'whatsapp-auth')
  fs.mkdirSync(authDir, { recursive: true })

  const { state, saveCreds } = await useMultiFileAuthState(authDir)
  let pairingRequested = false
  let lastPairingRequestAt = 0
  let autoRequestDone = false
  let wasRegistered = Boolean(state.creds.registered)
  let currentSock: WASocket | null = null

  const connect = async () => {
    // Garante que só existe um socket ativo por vez
    if (currentSock) {
      try { currentSock.end?.(new Error('reconnect')) } catch { /* ignore */ }
      currentSock = null
    }

    const { version } = await fetchLatestBaileysVersion()

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: !botNumber,
      browser: ['SaveTube', 'Chrome', '1.0'],
      markOnlineOnConnect: true,
      syncFullHistory: false
    })

    currentSock = sock
    activeSock = sock
    activeBotNumber = botNumber

    sock.ev.on('creds.update', async () => {
      fs.mkdirSync(authDir, { recursive: true })
      await saveCreds()
    })

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update

      if (qr) setStatus({ qr })

      // Solicita código de pareamento uma única vez automaticamente
      if (!autoRequestDone && !pairingRequested && botNumber && (connection === 'connecting' || qr)) {
        pairingRequested = true
        autoRequestDone = true
        lastPairingRequestAt = Date.now()
        setTimeout(async () => {
          try {
            const code = await sock.requestPairingCode(botNumber)
            setStatus({ pairingCode: code, lastError: undefined })
            console.log(`[whatsapp] código de pareamento: ${code}`)
          } catch (error) {
            console.error('[whatsapp] falha ao gerar código de pareamento:', error)
            setStatus({ lastError: `Falha ao gerar código de pareamento: ${String(error)}` })
          }
        }, 2000)
      }

      if (connection === 'open') {
        wasRegistered = true
        setStatus({ connected: true, qr: undefined, pairingCode: undefined, lastError: undefined })
        console.log('[whatsapp] conectado')
      }

      if (connection === 'close') {
        setStatus({ connected: false, pairingCode: undefined })
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode
        console.log(`[whatsapp] desconectado (statusCode: ${statusCode})`)

        // Só remove a sessão local se havia uma sessão válida antes.
        // Durante o pareamento (nunca registrado), mantém os arquivos e reconecta.
        if (statusCode === DisconnectReason.loggedOut && wasRegistered) {
          setStatus({ lastError: 'Sessão desconectada (loggedOut). Removendo sessão local para parear novamente.' })
          try {
            for (const file of fs.readdirSync(authDir)) {
              fs.rmSync(path.join(authDir, file), { recursive: true, force: true })
            }
          } catch { /* ignore */ }
          wasRegistered = false
          lastPairingRequestAt = 0
        }

        pairingRequested = false
        currentSock = null

        // Reconecta automaticamente
        setTimeout(() => {
          connect().catch((error) => console.error('[whatsapp] falha ao reconectar:', error))
        }, 3000)
      }
    })

    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify') return
      for (const msg of messages) {
        handleMessage(sock, msg).catch((error) => console.error('[whatsapp] erro no handler:', error))
      }
    })
  }

  await connect()
  console.log(`[whatsapp] bot iniciado (admin: ${adminNumber}${botNumber ? `, bot: ${botNumber}` : ''})`)
}
