import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

const DATA_DIR = path.join(process.cwd(), 'data')
fs.mkdirSync(DATA_DIR, { recursive: true })

const VOUCHERS_FILE = path.join(DATA_DIR, 'vouchers.json')
const USAGE_FILE = path.join(DATA_DIR, 'usage.json')
const CONFIG_FILE = path.join(DATA_DIR, 'config.json')
const WALLETS_FILE = path.join(DATA_DIR, 'wallets.json')

export type Voucher = { code: string; credits: number; redeemed: boolean; redeemedAt?: string; createdAt: string }
export type Usage = { date: string; freeDownloads: number; paidDownloads?: number }
export type Wallet = { clientId: string; credits: number; createdAt: string; updatedAt: string }
export type DonationMethod = { id: string; name: string; type: 'pix' | 'paypal' | 'stripe' | 'crypto' | 'link' | 'qrcode'; value: string; active: boolean; region?: 'BR' | 'default' | 'all' }
export type RegionConfig = { currency: string; symbol: string; creditPrice: number; whatsapp?: string; donations: DonationMethod[] }
export type Config = { regions: Record<'BR' | 'default', RegionConfig>; exchangeRate?: number } & Partial<{ donations: DonationMethod[]; creditPrice: number; whatsapp?: string }>

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

export function getVouchers(): Voucher[] { return readJson<Voucher[]>(VOUCHERS_FILE, []) }
export function saveVouchers(vouchers: Voucher[]) { writeJson(VOUCHERS_FILE, vouchers) }

export function getUsage(): Record<string, Usage> { return readJson<Record<string, Usage>>(USAGE_FILE, {}) }
export function saveUsage(usage: Record<string, Usage>) { writeJson(USAGE_FILE, usage) }

export function getConfig(): Config {
  const raw = readJson<Config>(CONFIG_FILE, { regions: { BR: { currency: 'BRL', symbol: 'R$', creditPrice: 1.3, donations: [] }, default: { currency: 'USD', symbol: 'US$', creditPrice: 0.25, donations: [] } }, exchangeRate: 0.18 })
  // Migrate legacy flat config to regional config
  if ('creditPrice' in raw && !raw.regions) {
    const legacy = raw as unknown as { donations: DonationMethod[]; creditPrice: number; whatsapp?: string }
    const migrated: Config = {
      exchangeRate: 0.18,
      regions: {
        BR: { currency: 'BRL', symbol: 'R$', creditPrice: legacy.creditPrice, whatsapp: legacy.whatsapp, donations: legacy.donations.map((d) => ({ ...d, region: 'BR' })) },
        default: { currency: 'USD', symbol: 'US$', creditPrice: Number((legacy.creditPrice * 0.18).toFixed(2)), whatsapp: legacy.whatsapp, donations: [] }
      }
    }
    saveConfig(migrated)
    return migrated
  }
  if (raw.regions && raw.exchangeRate === undefined) {
    raw.exchangeRate = 0.18
    saveConfig(raw)
  }
  return raw
}

export function getRegionConfig(region: 'BR' | 'default'): RegionConfig {
  const config = getConfig()
  if (!('regions' in config) || !config.regions) {
    return { currency: region === 'BR' ? 'BRL' : 'USD', symbol: region === 'BR' ? 'R$' : 'US$', creditPrice: region === 'BR' ? 1.3 : 0.25, donations: [] }
  }
  const cfg = config.regions[region] ?? config.regions.default ?? { currency: 'USD', symbol: 'US$', creditPrice: 0.25, donations: [] }
  const allDonations = Object.values(config.regions).flatMap((r) => r.donations.filter((d) => d.region === 'all'))
  const mergedDonations = [...cfg.donations, ...allDonations]
  const uniqueDonations = Array.from(new Map(mergedDonations.map((d) => [d.id, d])).values())
  const creditPrice = region === 'default' && config.exchangeRate && config.regions.BR
    ? Number((config.regions.BR.creditPrice * config.exchangeRate).toFixed(2))
    : cfg.creditPrice
  return { ...cfg, donations: uniqueDonations, creditPrice }
}

export function saveConfig(config: Config) { writeJson(CONFIG_FILE, config) }

function today() { return new Date().toISOString().slice(0, 10) }

function randomSegment() { return randomBytes(3).toString('hex').toUpperCase().slice(0, 4) }

