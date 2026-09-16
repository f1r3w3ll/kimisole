import { useEffect, useState } from 'react'
import { t, useLanguage, type Language } from './i18n'

type Voucher = { code: string; credits: number; redeemed: boolean; redeemedAt?: string; createdAt: string }
type DonationMethod = { id: string; name: string; type: 'pix' | 'paypal' | 'stripe' | 'crypto' | 'link' | 'qrcode'; value: string; active: boolean; region?: 'BR' | 'default' | 'all' }
type RegionConfig = { currency: string; symbol: string; creditPrice: number; whatsapp?: string; donations: DonationMethod[] }
type Config = { regions: Record<'BR' | 'default', RegionConfig>; exchangeRate?: number }

async function safeFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init)
  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    const text = await res.text()
    throw new Error(text.startsWith('<!DOCTYPE') || text.startsWith('<html')
      ? t('admin.errors.html')
      : `${t('admin.errors.unexpected')}: ${text.slice(0, 100)}`)
  }
  return res
}

function Admin() {
  const { language } = useLanguage()
  const [password, setPassword] = useState('')
  const [token, setToken] = useState(localStorage.getItem('st_admin_token') ?? '')
  const [error, setError] = useState('')
  const [vouchers, setVouchers] = useState<Voucher[]>([])
  const [amount, setAmount] = useState(5)
  const [credits, setCredits] = useState(1)
  const [generated, setGenerated] = useState<Voucher[]>([])
  const [config, setConfig] = useState<Config>({ exchangeRate: 0.18, regions: { BR: { currency: 'BRL', symbol: 'R$', creditPrice: 1.3, donations: [] }, default: { currency: 'USD', symbol: 'US$', creditPrice: 0.25, donations: [] } } })
  const [activeRegion, setActiveRegion] = useState<'BR' | 'default'>(regionFromLanguage(language))
  const [stats, setStats] = useState<any>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (token) {
      fetchData()
    }
  }, [token])

  function regionFromLanguage(lang?: Language): 'BR' | 'default' {
    const l = lang ?? language
    return l === 'pt' ? 'BR' : 'default'
  }

  async function fetchData() {
    setLoading(true)
    setError('')
    try {
      const [vRes, cRes, sRes] = await Promise.all([
        safeFetch('/api/admin/vouchers', { headers: { authorization: `Bearer ${token}` } }),
        safeFetch('/api/admin/config', { headers: { authorization: `Bearer ${token}` } }).catch(() => null),
        safeFetch('/api/admin/stats', { headers: { authorization: `Bearer ${token}` } })
      ])
      if (!vRes.ok) throw new Error(t('admin.errors.session'))
      const vData = await vRes.json()
      setVouchers(vData.vouchers)
      if (cRes) {
        const cData = await cRes.json()
        if (cData.regions) setConfig({ exchangeRate: cData.exchangeRate ?? 0.18, regions: cData.regions })
      }
      const sData = await sRes.json()
      setStats(sData)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('admin.errors.load'))
      setToken('')
      localStorage.removeItem('st_admin_token')
    } finally {
      setLoading(false)
    }
  }

  async function login() {
    setError('')
    try {
      const res = await safeFetch('/api/admin/vouchers', { headers: { authorization: `Bearer ${password}` } })
      if (res.ok) {
        setToken(password)
        localStorage.setItem('st_admin_token', password)
      } else {
        setError(t('admin.wrongPassword'))
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('admin.errors.login'))
    }
  }

  async function generate() {
    setError(''); setGenerated([])
    try {
      const res = await safeFetch('/api/admin/vouchers', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ amount: Number(amount), credits: Number(credits) })
      })
      const data = await res.json()
      if (!res.ok) return setError(data.error || t('admin.errors.generate'))
      setGenerated(data.vouchers)
      fetchData()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('admin.errors.generate'))
    }
  }

  async function saveConfig() {
    setError('')
    try {
      const res = await safeFetch('/api/admin/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ exchangeRate: config.exchangeRate, regions: config.regions })
      })
      if (!res.ok) return setError(t('admin.errors.save'))
      alert(t('admin.config.saved'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('admin.errors.save'))
    }
  }

  function updateRegion(field: keyof RegionConfig, value: unknown) {
    setConfig((prev) => ({
      regions: {
        ...prev.regions,
        [activeRegion]: { ...prev.regions[activeRegion], [field]: value }
      }
    }))
  }

  function updateDonation(index: number, field: keyof DonationMethod, value: string | boolean) {
    const next = [...config.regions[activeRegion].donations]
    next[index] = { ...next[index], [field]: value }
    updateRegion('donations', next)
  }

  function addDonation() {
    const next = [...config.regions[activeRegion].donations, { id: crypto.randomUUID(), name: '', type: 'paypal' as const, value: '', active: true, region: activeRegion }]
    updateRegion('donations', next)
  }

  function removeDonation(index: number) {
    const next = [...config.regions[activeRegion].donations]
    next.splice(index, 1)
    updateRegion('donations', next)
  }

  if (!token) {
    return (
      <div className="admin-login">
        <div className="admin-box">
          <h1>{t('admin.title')}</h1>
          <input
            type="password"
            placeholder={t('admin.passwordPlaceholder')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') login() }}
          />
          <button className="primary-btn" onClick={login} style={{ width: '100%' }}>{t('admin.login')}</button>
          {error && <p className="admin-error">{error}</p>}
        </div>
      </div>
    )
  }

  const regionCfg = config.regions[activeRegion]

  return (
    <div className="admin-shell" key={language}>
      <header className="admin-header">
        <h1>{t('admin.title')}</h1>
        <button className="secondary-btn" onClick={() => { setToken(''); localStorage.removeItem('st_admin_token') }}>{t('admin.logout')}</button>
      </header>

      <main className="admin-main">
        {loading && <p className="admin-loading">{t('admin.loading')}</p>}
        {error && <p className="admin-error">{error}</p>}

        <section className="admin-section">
          <h2>{t('admin.stats.title')}</h2>
          <div className="admin-stats">
            <div className="admin-stat"><span>{t('admin.stats.created')}</span><strong>{vouchers.length}</strong></div>
            <div className="admin-stat"><span>{t('admin.stats.redeemed')}</span><strong>{vouchers.filter((v) => v.redeemed).length}</strong></div>
            <div className="admin-stat"><span>{t('admin.stats.freeToday')}</span><strong>{Object.values(stats.usage || {}).reduce((a: number, u: any) => a + (u.freeDownloads || 0), 0)}</strong></div>
          </div>
        </section>

        <section className="admin-section">
          <h2>{t('admin.generate.title')}</h2>
          <div className="admin-form-row">
            <label>
              {t('admin.generate.amount')}
              <input type="number" min={1} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
            </label>
            <label>
              {t('admin.generate.credits')}
              <input type="number" min={1} value={credits} onChange={(e) => setCredits(Number(e.target.value))} />
            </label>
            <button className="primary-btn" onClick={generate}>{t('admin.generate.button')}</button>
          </div>
          {generated.length > 0 && (
            <div className="admin-generated">
              <h4>{t('admin.generate.generated')}</h4>
              <ul>
                {generated.map((v) => <li key={v.code}><code>{v.code}</code> — {v.credits} crédito(s)</li>)}
              </ul>
              <button className="secondary-btn" onClick={() => navigator.clipboard.writeText(generated.map((v) => v.code).join('\n'))}>{t('admin.generate.copyAll')}</button>
            </div>
          )}
        </section>

        <section className="admin-section">
          <h2>{t('admin.vouchers.title')}</h2>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr><th>{t('admin.vouchers.code')}</th><th>{t('admin.vouchers.credits')}</th><th>{t('admin.vouchers.status')}</th><th>{t('admin.vouchers.date')}</th></tr>
              </thead>
              <tbody>
                {vouchers.slice().reverse().map((v) => (
                  <tr key={v.code} className={v.redeemed ? 'redeemed' : ''}>
                    <td><code>{v.code}</code></td>
                    <td>{v.credits}</td>
                    <td>{v.redeemed ? t('admin.vouchers.redeemed', { date: new Date(v.redeemedAt || '').toLocaleDateString() }) : t('admin.vouchers.active')}</td>
                    <td>{new Date(v.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="admin-section">
          <h2>{t('admin.config.title')}</h2>

          <div className="admin-form-row">
            <label>
              {t('admin.config.exchangeRate')}
              <input
                type="number"
                step="0.001"
                min={0.001}
                value={config.exchangeRate ?? 0.18}
                onChange={(e) => setConfig((prev) => ({ ...prev, exchangeRate: Number(e.target.value) }))}
              />
            </label>
            <label>
              {t('admin.config.defaultPricePreview')}
              <input type="text" readOnly value={`US$ ${((config.regions.BR?.creditPrice ?? 1.3) * (config.exchangeRate ?? 0.18)).toFixed(2)}`} />
            </label>
          </div>

          <div className="admin-form-row">
            <label>
              {t('admin.config.region')}
              <select value={activeRegion} onChange={(e) => setActiveRegion(e.target.value as 'BR' | 'default')}>
                <option value="BR">{t('admin.config.regions.BR')}</option>
                <option value="default">{t('admin.config.regions.default')}</option>
              </select>
            </label>
            <label>
              {t('admin.config.creditPrice', { currency: regionCfg.currency })}
              <input type="number" step="0.01" value={regionCfg.creditPrice} onChange={(e) => updateRegion('creditPrice', Number(e.target.value))} />
            </label>
            <label>
              {t('admin.config.whatsapp')}
              <input type="text" value={regionCfg.whatsapp || ''} onChange={(e) => updateRegion('whatsapp', e.target.value)} placeholder="5511999999999" />
            </label>
          </div>

          <h3>{t('admin.config.methodsTitle')}</h3>
          {regionCfg.donations.map((d, i) => (
            <div key={d.id} className="admin-donation-row">
              <input value={d.name} onChange={(e) => updateDonation(i, 'name', e.target.value)} placeholder={t('admin.config.namePlaceholder')} />
              <select value={d.type} onChange={(e) => updateDonation(i, 'type', e.target.value)}>
                <option value="pix">Pix</option>
                <option value="paypal">PayPal</option>
                <option value="stripe">Stripe</option>
                <option value="crypto">Crypto</option>
                <option value="link">{t('admin.config.types.link')}</option>
                <option value="qrcode">{t('admin.config.types.qrcode')}</option>
              </select>
              <select value={d.region || activeRegion} onChange={(e) => updateDonation(i, 'region', e.target.value)}>
                <option value="BR">{t('admin.config.regions.BR')}</option>
                <option value="default">{t('admin.config.regions.default')}</option>
                <option value="all">{t('admin.config.regions.all')}</option>
              </select>
              <input value={d.value} onChange={(e) => updateDonation(i, 'value', e.target.value)} placeholder={t('admin.config.valuePlaceholder')} />
              <label className="admin-check">
                <input type="checkbox" checked={d.active} onChange={(e) => updateDonation(i, 'active', e.target.checked)} /> {t('admin.config.active')}
              </label>
              <button className="secondary-btn" onClick={() => removeDonation(i)}>{t('admin.config.remove')}</button>
            </div>
          ))}
          <button className="secondary-btn" onClick={addDonation}>{t('admin.config.add')}</button>
          <button className="primary-btn" onClick={saveConfig} style={{ marginLeft: 12 }}>{t('admin.config.save')}</button>
        </section>

        <section className="admin-section">
          <h2>{t('admin.cookies.title')}</h2>
          <p className="modal-hint" style={{ textAlign: 'left', marginBottom: 12 }}>
            {t('admin.cookies.description')}
          </p>
          <CookiesSection token={token} />
        </section>
      </main>
    </div>
  )
}

function CookiesSection({ token }: { token: string }) {
  const [status, setStatus] = useState<{ exists: boolean; size: number; active: boolean } | null>(null)
  const [loading, setLoading] = useState(false)
  const [output, setOutput] = useState('')

  async function fetchStatus() {
    try {
      const res = await safeFetch('/api/admin/cookies-status', { headers: { authorization: `Bearer ${token}` } })
      const data = await res.json()
      setStatus(data)
    } catch {
      setStatus(null)
    }
  }

  useEffect(() => {
    fetchStatus()
  }, [])

  async function refresh() {
    setLoading(true); setOutput('')
    try {
      const res = await safeFetch('/api/admin/refresh-cookies', { method: 'POST', headers: { authorization: `Bearer ${token}` } })
      const data = await res.json()
      setOutput(data.output || data.error || '')
      fetchStatus()
    } catch (cause) {
      setOutput(cause instanceof Error ? cause.message : t('admin.cookies.error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      {status && (
        <p className="modal-hint" style={{ textAlign: 'left' }}>
          {status.active ? t('admin.cookies.active', { size: status.size }) : t('admin.cookies.inactive', { size: status.size })}
        </p>
      )}
      <button className="primary-btn" onClick={refresh} disabled={loading}>{loading ? t('admin.cookies.updating') : t('admin.cookies.refresh')}</button>
      {output && <pre className="admin-output">{output}</pre>}
    </div>
  )
}

export default Admin
