import { useEffect, useMemo, useRef, useState } from 'react'
import { t, tArray, tRaw, tPlural, useLanguage, formatCurrency, regionFromLanguage, type Language } from './i18n'

type Format = { formatId?: string; ext?: string; height?: number; width?: number; filesize?: number; hasVideo: boolean; hasAudio: boolean }
type Media = { title?: string; duration?: number; isLive?: boolean; thumbnail?: string; uploader?: string; extractor?: string; formats?: Format[] }
type Event = { type: string; status?: string; message?: string; percent?: string | number; speed?: number; eta?: number; downloadedBytes?: number; totalBytes?: number; data?: Media; file?: string }
type DonationMethod = { id: string; name: string; type: 'pix' | 'paypal' | 'stripe' | 'crypto' | 'link' | 'qrcode'; value: string; region?: 'BR' | 'default' | 'all' }
type Config = { region: 'BR' | 'default'; currency: string; symbol: string; creditPrice: number; whatsapp?: string; donations: DonationMethod[] }

const BEST_MP4 = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'

type AuthState = { email: string; token: string }

function loadAuth(): AuthState | null {
  const token = localStorage.getItem('st_token')
  const email = localStorage.getItem('st_email')
  return token && email ? { token, email } : null
}

function saveAuth(auth: AuthState | null) {
  if (auth) {
    localStorage.setItem('st_token', auth.token)
    localStorage.setItem('st_email', auth.email)
  } else {
    localStorage.removeItem('st_token')
    localStorage.removeItem('st_email')
  }
}

function authHeaders(token: string): Record<string, string> {
  return { 'content-type': 'application/json', authorization: `Bearer ${token}` }
}

function parsePercent(value: string | number | undefined): number {
  if (value === undefined || value === null) return 0
  if (typeof value === 'number') return Math.min(100, Math.max(0, value))
  const cleaned = value.replace(/[^0-9.]/g, '')
  const num = parseFloat(cleaned)
  return Number.isFinite(num) ? Math.min(100, Math.max(0, num)) : 0
}

function formatBytes(bytes: number | undefined): string {
  if (!bytes) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let size = bytes
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++ }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function formatSpeed(speed: number | undefined): string {
  if (!speed) return '—'
  return `${formatBytes(speed)}/s`
}

function friendlyError(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('network request failed') || lower.includes('load failed')) {
    return t('errors.network')
  }
  if (lower.includes('unexpected token') || lower.includes('<!doctype') || lower.includes('<html')) {
    return t('errors.serverUnavailable')
  }
  if (lower.includes('sign in') || lower.includes('confirm your age') || lower.includes('cookies')) {
    return t('errors.ageRestricted')
  }
  if (lower.includes('ffmpeg') || lower.includes('merging of multiple formats')) {
    return t('errors.ffmpeg')
  }
  if (lower.includes('fragment retries') || lower.includes('giving up')) {
    return t('errors.fragment')
  }
  if (lower.includes('private') || lower.includes('unavailable') || lower.includes('not available')) {
    return t('errors.private')
  }
  return message
}

function RestrictionsNotice() {
  return (
    <div className="restrictions-notice">
      <span>ℹ️</span>
      <div>
        <strong>{t('restrictions.title')}</strong> {t('restrictions.works')}
        <br />
        <strong>{t('restrictions.doesntTitle')}</strong> {t('restrictions.doesnt')}
      </div>
    </div>
  )
}

function LivestreamNotice() {
  return (
    <div className="error-banner livestream-notice">
      <span>📡</span>
      <div>{t('errors.livestream')}</div>
    </div>
  )
}

