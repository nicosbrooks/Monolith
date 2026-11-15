import { create } from 'zustand'
import { useStore } from '../store'

// What this browser can tell the assistant, each one off until it's turned on in Settings › Integrations.
// Mirrors the iPhone's Location and Weather. Position is rounded to about a kilometre before it leaves the
// browser, and only goes to the two lookups below: Open-Meteo (forecast) and BigDataCloud (town name).
// Neither needs an account or a key.

export type Integration = 'location' | 'weather'

export interface Weather { temp: number; high: number; low: number; rain: number; sky: string; unit: '°F' | '°C' }
interface State {
  place: string | null
  weather: Weather | null
  updatedAt: number
  status: 'idle' | 'locating' | 'ready' | 'denied' | 'failed'
}
export const useDevice = create<State>(() => ({ place: null, weather: null, updatedAt: 0, status: 'idle' }))

export const isOn = (k: Integration) => !!useStore.getState().settings.integrations?.includes(k)

export function setIntegration(k: Integration, on: boolean) {
  const cur = new Set(useStore.getState().settings.integrations ?? [])
  if (on) cur.add(k)
  else cur.delete(k)
  // Weather needs to know where you are.
  if (on && k === 'weather') cur.add('location')
  if (!on && k === 'location') cur.delete('weather')
  useStore.getState().setSettings({ integrations: [...cur] })
  if (!cur.size) useDevice.setState({ place: null, weather: null, updatedAt: 0, status: 'idle' })
  if (on) void refreshDevice(true)
  else if (k === 'weather') useDevice.setState({ weather: null })
}

const SKY: [number, string][] = [
  [0, 'clear'], [1, 'mostly clear'], [2, 'partly cloudy'], [3, 'cloudy'], [45, 'foggy'], [48, 'foggy'],
  [51, 'light drizzle'], [53, 'drizzle'], [55, 'heavy drizzle'], [61, 'light rain'], [63, 'rain'], [65, 'heavy rain'],
  [66, 'freezing rain'], [67, 'freezing rain'], [71, 'light snow'], [73, 'snow'], [75, 'heavy snow'], [77, 'snow'],
  [80, 'showers'], [81, 'showers'], [82, 'heavy showers'], [85, 'snow showers'], [86, 'snow showers'],
  [95, 'thunderstorms'], [96, 'thunderstorms with hail'], [99, 'thunderstorms with hail'],
]
const sky = (code: number) => SKY.find(([c]) => c === code)?.[1] ?? 'mixed'
const fahrenheit = () => /^en-(US|LR|MM)\b/.test(navigator.language) || ['US', 'LR', 'MM'].includes(new Intl.Locale(navigator.language).region ?? '')

const position = () =>
  new Promise<GeolocationPosition>((ok, fail) => navigator.geolocation.getCurrentPosition(ok, fail, { maximumAge: 15 * 60_000, timeout: 15_000 }))

let inflight: Promise<void> | null = null
/** Fresh place and weather, at most every ten minutes unless forced. */
export function refreshDevice(force = false): Promise<void> {
  if (!isOn('location') || !('geolocation' in navigator)) return Promise.resolve()
  if (!force && Date.now() - useDevice.getState().updatedAt < 10 * 60_000) return Promise.resolve()
  inflight ??= (async () => {
    useDevice.setState({ status: 'locating' })
    try {
      const p = await position()
      const lat = p.coords.latitude.toFixed(2)
      const lon = p.coords.longitude.toFixed(2)
      const [place, weather] = await Promise.all([
        fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`, { signal: AbortSignal.timeout(8000) })
          .then((r) => r.json())
          .then((j) => [j.city || j.locality, j.principalSubdivision || j.countryName].filter(Boolean).join(', ') || null)
          .catch(() => null),
        isOn('weather') ? forecast(lat, lon).catch(() => null) : Promise.resolve(null),
      ])
      useDevice.setState({ place, weather, updatedAt: Date.now(), status: 'ready' })
    } catch (e) {
      useDevice.setState({ status: (e as GeolocationPositionError)?.code === 1 ? 'denied' : 'failed' })
    } finally {
      inflight = null
    }
  })()
  return inflight
}

async function forecast(lat: string, lon: string): Promise<Weather> {
  const f = fahrenheit()
  const r = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1${f ? '&temperature_unit=fahrenheit' : ''}`,
    { signal: AbortSignal.timeout(8000) },
  )
  const j = await r.json()
  return {
    temp: Math.round(j.current.temperature_2m),
    sky: sky(j.current.weather_code),
    high: Math.round(j.daily.temperature_2m_max[0]),
    low: Math.round(j.daily.temperature_2m_min[0]),
    rain: Math.round(j.daily.precipitation_probability_max[0] ?? 0),
    unit: f ? '°F' : '°C',
  }
}

/** "Near Lisbon, Lisbon · 18°C and clear" for Settings. */
export function deviceSummary() {
  const s = useDevice.getState()
  return [s.place && `Near ${s.place}`, s.weather && `${s.weather.temp}${s.weather.unit} and ${s.weather.sky}`].filter(Boolean).join(' · ')
}

/** What the turned-on integrations know, for the assistant. Empty when none are on. */
export function deviceContext() {
  const s = useDevice.getState()
  const lines: string[] = []
  if (isOn('location') && s.place) lines.push(`Location: near ${s.place}`)
  if (isOn('weather') && s.weather) {
    const w = s.weather
    lines.push(`Weather now: ${w.temp}${w.unit}, ${w.sky}. Today: high ${w.high}${w.unit}, low ${w.low}${w.unit}, ${w.rain}% chance of rain.`)
  }
  return lines.join('\n')
}
