import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { translations, type Language } from './translations'

export type { Language }

const STORAGE_KEY = 'st_language'

function detectLanguage(): Language {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved === 'pt' || saved === 'en' || saved === 'es') return saved
  const nav = navigator.language.toLowerCase()
  if (nav.startsWith('pt')) return 'pt'
  if (nav.startsWith('es')) return 'es'
  return 'en'
}

let currentLanguage: Language = typeof window === 'undefined' ? 'pt' : detectLanguage()
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

export function getLanguage(): Language {
  return currentLanguage
}

export function setLanguage(lang: Language) {
  currentLanguage = lang
  localStorage.setItem(STORAGE_KEY, lang)
  document.documentElement.lang = lang === 'pt' ? 'pt-BR' : lang === 'es' ? 'es' : 'en'
  notify()
}

function lookup(key: string, lang: Language): unknown {
  const dict = translations[lang] as Record<string, unknown>
  let value: unknown = dict
  for (const part of key.split('.')) {
    if (value && typeof value === 'object' && part in value) {
      value = (value as Record<string, unknown>)[part]
    } else {
      return undefined
    }
  }
  return value
}

export function t(key: string, vars: Record<string, string | number> = {}): string {
  let value = lookup(key, currentLanguage)
  let text = typeof value === 'string' ? value : ''
  if (!text) {
    const fallback = lookup(key, 'pt')
    text = typeof fallback === 'string' ? fallback : key
  }
  return text.replace(/\{\{(\w+)\}\}/g, (_match, name) => {
    if (name === 'count') {
      return String(vars.count ?? 0)
    }
    return String(vars[name] ?? '')
  })
}

export function tPlural(key: string, count: number, vars: Record<string, string | number> = {}): string {
  const base = lookup(key, currentLanguage)
  const baseText = typeof base === 'string' ? base : ''
  const plural = lookup(`${key}_plural`, currentLanguage)
  const pluralText = typeof plural === 'string' ? plural : baseText
  const text = count === 1 ? baseText : pluralText || baseText
  return text.replace(/\{\{(\w+)\}\}/g, (_match, name) => String(vars[name] ?? (name === 'count' ? count : '')))
}

export function useLanguage(): { language: Language; setLanguage: (lang: Language) => void } {
  const language = useSyncExternalStore(
    (callback) => {
      listeners.add(callback)
      return () => { listeners.delete(callback) }
    },
    () => currentLanguage,
    () => 'pt' as Language
  )

  useEffect(() => {
    document.documentElement.lang = language === 'pt' ? 'pt-BR' : language === 'es' ? 'es' : 'en'
  }, [language])

  const change = useCallback((lang: Language) => {
    setLanguage(lang)
  }, [])

  return { language, setLanguage: change }
}

export function tArray(key: string): string[] {
  const value = t(key)
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) return parsed as string[]
  } catch { }
  return []
}

export function tRaw(key: string): unknown {
  let value = lookup(key, currentLanguage)
  if (value !== undefined) return value
  return lookup(key, 'pt')
}

export function useT() {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const handler = () => setTick((t) => t + 1)
    listeners.add(handler)
    return () => { listeners.delete(handler) }
  }, [])
  return { t, tPlural, tick }
}

export function formatCurrency(value: number, symbol: string): string {
  const formatted = value.toFixed(2)
  if (symbol === 'R$') return `${symbol} ${formatted.replace('.', ',')}`
  return `${symbol}${formatted}`
}

export function regionFromLanguage(lang?: Language): 'BR' | 'default' {
  const l = lang ?? currentLanguage
  return l === 'pt' ? 'BR' : 'default'
}