function DonationCompact({ config }: { config: Config }) {
  const isBR = config.region === 'BR'
  const pix = config.donations.find((d) => d.type === 'pix')
  const pixKey = pix?.value ?? '7d67a0ad-187d-4b10-af02-f0776576975d'
  const cryptoMethods = config.donations.filter((d) => d.type === 'crypto')
  const paypalMethod = config.donations.find((d) => d.type === 'paypal')

  const availableMethods = [
    ...(isBR && pix ? [{ id: 'pix', label: 'Pix' }] : []),
    ...(paypalMethod ? [{ id: 'paypal', label: 'PayPal' }] : []),
    ...(cryptoMethods.length > 0 ? [{ id: 'crypto', label: t('donationBanner.cryptoLabel') }] : [])
  ]

  const [selectedMethod, setSelectedMethod] = useState(availableMethods[0]?.id ?? '')
  const [selectedCrypto, setSelectedCrypto] = useState(cryptoMethods[0]?.id ?? '')

  const selectedCryptoMethod = cryptoMethods.find((d) => d.id === selectedCrypto)

  if (availableMethods.length === 0) return null

  return (
    <div className="donation-compact">
      <div className="donation-compact-header">
        <span className="donation-compact-label">{t('donationBanner.compactLabel')}</span>
        <div className="donation-compact-selector">
          <select value={selectedMethod} onChange={(e) => setSelectedMethod(e.target.value)}>
            {availableMethods.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>
      </div>

      {selectedMethod === 'pix' && (
        <div className="donation-compact-panel">
          <span className="donation-badge">{t('donationBanner.pixOnly')}</span>
          <div className="donation-compact-key">
            <code>{pixKey}</code>
            <button className="secondary-btn" onClick={() => navigator.clipboard.writeText(pixKey)}>{t('donationBanner.copyKey')}</button>
          </div>
          <img
            src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(buildPixPayload(pixKey))}`}
            alt="QR Code Pix"
            className="donation-compact-qr"
          />
        </div>
      )}

      {selectedMethod === 'paypal' && paypalMethod && (
        <div className="donation-compact-panel">
          <a href={paypalMethod.value} target="_blank" rel="noreferrer" className="donation-compact-btn paypal">
            {t('donationBanner.paypalButton')}
          </a>
        </div>
      )}

      {selectedMethod === 'crypto' && cryptoMethods.length > 0 && (
        <div className="donation-compact-panel">
          <div className="donation-compact-crypto-select">
            <select value={selectedCrypto} onChange={(e) => setSelectedCrypto(e.target.value)}>
              {cryptoMethods.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
          {selectedCryptoMethod && (
            <>
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(selectedCryptoMethod.value)}`}
                alt={selectedCryptoMethod.name}
                className="donation-compact-qr"
              />
              <div className="donation-compact-key">
                <code>{selectedCryptoMethod.value}</code>
                <button className="secondary-btn" onClick={() => navigator.clipboard.writeText(selectedCryptoMethod.value)}>{t('donationBanner.copyKey')}</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function DonationBanner({ config }: { config: Config }) {
  const isBR = config.region === 'BR'
  const pix = config.donations.find((d) => d.type === 'pix')
  const pixKey = pix?.value ?? '7d67a0ad-187d-4b10-af02-f0776576975d'
  const cryptoMethods = config.donations.filter((d) => d.type === 'crypto')
  const paypalMethod = config.donations.find((d) => d.type === 'paypal')

  const availableMethods = [
    ...(isBR && pix ? [{ id: 'pix', label: 'Pix' }] : []),
    ...(paypalMethod ? [{ id: 'paypal', label: 'PayPal' }] : []),
    ...(cryptoMethods.length > 0 ? [{ id: 'crypto', label: t('donationBanner.cryptoLabel') }] : [])
  ]

  const [selectedMethod, setSelectedMethod] = useState(availableMethods[0]?.id ?? '')
  const [selectedCrypto, setSelectedCrypto] = useState(cryptoMethods[0]?.id ?? '')

  const selectedCryptoMethod = cryptoMethods.find((d) => d.id === selectedCrypto)

  return (
    <section className="donation-banner">
      <div className="donation-banner-content">
        <div className="donation-banner-text">
          <h3>{isBR ? t('donationBanner.title') : t('donationBanner.globalTitle')}</h3>
          <p>{isBR ? t('donationBanner.chooseMethodBR') : t('donationBanner.chooseMethodGlobal')}</p>

          {availableMethods.length > 0 && (
            <div className="donation-method-selector">
              <select value={selectedMethod} onChange={(e) => setSelectedMethod(e.target.value)}>
                {availableMethods.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>
          )}

          {selectedMethod === 'pix' && (
            <div className="donation-method-panel">
              <span className="donation-badge">{t('donationBanner.pixOnly')}</span>
              <div className="donation-banner-key">
                <code>{pixKey}</code>
                <button className="secondary-btn" onClick={() => navigator.clipboard.writeText(pixKey)}>{t('donationBanner.copyKey')}</button>
              </div>
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(buildPixPayload(pixKey))}`}
                alt="QR Code Pix"
                className="donation-banner-qr"
              />
            </div>
          )}

          {selectedMethod === 'paypal' && paypalMethod && (
            <div className="donation-method-panel">
              <a href={paypalMethod.value} target="_blank" rel="noreferrer" className="primary-btn">
                {t('donationBanner.paypalButton')}
              </a>
            </div>
          )}

          {selectedMethod === 'crypto' && cryptoMethods.length > 0 && (
            <div className="donation-method-panel">
              <div className="crypto-selector">
                <select value={selectedCrypto} onChange={(e) => setSelectedCrypto(e.target.value)}>
                  {cryptoMethods.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>
              {selectedCryptoMethod && (
                <>
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(selectedCryptoMethod.value)}`}
                    alt={selectedCryptoMethod.name}
                    className="donation-banner-qr"
                  />
                  <div className="donation-banner-key">
                    <code>{selectedCryptoMethod.value}</code>
                    <button className="secondary-btn" onClick={() => navigator.clipboard.writeText(selectedCryptoMethod.value)}>{t('donationBanner.copyKey')}</button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function isFormatPaid(format: string, audio: boolean, formats: Format[] = []): boolean {
  if (audio) return false
  if (format === BEST_MP4 || format === 'bestvideo+bestaudio/best' || format === 'best') return true
  const selected = formats.find((f) => f.formatId === format)
  if (!selected) return true
  return (selected.height ?? 0) > 720
}

function getFormatLabel(format: string, audio: boolean): string {
  if (audio) return t('controls.mp3Label')
  if (format === BEST_MP4 || format === 'bestvideo+bestaudio/best' || format === 'best') return t('controls.bestQuality')
  const match = format.match(/(\d+)/)
  return match ? `${match[1]}p` : format
}

function SaveTubeLogo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.38.55A3.02 3.02 0 0 0 .5 6.19 31.5 31.5 0 0 0 0 12a31.5 31.5 0 0 0 .5 5.81 3.02 3.02 0 0 0 2.12 2.14c1.88.55 9.38.55 9.38.55s7.5 0 9.38-.55a3.02 3.02 0 0 0 2.12-2.14A31.5 31.5 0 0 0 24 12a31.5 31.5 0 0 0-.5-5.81zM9.55 15.5V8.5l6.27 3.5-6.27 3.5z" />
    </svg>
  )
}

function VideoPlaceholder() {
  return (
    <div className="preview-placeholder">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14zM8 15c0-.55.45-1 1-1h6c.55 0 1 .45 1 1v2H8v-2zm9-7H7v2h10V8z" /></svg>
      <p>{t('hero.urlPlaceholder')}</p>
    </div>
  )
}

function ProgressPanel({ progress, isAudio, onCancel, cancelling }: { progress: Event | null; isAudio?: boolean; onCancel?: () => void; cancelling?: boolean }) {
  const percent = useMemo(() => parsePercent(progress?.percent), [progress?.percent])
  const isActive = !progress || (progress.type !== 'finished' && progress.type !== 'error')
  const phase = progress?.type === 'metadata'
    ? t('progress.analyzing')
    : progress?.type === 'progress'
      ? t('progress.downloading')
      : progress?.type === 'finished'
        ? (isAudio ? t('progress.converting') : t('progress.finished'))
        : t('progress.preparing')

  return (
    <div className="progress-panel">
      <div className="progress-status">
        {(isActive || !progress) && <span className="dot" />}
        <span>{phase}</span>
      </div>
      <div className="progress-percent">{percent.toFixed(1)}%</div>
      <div className="progress-bar-track">
        <div className="progress-bar-fill" style={{ width: `${percent}%` }} />
      </div>
      <div className="progress-stats">
        <span>{t('progress.speed')} <b>{formatSpeed(progress?.speed)}</b></span>
        <span>{t('progress.downloaded')} <b>{formatBytes(progress?.downloadedBytes)}</b></span>
        <span>{t('progress.total')} <b>{formatBytes(progress?.totalBytes)}</b></span>
        <span>{t('progress.eta')} <b>{progress?.eta ? `${progress.eta}${t('progress.seconds')}` : '—'}</b></span>
      </div>
      {isActive && onCancel && (
        <div className="progress-actions">
          <button className="cancel-btn" onClick={onCancel} disabled={cancelling}>
            {cancelling ? t('controls.cancelling') : t('controls.cancel')}
          </button>
        </div>
      )}
    </div>
  )
}

function crc16Pix(payload: string): string {
  let crc = 0xFFFF
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1
      crc &= 0xFFFF
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

function buildPixPayload(key: string, amount?: number, name = 'SaveTube', city = 'BRASILIA'): string {
  const cleanKey = key.trim()
  const gui = 'br.gov.bcb.pix'
  const merchantAccount = `00${gui.length.toString().padStart(2, '0')}${gui}01${cleanKey.length.toString().padStart(2, '0')}${cleanKey}`
  const emv =
    '000201' +
    `26${merchantAccount.length.toString().padStart(2, '0')}${merchantAccount}` +
    '52040000' +
    '5303986'
  const amountPart = amount !== undefined
    ? `54${amount.toFixed(2).length.toString().padStart(2, '0')}${amount.toFixed(2)}`
    : ''
  const suffix =
    amountPart +
    '5802BR' +
    `59${Math.min(name.length, 25).toString().padStart(2, '0')}${name.slice(0, 25)}` +
    `60${Math.min(city.length, 15).toString().padStart(2, '0')}${city.slice(0, 15)}` +
    '6304'
  const payload = emv + suffix
  return payload + crc16Pix(payload)
}

function isPayPal(method: DonationMethod): boolean {
  return method.type === 'paypal' || method.name.toLowerCase().includes('paypal') || method.value.toLowerCase().includes('paypal')
}

function buildPaypalUrl(value: string, total: number): string {
  const raw = value.trim()
  if (/^https?:\/\//i.test(raw)) {
    if (/paypal\.com\/ncp\/payment\//i.test(raw)) return raw
    return `${raw.replace(/\/$/, '')}/${total.toFixed(2)}`
  }
  const username = raw.replace(/\s/g, '')
  return `https://www.paypal.com/paypalme/${encodeURIComponent(username)}/${total.toFixed(2)}`
}

function buildStripeUrl(value: string, quantity: number): string {
  return value.replace(/\{quantity\}/g, String(quantity))
}

function buildGenericLink(value: string, total: number): string {
  return value.replace(/\{valor\}|\{total\}/g, total.toFixed(2))
}

function DonateModal({ config, onClose }: { config: Config; onClose: () => void }) {
  const [quantity, setQuantity] = useState(1)
  const total = useMemo(() => Number((quantity * config.creditPrice).toFixed(2)), [quantity, config.creditPrice])

  const whatsappText = config.whatsapp
    ? `https://wa.me/${config.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(t('donateModal.whatsappHint') + ` Total: ${formatCurrency(total, config.symbol)}`)})}`
    : undefined

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{t('donateModal.title')}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <p className="modal-lead">{t('donateModal.lead')}</p>

          <div className="credit-calculator">
            <label>
              {t('donateModal.quantity')}
              <input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
              />
            </label>
            <div className="credit-total">
              <span>{t('donateModal.total')}</span>
              <strong>{formatCurrency(total, config.symbol)}</strong>
              <small>{tPlural('donateModal.summary', quantity, { quantity, symbol: config.symbol, price: config.creditPrice.toFixed(2) })}</small>
            </div>
          </div>

          {config.donations.length === 0 && (
            <p className="modal-empty">{t('donateModal.empty')}</p>
          )}

          {config.donations.some((d) => d.type === 'paypal' || isPayPal(d)) && (
            <p className="modal-hint" style={{ textAlign: 'left' }}>
              💡 {t('donateModal.paypalHint')}
            </p>
          )}

          <div className="donation-list">
            {config.donations.map((method) => {
              if (method.type === 'pix') {
                const payload = buildPixPayload(method.value, total)
                const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(payload)}`
                return (
                  <div key={method.id} className="donation-item">
                    <strong>{method.name}</strong>
                    <code>{method.value}</code>
                    <img src={qrUrl} alt={`QR Code ${method.name}`} className="qr-code" />
                    <div className="donation-actions">
                      <button className="secondary-btn" onClick={() => navigator.clipboard.writeText(method.value)}>{t('donateModal.pix.copyKey')}</button>
                      <button className="secondary-btn" onClick={() => navigator.clipboard.writeText(payload)}>{t('donateModal.pix.copyCode')}</button>
                    </div>
                  </div>
                )
              }

              const isPayPalMethod = method.type === 'paypal' || isPayPal(method)
              const isStripeMethod = method.type === 'stripe'

              if (isPayPalMethod && /paypal\.com\/ncp\/payment\//i.test(method.value)) {
                return (
                  <div key={method.id} className="donation-item">
                    <strong>{method.name}</strong>
                    <form action={method.value} method="post" target="_blank" className="paypal-form">
                      <input
                        type="submit"
                        value={t('donateModal.paypalButton', { symbol: config.symbol, total: total.toFixed(2) })}
                        style={{
                          textAlign: 'center',
                          border: 'none',
                          borderRadius: '0.25rem',
                          minWidth: '11.625rem',
                          padding: '0 2rem',
                          height: '2.625rem',
                          fontWeight: 'bold',
                          backgroundColor: '#FFD140',
                          color: '#000000',
                          fontFamily: '"Helvetica Neue", Arial, sans-serif',
                          fontSize: '1rem',
                          lineHeight: '1.25rem',
                          cursor: 'pointer',
                          width: '100%'
                        }}
                      />
                      <img src="https://www.paypalobjects.com/images/Debit_Credit.svg" alt="Cards" style={{ marginTop: 8 }} />
                      <section style={{ fontSize: '0.75rem', marginTop: 4 }}>
                        {t('donateModal.poweredBy')} <img src="https://www.paypalobjects.com/paypal-ui/logos/svg/paypal-wordmark-color.svg" alt="PayPal" style={{ height: '0.875rem', verticalAlign: 'middle' }} />
                      </section>
                    </form>
                  </div>
                )
              }

              if (isStripeMethod) {
                const href = buildStripeUrl(method.value, quantity)
                return (
                  <div key={method.id} className="donation-item">
                    <strong>{method.name}</strong>
                    <a href={href} target="_blank" rel="noreferrer" className="primary-btn">
                      {t('donateModal.genericButton', { symbol: config.symbol, total: total.toFixed(2), name: method.name })}
                    </a>
                  </div>
                )
              }

              if (method.type === 'crypto') {
                const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(method.value)}`
                return (
                  <div key={method.id} className="donation-item crypto-item">
                    <strong>{method.name}</strong>
                    <img src={qrUrl} alt={method.name} className="qr-code" />
                    <code className="crypto-address">{method.value}</code>
                    <button className="secondary-btn" onClick={() => navigator.clipboard.writeText(method.value)}>{t('donateModal.crypto.copyAddress')}</button>
                  </div>
                )
              }

              const href = isPayPalMethod
                ? buildPaypalUrl(method.value, total)
                : buildGenericLink(method.value, total)

              if (method.type === 'qrcode') {
                return (
                  <div key={method.id} className="donation-item">
                    <strong>{method.name}</strong>
                    <img src={href} alt={method.name} className="qr-code" />
                  </div>
                )
              }

              return (
                <div key={method.id} className="donation-item">
                  <strong>{method.name}</strong>
                  <a href={href} target="_blank" rel="noreferrer" className="primary-btn">
                    {t('donateModal.genericButton', { symbol: config.symbol, total: total.toFixed(2), name: method.name })}
                  </a>
                </div>
              )
            })}
          </div>

          {whatsappText && (
            <>
              <div className="modal-divider" />
              <p className="modal-hint">{t('donateModal.whatsappHint')}</p>
              <a href={whatsappText} target="_blank" rel="noreferrer" className="primary-btn" style={{ width: '100%' }}>
                {t('donateModal.whatsappButton')}
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function LanguageSelector() {
  const { language, setLanguage } = useLanguage()
  return (
    <select
      className="language-selector"
      value={language}
      onChange={(e) => setLanguage(e.target.value as Language)}
      aria-label={t('languageSelector.label')}
    >
      <option value="pt">{t('languageSelector.pt')}</option>
      <option value="en">{t('languageSelector.en')}</option>
      <option value="es">{t('languageSelector.es')}</option>
    </select>
  )
}

function AuthModal({ onClose, onLogin }: { onClose: () => void; onLogin: (email: string, token: string) => void }) {
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [devCode, setDevCode] = useState('')

  async function requestCode() {
    setError(''); setBusy(true)
    try {
      const response = await fetch('/api/auth/request-code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || t('auth.genericError'))
      setDevCode(data.devCode ?? '')
      setStep('code')
    } catch (cause) {
      setError(friendlyError(cause instanceof Error ? cause.message : t('auth.genericError')))
    } finally {
      setBusy(false)
    }
  }

  async function verifyCode() {
    setError(''); setBusy(true)
    try {
      const response = await fetch('/api/auth/verify-code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, code }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || t('auth.genericError'))
      onLogin(data.email, data.token)
    } catch (cause) {
      setError(friendlyError(cause instanceof Error ? cause.message : t('auth.genericError')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{t('auth.title')}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {error && <div className="error-banner"><span>⚠️</span>{error}</div>}

          {step === 'email' && (
            <div className="form-group">
              <label>{t('auth.emailLabel')}</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('auth.emailPlaceholder')}
                onKeyDown={(e) => { if (e.key === 'Enter' && email) requestCode() }}
              />
              <button className="primary-btn" style={{ width: '100%', marginTop: 16 }} onClick={requestCode} disabled={busy || !email}>
                {t('auth.sendCode')}
              </button>
            </div>
          )}

          {step === 'code' && (
            <div className="form-group">
              <label>{t('auth.codeLabel')}</label>
              <input
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={t('auth.codePlaceholder')}
                onKeyDown={(e) => { if (e.key === 'Enter' && code) verifyCode() }}
              />
              {devCode && <p className="modal-hint">💡 {t('auth.devCode', { code: devCode })}</p>}
              <p className="modal-hint">{t('auth.codeSent')}</p>
              <div className="donation-actions" style={{ marginTop: 16 }}>
                <button className="secondary-btn" onClick={() => { setStep('email'); setCode(''); setDevCode('') }} disabled={busy}>{t('auth.back')}</button>
                <button className="primary-btn" onClick={verifyCode} disabled={busy || !code}>{t('auth.confirm')}</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Header({ onDonate, credits, email, onLogin, onLogout }: { onDonate: () => void; credits: number; email: string | null; onLogin: () => void; onLogout: () => void }) {
  return (
    <header className="app-header">
      <a href="/" className="brand">
        <span className="brand-logo"><SaveTubeLogo /></span>
        <span className="brand-name">Save<span>Tube</span></span>
      </a>
      <div className="header-search">
        <input type="text" placeholder={t('header.searchPlaceholder')} readOnly />
        <button aria-label={t('header.searchPlaceholder')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
        </button>
      </div>
      <div className="header-actions">
        <LanguageSelector />
        <span className="credit-pill">{tPlural('header.credits', credits, { count: credits })}</span>
        {email ? (
          <>
            <span className="auth-email" title={t('auth.loggedAs')}>{email}</span>
            <button className="secondary-btn" onClick={onLogout}>{t('auth.logout')}</button>
          </>
        ) : (
          <button className="donate-btn" onClick={onLogin}>{t('auth.title')}</button>
        )}
        <button className="donate-btn" onClick={onDonate}>{t('header.buyCredits')}</button>
      </div>
    </header>
  )
}

function PricingCards({ config, onDonate }: { config: Config; onDonate: () => void }) {
  return (
    <section className="pricing-section" id="apoie">
      <h2>{t('pricing.title')}</h2>
      <div className="pricing-grid">
        <div className="pricing-card">
          <h3>{t('pricing.free.title')}</h3>
          <div className="price">{t('pricing.free.price', { symbol: config.symbol })} <span>{t('pricing.free.period')}</span></div>
          <ul>
            {tArray('pricing.free.features').map((f, i) => <li key={i}>{f}</li>)}
          </ul>
          <button className="secondary-btn" style={{ width: '100%' }} onClick={() => {
            const input = document.getElementById('url-input')
            if (input) {
              input.focus()
              input.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }
          }}>{t('pricing.free.cta')}</button>
        </div>
        <div className="pricing-card featured">
          <h3>{t('pricing.credits.title')}</h3>
          <div className="price">{formatCurrency(config.creditPrice, config.symbol)} <span>{t('pricing.credits.period')}</span></div>
          <ul>
            {tArray('pricing.credits.features').map((f, i) => <li key={i}>{f}</li>)}
          </ul>
          <button className="primary-btn" style={{ width: '100%' }} onClick={onDonate}>{t('pricing.credits.cta')}</button>
        </div>
      </div>
    </section>
  )
}

function HowItWorks() {
  const steps = (tRaw('howItWorks.steps') ?? []) as Array<{ title: string; text: string }>
  return (
    <section className="content-section">
      <h2>{t('howItWorks.title')}</h2>
      <div className="content-grid">
        {steps.map((s, i) => (
          <div key={i} className="content-card">
            <strong>{s.title}</strong>
            <p>{s.text}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function WhyUse() {
  const items = (tRaw('whyUse.items') ?? []) as Array<{ strong: string; text: string }>
  return (
    <section className="content-section">
      <h2>{t('whyUse.title')}</h2>
      <ul className="content-list">
        {items.map((item, i) => (
          <li key={i}><strong>{item.strong}</strong> {item.text}</li>
        ))}
      </ul>
    </section>
  )
}

function FAQ() {
  const items = (tRaw('faq.items') ?? []) as Array<{ q: string; a: string }>

  return (
    <section className="content-section" id="faq">
      <h2>{t('faq.title')}</h2>
      <dl className="faq-list">
        {items.map((item, i) => (
          <div key={i} className="faq-item">
            <dt>{item.q}</dt>
            <dd>{item.a}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function Footer() {
  const { language } = useLanguage()
  const seoLinks = language === 'pt'
    ? [{ href: '/youtube-para-mp3', label: t('footer.mp3') }, { href: '/youtube-para-mp4', label: t('footer.mp4') }]
    : language === 'en'
      ? [{ href: '/youtube-to-mp3', label: t('footer.mp3') }, { href: '/youtube-to-mp4', label: t('footer.mp4') }]
      : [{ href: '/youtube-a-mp3', label: t('footer.mp3') }, { href: '/youtube-a-mp4', label: t('footer.mp4') }]

  return (
    <footer className="app-footer">
      <div>
        {seoLinks.map((link) => (
          <a key={link.href} href={link.href}>{link.label}</a>
        ))}
        <a href="/termos.html">{t('footer.terms')}</a>
        <a href="/privacidade.html">{t('footer.privacy')}</a>
        <a href="#apoie">{t('footer.support')}</a>
      </div>
      <p>{t('footer.copyright', { year: new Date().getFullYear() })}</p>
    </footer>
  )
}

function updateMetaTags(language: Language) {
  const titles: Record<Language, string> = {
    pt: 'SaveTube — Baixe vídeos do YouTube grátis em MP4 e MP3',
    en: 'SaveTube — Download YouTube videos free in MP4 and MP3',
    es: 'SaveTube — Descarga videos de YouTube gratis en MP4 y MP3'
  }
  const descriptions: Record<Language, string> = {
    pt: 'Baixe vídeos do YouTube grátis em MP4 até 720p ou compre créditos para MP3 e alta resolução (1080p, 2K, 4K). Rápido, online e sem instalar nada.',
    en: 'Download YouTube videos free in MP4 up to 720p or buy credits for MP3 and high resolution (1080p, 2K, 4K). Fast, online and no installation.',
    es: 'Descarga videos de YouTube gratis en MP4 hasta 720p o compra créditos para MP3 y alta resolución (1080p, 2K, 4K). Rápido, online y sin instalar nada.'
  }
  document.title = titles[language]
  document.documentElement.lang = language === 'pt' ? 'pt-BR' : language === 'es' ? 'es' : 'en'
  const desc = document.querySelector('meta[name="description"]')
  if (desc) desc.setAttribute('content', descriptions[language])
  const ogTitle = document.querySelector('meta[property="og:title"]')
  if (ogTitle) ogTitle.setAttribute('content', titles[language])
  const ogDesc = document.querySelector('meta[property="og:description"]')
  if (ogDesc) ogDesc.setAttribute('content', descriptions[language])
  const ogLocale = document.querySelector('meta[property="og:locale"]')
  if (ogLocale) ogLocale.setAttribute('content', language === 'pt' ? 'pt_BR' : language === 'es' ? 'es_ES' : 'en_US')
}

function App() {
  const { language } = useLanguage()
  const [url, setUrl] = useState('')
  const [media, setMedia] = useState<Media | null>(null)
  const [format, setFormat] = useState(BEST_MP4)
  const [audio, setAudio] = useState(false)
  const [status, setStatus] = useState(t('controls.statusReady'))
  const [progress, setProgress] = useState<Event | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [creditBalance, setCreditBalance] = useState(() => Number(localStorage.getItem('st_credits') ?? 0))
  const [voucherCode, setVoucherCode] = useState('')
  const [redeeming, setRedeeming] = useState(false)
  const [showDonate, setShowDonate] = useState(false)
  const [useCredit, setUseCredit] = useState(false)
  const [auth, setAuth] = useState<AuthState | null>(() => loadAuth())
  const [showAuth, setShowAuth] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const streamRef = useRef<EventSource | null>(null)
  const [config, setConfig] = useState<Config>({ region: regionFromLanguage(language), currency: 'BRL', symbol: 'R$', creditPrice: 1.3, donations: [] })

  useEffect(() => {
    updateMetaTags(language)
  }, [language])

  useEffect(() => {
    fetch('/api/health').catch(() => setError(t('errors.serverUnavailable')))
    const region = regionFromLanguage(language)
    fetch(`/api/config?region=${region}`)
      .then((r) => r.json())
      .then((data) => setConfig(data))
      .catch(() => { })
  }, [language])

  function fetchBalance(token: string) {
    fetch('/api/credits/balance', { headers: { authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data) => { if (typeof data.balance === 'number') setCreditBalance(data.balance) })
      .catch(() => { })
  }

  function handleLogin(email: string, token: string) {
    saveAuth({ email, token })
    setAuth({ email, token })
    setShowAuth(false)
    fetchBalance(token)
  }

  function handleLogout() {
    const token = auth?.token
    if (token) fetch('/api/auth/logout', { method: 'POST', headers: { authorization: `Bearer ${token}` } }).catch(() => { })
    saveAuth(null)
    setAuth(null)
    setCreditBalance(0)
  }

  useEffect(() => {
    if (!auth) return
    fetch('/api/auth/me', { headers: { authorization: `Bearer ${auth.token}` } })
      .then((r) => { if (!r.ok) throw new Error('invalid') })
      .then(() => fetchBalance(auth.token))
      .catch(() => { saveAuth(null); setAuth(null); setCreditBalance(0) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth])

  useEffect(() => {
    localStorage.setItem('st_credits', String(creditBalance))
  }, [creditBalance])

  useEffect(() => {
    if ((media || busy) && !error) {
      const id = setTimeout(() => {
        const workspace = document.querySelector('.workspace')
        if (workspace) {
          workspace.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      }, 100)
      return () => clearTimeout(id)
    }
  }, [media, busy, error])

  async function watch(id: string) {
    streamRef.current?.close()
    const stream = new EventSource(`/api/media/jobs/${id}/events`)
    streamRef.current = stream
    setJobId(id)
    stream.onmessage = (message) => {
      let event: Event
      try {
        event = JSON.parse(message.data) as Event
      } catch {
        return
      }
      setProgress(event)
      if (event.type === 'metadata') setMedia(event.data ?? null)
      if (event.type === 'status') setStatus(event.status ?? '')
      if (event.type === 'error') {
        setError(friendlyError(event.message ?? t('errors.generic')))
        setBusy(false)
        setJobId(null)
        streamRef.current = null
        stream.close()
      }
      if (event.type === 'finished') {
        setStatus(event.file ? t('progress.finished') : t('progress.analysisFinished'))
        setBusy(false)
        setJobId(null)
        streamRef.current = null
        stream.close()
      }
    }
    stream.onerror = () => {
      stream.close()
      streamRef.current = null
      setJobId(null)
      // Se a análise já retornou os metadados, mantemos o workspace visível.
      // Caso contrário, sinalizamos que a conexão caiu durante o processo.
      setBusy((wasBusy) => {
        if (wasBusy) {
          setError(t('errors.network'))
        }
        return false
      })
    }
  }

  async function cancelJob() {
    const id = jobId
    if (!id || cancelling) return
    setCancelling(true)
    streamRef.current?.close()
    streamRef.current = null
    try {
      await fetch(`/api/media/jobs/${id}`, { method: 'DELETE' })
      setStatus(t('controls.statusCancelled'))
    } catch {
      setError(t('errors.network'))
    } finally {
      setBusy(false)
      setProgress(null)
      setJobId(null)
      setCancelling(false)
    }
  }

  async function inspect() {
    setError(''); setSuccess(''); setMedia(null); setBusy(true); setStatus(t('controls.statusAnalyzing')); setProgress(null); setJobId(null)
    try {
      const response = await fetch('/api/media/inspect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      watch(data.id)
    } catch (cause) {
      setError(friendlyError(cause instanceof Error ? cause.message : t('errors.generic')))
      setBusy(false)
    }
  }

  async function download() {
    setError(''); setSuccess(''); setBusy(true); setStatus(t('controls.statusPreparing')); setProgress(null); setJobId(null)
    const paid = isFormatPaid(format, audio, media?.formats ?? [])
    const shouldUseCredit = paid || useCredit
    try {
      if (shouldUseCredit && !auth) {
        setShowAuth(true)
        throw new Error(t('auth.needLogin'))
      }
      if (shouldUseCredit && creditBalance < 1) {
        throw new Error(t('errors.needCredit'))
      }
      const endpoint = shouldUseCredit ? '/api/media/jobs/server' : '/api/media/jobs'
      const headers = shouldUseCredit && auth ? authHeaders(auth.token) : { 'content-type': 'application/json' }
      const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ url, format, audio }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      if (shouldUseCredit) setCreditBalance(typeof data.balance === 'number' ? data.balance : Math.max(0, creditBalance - 1))
      watch(data.id)
    } catch (cause) {
      setError(friendlyError(cause instanceof Error ? cause.message : t('errors.generic')))
      setBusy(false)
    }
  }

  async function redeemVoucher() {
    const code = voucherCode.trim().toUpperCase()
    if (!code) return
    if (!auth) {
      setShowAuth(true)
      setError(t('auth.needLogin'))
      return
    }
    setRedeeming(true); setError(''); setSuccess('')
    try {
      const response = await fetch('/api/credits/redeem', { method: 'POST', headers: authHeaders(auth.token), body: JSON.stringify({ code }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setCreditBalance(typeof data.balance === 'number' ? data.balance : (c) => c + (data.credits ?? 0))
      setVoucherCode('')
      setSuccess(t('success.creditsAdded', { count: data.credits }))
    } catch (cause) {
      setError(friendlyError(cause instanceof Error ? cause.message : t('errors.redeem')))
    } finally {
      setRedeeming(false)
    }
  }

  const usableFormats = media?.formats?.filter((item) => item.formatId && item.hasVideo) ?? []
  const paid = isFormatPaid(format, audio, media?.formats ?? [])
  const canUseCreditForFree = !paid && creditBalance > 0
  const initial = !media && !busy && !error

  return (
    <div className="app-shell" key={language}>
      <Header
        onDonate={() => setShowDonate(true)}
        credits={creditBalance}
        email={auth?.email ?? null}
        onLogin={() => setShowAuth(true)}
        onLogout={handleLogout}
      />

      <main className="main-content">
        <section className="hero-section">
          <h1>{t('hero.title')}</h1>
          <p>{t('hero.subtitle')}</p>

          <div className="url-box">
            <input
              id="url-input"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t('hero.urlPlaceholder')}
              onKeyDown={(e) => { if (e.key === 'Enter' && url) inspect() }}
            />
            <button className="primary-btn" onClick={inspect} disabled={busy || !url}>
              {t('hero.analyze')}
            </button>
          </div>

          <div className="voucher-box">
            <input
              value={voucherCode}
              onChange={(e) => setVoucherCode(e.target.value)}
              placeholder={t('hero.voucherPlaceholder')}
              onKeyDown={(e) => { if (e.key === 'Enter') redeemVoucher() }}
            />
            <button className="secondary-btn" onClick={redeemVoucher} disabled={redeeming || !voucherCode.trim()}>
              {t('hero.redeem')}
            </button>
          </div>
        </section>

        {error && <div className="error-banner"><span>⚠️</span>{error}</div>}
        {success && <div className="success-banner"><span>✅</span>{success}</div>}
        <RestrictionsNotice />

        {(media || busy) && (
          <section className="workspace">
            <div className="panel preview-panel">
              <div className="panel-header">
                <span className="panel-title">{t('preview.title')}</span>
                <span className="panel-subtitle">{media?.extractor ?? 'YouTube'}</span>
              </div>
              <div className="panel-body">
                <div className="preview-player">
                  {media?.thumbnail ? <img src={media.thumbnail} alt={media.title} /> : <VideoPlaceholder />}
                </div>
                {media && (
                  <div className="preview-info">
                    <h2>{media.title}</h2>
                    <div className="preview-meta">
                      <span className="channel-avatar">{(media.uploader ?? '?').charAt(0).toUpperCase()}</span>
                      <span>{media.uploader ?? t('preview.unknownChannel')}</span>
                      {media.duration ? <span>• {Math.round(media.duration / 60)} {t('preview.min')}</span> : null}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="panel control-panel">
              <div className="panel-header">
                <span className="panel-title">{t('controls.title')}</span>
                <span className="panel-subtitle">{status}</span>
              </div>
              <div className="panel-body">
                <div className="form-group">
                  <label>{t('controls.videoFormat')}</label>
                  <select className="form-select" value={format} onChange={(e) => { setFormat(e.target.value); setUseCredit(false) }}>
                    <option value={BEST_MP4}>{t('controls.bestQuality')}</option>
                    {usableFormats.slice(0, 30).map((item) => {
                      const itemPaid = !audio && (item.height ?? 0) > 720
                      return (
                        <option key={item.formatId} value={item.formatId!}>
                          {t('controls.optionLabel', {
                            height: item.height ?? '',
                            ext: item.ext ?? '',
                            size: item.filesize ? `(${formatBytes(item.filesize)})` : '',
                            tag: itemPaid ? t('controls.creditTag') : t('controls.freeTag')
                          })}
                        </option>
                      )
                    })}
                  </select>
                </div>

                <label className="toggle-row">
                  <input type="checkbox" checked={audio} onChange={(e) => setAudio(e.target.checked)} />
                  <span>{t('controls.audioOnly')}</span>
                </label>

                {canUseCreditForFree && (
                  <label className="toggle-row credit-toggle">
                    <input type="checkbox" checked={useCredit} onChange={(e) => setUseCredit(e.target.checked)} />
                    <span>{t('controls.useCredit')}</span>
                  </label>
                )}

                {paid && (
                  <div className="credit-needed">
                    <span>🔒</span>
                    <span>{t('controls.creditNeeded', { balance: creditBalance })}</span>
                  </div>
                )}

                {media?.isLive && <LivestreamNotice />}

                <button className="primary-btn" onClick={download} disabled={busy || !url || media?.isLive} style={{ width: '100%', marginTop: 20, height: 48 }}>
                  {busy ? t('controls.processing') : paid || useCredit ? t('controls.downloadWithCredit') : t('controls.downloadFree')}
                </button>
              </div>
            </div>
          </section>
        )}

        {busy && <ProgressPanel progress={progress} isAudio={audio} onCancel={cancelJob} cancelling={cancelling} />}

        {media && <DonationCompact config={config} />}

        {initial && (
          <>
            <HowItWorks />
            <DonationBanner config={config} />
            <PricingCards config={config} onDonate={() => setShowDonate(true)} />
            <WhyUse />
            <FAQ />
          </>
        )}
      </main>

      <Footer />

      {showDonate && <DonateModal config={config} onClose={() => setShowDonate(false)} />}
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} onLogin={handleLogin} />}
    </div>
  )
}

export default App
