export type Settings = {
  base_timezone: string
  timezones: string[]
  tz_aliases?: Record<string, string>
}

export type SettingsResponse = {
  settings: Settings
}

export type TimezonesResponse = {
  timezones: string[]
}

export type SlotPerTimezone = {
  timezone: string
  local_iso: string
  local_label: string
  is_working: boolean
}

export type Slot = {
  index: number
  instant_iso: string
  base_label: string
  per_timezone: SlotPerTimezone[]
  perfect_overlap: boolean
  working_count: number
}

export type SlotsResponse = {
  date: string
  base_timezone: string
  timezones: string[]
  slots: Slot[]
  summary: {
    perfect_overlap_slots: number
    best_slot: {
      index: number | null
      base_label: string | null
      working_count: number
      total: number
    }
    best_slot_expanded_window: {
      index: number | null
      base_label: string | null
      within_0700_2100_count: number
      total: number
    }
  }
}

type UpdateTimezonesRequest = {
  base_timezone?: string
  timezones: string[]
  tz_aliases?: Record<string, string>
}

function apiOrigin(): string {
  const raw = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim()
  if (!raw) return ''
  return raw.endsWith('/') ? raw.slice(0, -1) : raw
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${apiOrigin()}${path}`
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${res.status} ${res.statusText}${text ? `: ${text}` : ''}`)
  }

  return (await res.json()) as T
}

export async function getSettings(): Promise<Settings> {
  const res = await apiFetch<SettingsResponse>('/api/settings')
  return res.settings
}

export async function updateTimezones(req: UpdateTimezonesRequest): Promise<Settings> {
  const res = await apiFetch<SettingsResponse>('/api/settings/timezones', {
    method: 'POST',
    body: JSON.stringify(req),
  })
  return res.settings
}

export async function searchTimezones(q: string, limit = 20): Promise<string[]> {
  const params = new URLSearchParams({ q, limit: String(limit) })
  const res = await apiFetch<TimezonesResponse>(`/api/timezones?${params.toString()}`)
  return res.timezones
}

export async function listTimezones(limit = 500): Promise<string[]> {
  const params = new URLSearchParams({ limit: String(limit) })
  const res = await apiFetch<TimezonesResponse>(`/api/timezones?${params.toString()}`)
  return res.timezones
}

export async function getSlots(dayIso: string): Promise<SlotsResponse> {
  const params = new URLSearchParams({ day: dayIso })
  return await apiFetch<SlotsResponse>(`/api/slots?${params.toString()}`)
}