export function generateVoucherCode() { return `STB-${randomSegment()}-${randomSegment()}-${randomSegment()}` }

export function createVouchers(amount: number, credits: number): Voucher[] {
  const vouchers = getVouchers()
  const created: Voucher[] = []
  for (let i = 0; i < amount; i++) {
    let code = generateVoucherCode()
    while (vouchers.some((v) => v.code === code)) code = generateVoucherCode()
    const voucher: Voucher = { code, credits, redeemed: false, createdAt: today() }
    vouchers.push(voucher)
    created.push(voucher)
  }
  saveVouchers(vouchers)
  return created
}

export function getWallets(): Record<string, Wallet> { return readJson<Record<string, Wallet>>(WALLETS_FILE, {}) }
export function saveWallets(wallets: Record<string, Wallet>) { writeJson(WALLETS_FILE, wallets) }

export function getBalance(clientId: string): number {
  const wallets = getWallets()
  return wallets[clientId]?.credits ?? 0
}

export function addCredits(clientId: string, amount: number): number {
  const wallets = getWallets()
  const existing = wallets[clientId]
  const now = new Date().toISOString()
  const wallet: Wallet = existing
    ? { ...existing, credits: existing.credits + amount, updatedAt: now }
    : { clientId, credits: amount, createdAt: now, updatedAt: now }
  wallets[clientId] = wallet
  saveWallets(wallets)
  return wallet.credits
}

export function consumeCredit(clientId: string): { ok: true; balance: number } | { ok: false; error: string; balance: number } {
  const wallets = getWallets()
  const wallet = wallets[clientId]
  const balance = wallet?.credits ?? 0
  if (balance < 1) return { ok: false, error: 'Saldo insuficiente. Compre créditos para continuar.', balance }
  const now = new Date().toISOString()
  wallets[clientId] = wallet
    ? { ...wallet, credits: balance - 1, updatedAt: now }
    : { clientId, credits: 0, createdAt: now, updatedAt: now }
  saveWallets(wallets)
  return { ok: true, balance: wallets[clientId].credits }
}

export function redeemVoucher(code: string, clientId: string): { ok: true; credits: number; balance: number } | { ok: false; error: string } {
  const vouchers = getVouchers()
  const normalized = code.trim().toUpperCase()
  const voucher = vouchers.find((v) => v.code === normalized)
  if (!voucher) return { ok: false, error: 'Voucher não encontrado.' }
  if (voucher.redeemed) return { ok: false, error: 'Voucher já resgatado.' }
  voucher.redeemed = true
  voucher.redeemedAt = new Date().toISOString()
  saveVouchers(vouchers)
  const balance = addCredits(clientId, voucher.credits)
  return { ok: true, credits: voucher.credits, balance }
}

export function getFreeDownloadsToday(ip: string): number {
  const usage = getUsage()
  const record = usage[ip]
  if (!record || record.date !== today()) return 0
  return record.freeDownloads
}

export function incrementFreeDownloads(ip: string) {
  const usage = getUsage()
  if (!usage[ip] || usage[ip].date !== today()) usage[ip] = { date: today(), freeDownloads: 0 }
  usage[ip].freeDownloads++
  saveUsage(usage)
}

export function canUseFree(ip: string, limit = 5): boolean {
  return getFreeDownloadsToday(ip) < limit
}

export function isFormatPaid(format: string, audio: boolean, formats: Array<{ formatId?: string; height?: number }> = []): boolean {
  if (audio) return false
  if (format === 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best' || format === 'bestvideo+bestaudio/best' || format === 'best') return true
  const selected = formats.find((f) => f.formatId === format)
  if (!selected) return true
  const height = selected.height ?? 0
  return height > 720
}

export function getFormatHeight(format: string, formats: Array<{ formatId?: string; height?: number }> = []): number {
  if (format === 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best' || format === 'bestvideo+bestaudio/best' || format === 'best') return 1080
  const selected = formats.find((f) => f.formatId === format)
  return selected?.height ?? 0
}

export function incrementPaidDownloads(ip: string) {
  const usage = getUsage()
  if (!usage[ip] || usage[ip].date !== today()) usage[ip] = { date: today(), freeDownloads: 0 }
  usage[ip].paidDownloads = (usage[ip].paidDownloads ?? 0) + 1
  saveUsage(usage)
}
