import './App.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Settings, SlotsResponse } from './api'
import { getSettings, getSlots, listTimezones, updateTimezones } from './api'

function tzLabel(tz: string): string {
  return tz.replaceAll('_', ' ')
}

function loadTzAliases(): Record<string, string> {
  try {
    const raw = localStorage.getItem('tzAliases')
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof k === 'string' && typeof v === 'string') out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

function saveTzAliases(value: Record<string, string>): void {
  try {
    localStorage.setItem('tzAliases', JSON.stringify(value))
  } catch {
    // ignore
  }
}

function isoDateInTimeZone(d: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)

  const get = (type: string) => parts.find((p) => p.type === type)?.value
  const y = get('year')
  const m = get('month')
  const day = get('day')

  if (!y || !m || !day) return new Date().toISOString().slice(0, 10)
  return `${y}-${m}-${day}`
}

function minutesInTimeZone(d: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)

  const get = (type: string) => parts.find((p) => p.type === type)?.value
  const hh = Number(get('hour') ?? '0')
  const mm = Number(get('minute') ?? '0')
  return hh * 60 + mm
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function minutesFromLocalIso(localIso: string): number | null {
  const m = /T(\d{2}):(\d{2})/.exec(localIso)
  if (!m) return null
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null
  return hh * 60 + mm
}

function isWithinExpandedWindow(localIso: string): boolean {
  const mins = minutesFromLocalIso(localIso)
  if (mins == null) return false
  return mins >= 7 * 60 && mins < 21 * 60
}

const DEFAULT_PINNED_TIMEZONES = [
  'Asia/Shanghai',
  'America/Los_Angeles',
  'America/New_York',
  'Asia/Kolkata',
  'Asia/Jerusalem',
]

function App() {
  const [settings, setSettings] = useState<Settings | null>(null)

  const [dayIso, setDayIso] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [slotsResp, setSlotsResp] = useState<SlotsResponse | null>(null)

  const [selectedSlotIndex, setSelectedSlotIndex] = useState<number | null>(null)
  const [activeSlotIndex, setActiveSlotIndex] = useState<number | null>(null)

  const [tzDropdownOpen, setTzDropdownOpen] = useState(false)
  const [allTimezones, setAllTimezones] = useState<string[]>([])
  const [loadingTimezones, setLoadingTimezones] = useState(false)

  const [tzAliases, setTzAliases] = useState<Record<string, string>>(() => loadTzAliases())
  const [editingTz, setEditingTz] = useState<string | null>(null)
  const [editingLabel, setEditingLabel] = useState('')
  const [openTzMenu, setOpenTzMenu] = useState<string | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [loadingSettings, setLoadingSettings] = useState(false)
  const [updatingTimezones, setUpdatingTimezones] = useState(false)

  const gridWrapRef = useRef<HTMLDivElement | null>(null)
  const didSyncAliasesRef = useRef(false)

  const baseTz = settings?.base_timezone ?? 'Asia/Shanghai'
  const baseTodayIso = useMemo(() => isoDateInTimeZone(new Date(), baseTz), [baseTz])
  const isTodayInBase = dayIso === baseTodayIso

  const tzDisplay = useMemo(() => {
    return (tz: string) => {
      const custom = tzAliases[tz]?.trim()
      return custom ? custom : tzLabel(tz)
    }
  }, [tzAliases])

  const currentSlotIndex = useMemo(() => {
    if (!isTodayInBase) return null
    const mins = minutesInTimeZone(new Date(), baseTz)
    return clamp(Math.floor(mins / 30), 0, 47)
  }, [baseTz, isTodayInBase])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoadingSettings(true)
      setError(null)
      try {
        const s = await getSettings()
        if (cancelled) return
        setSettings(s)
        setDayIso(isoDateInTimeZone(new Date(), s.base_timezone))
        const serverAliases = (s.tz_aliases ?? {}) as Record<string, string>
        if (serverAliases && Object.keys(serverAliases).length > 0) {
          setTzAliases((prev) => ({ ...prev, ...serverAliases }))
        }
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoadingSettings(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!settings) return
    let cancelled = false

    async function loadSlots() {
      setLoadingSlots(true)
      setError(null)
      try {
        const resp = await getSlots(dayIso)
        if (cancelled) return
        setSlotsResp(resp)
        setSelectedSlotIndex((prev) => {
          if (prev == null) return currentSlotIndex
          return clamp(prev, 0, (resp.slots?.length ?? 48) - 1)
        })
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoadingSlots(false)
      }
    }

    void loadSlots()
    return () => {
      cancelled = true
    }
  }, [settings, dayIso, currentSlotIndex])

  useEffect(() => {
    if (!settings) return
    const id = window.setInterval(() => {
      if (dayIso !== isoDateInTimeZone(new Date(), settings.base_timezone)) return
      void getSlots(dayIso)
        .then((resp) => setSlotsResp(resp))
        .catch(() => {
          // ignore background refresh errors; user-initiated actions surface errors
        })
    }, 60_000)
    return () => window.clearInterval(id)
  }, [dayIso, settings])

  useEffect(() => {
    saveTzAliases(tzAliases)
  }, [tzAliases])

  useEffect(() => {
    if (!settings) return
    if (didSyncAliasesRef.current) return

    const serverAliases = settings.tz_aliases ?? {}
    const hasServerAliases = Object.keys(serverAliases).length > 0
    const hasLocalAliases = Object.keys(tzAliases).length > 0

    // If aliases only exist locally (often due to localhost vs 127.0.0.1 origin change),
    // push them once to backend so they persist across reloads and origins.
    if (!hasServerAliases && hasLocalAliases) {
      didSyncAliasesRef.current = true
      void updateTimezones({
        base_timezone: settings.base_timezone,
        timezones: settings.timezones,
        tz_aliases: tzAliases,
      })
        .then((updated) => {
          setSettings(updated)
          if (updated.tz_aliases) setTzAliases(updated.tz_aliases)
        })
        .catch(() => {
          // ignore: keep local aliases as fallback
        })
      return
    }

    if (hasServerAliases) didSyncAliasesRef.current = true
  }, [settings, tzAliases])

  useEffect(() => {
    let cancelled = false
    async function loadAll() {
      setLoadingTimezones(true)
      try {
        const tzs = await listTimezones(500)
        if (cancelled) return
        setAllTimezones(tzs)
      } catch {
        if (cancelled) return
        setAllTimezones([])
      } finally {
        if (!cancelled) setLoadingTimezones(false)
      }
    }

    void loadAll()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!tzDropdownOpen) return

    const onDocDown = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null
      if (!target?.closest?.('[data-tz-search]')) {
        setTzDropdownOpen(false)
      }
    }

    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [tzDropdownOpen])

  useEffect(() => {
    if (!openTzMenu) return

    const onDocDown = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null
      if (!target?.closest?.('[data-tz-menu-root]')) {
        setOpenTzMenu(null)
      }
    }

    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [openTzMenu])

  const slots = slotsResp?.slots ?? []
  const timezones = settings?.timezones ?? []
  const selectedSlot = selectedSlotIndex != null ? slots.find((s) => s.index === selectedSlotIndex) ?? null : null
  const highlightIndex = activeSlotIndex ?? selectedSlotIndex

  const timezonePickerList = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []

    for (const tz of DEFAULT_PINNED_TIMEZONES) {
      if (!seen.has(tz)) {
        seen.add(tz)
        out.push(tz)
      }
    }

    for (const tz of allTimezones) {
      if (!seen.has(tz)) {
        seen.add(tz)
        out.push(tz)
      }
    }

    return out
  }, [allTimezones])

  const summaryText = useMemo(() => {
    const s = slotsResp?.summary
    if (!s) return null
    const best = s.best_slot
    const bestExpanded = s.best_slot_expanded_window
    return {
      perfect: s.perfect_overlap_slots,
      best: best.base_label ? `${best.base_label} (${best.working_count}/${best.total})` : null,
      bestExpanded: bestExpanded.base_label
        ? `${bestExpanded.base_label} (${bestExpanded.within_0700_2100_count}/${bestExpanded.total})`
        : null,
    }
  }, [slotsResp])

  const expandedBestIndex = slotsResp?.summary?.best_slot_expanded_window?.index ?? null

  useEffect(() => {
    if (!gridWrapRef.current) return
    if (currentSlotIndex == null) return
    if (slots.length === 0) return

    // Outlook-like: focus the current time row.
    const ROW_H = 42
    const HEADER_H = 42
    const targetTop = Math.max(0, HEADER_H + currentSlotIndex * ROW_H - 6 * ROW_H)
    gridWrapRef.current.scrollTo({ top: targetTop, behavior: 'smooth' })
  }, [currentSlotIndex, slots.length])

  function shiftDay(deltaDays: number) {
    const [y, m, d] = dayIso.split('-').map((v) => Number(v))
    const utc = new Date(Date.UTC(y, m - 1, d, 0, 0, 0))
    utc.setUTCDate(utc.getUTCDate() + deltaDays)
    setDayIso(utc.toISOString().slice(0, 10))
  }

  async function applyTimezones(nextTimezones: string[]) {
    if (!settings) return
    setUpdatingTimezones(true)
    setError(null)
    try {
      const nextAliases: Record<string, string> = {}
      for (const tz of nextTimezones) {
        const v = tzAliases[tz]
        if (typeof v === 'string' && v.trim()) nextAliases[tz] = v.trim()
      }
      const updated = await updateTimezones({
        base_timezone: settings.base_timezone,
        timezones: nextTimezones,
        tz_aliases: nextAliases,
      })
      setSettings(updated)
      if (updated.tz_aliases) setTzAliases(updated.tz_aliases)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setUpdatingTimezones(false)
    }
  }

  async function addTimezone(tz: string) {
    if (!settings) return
    const trimmed = tz.trim()
    if (!trimmed) return
    if (settings.timezones.includes(trimmed)) return
    await applyTimezones([...settings.timezones, trimmed])
    setTzDropdownOpen(false)
  }

  async function removeTimezone(tz: string) {
    if (!settings) return
    if (tz === settings.base_timezone) return
    await applyTimezones(settings.timezones.filter((t) => t !== tz))
  }

  function startRename(tz: string) {
    setEditingTz(tz)
    setEditingLabel(tzAliases[tz] ?? tzDisplay(tz))
    setOpenTzMenu(null)
  }

  function cancelRename() {
    setEditingTz(null)
    setEditingLabel('')
  }

  async function saveRename(tz: string) {
    if (!settings) {
      const next = editingLabel.trim()
      setTzAliases((prev) => {
        const copy = { ...prev }
        if (!next || next === tzLabel(tz)) {
          delete copy[tz]
        } else {
          copy[tz] = next
        }
        return copy
      })
      cancelRename()
      return
    }

    const next = editingLabel.trim()
    const nextAliases: Record<string, string> = { ...tzAliases }
    if (!next || next === tzLabel(tz)) {
      delete nextAliases[tz]
    } else {
      nextAliases[tz] = next
    }

    // Keep only aliases for active timezones
    for (const key of Object.keys(nextAliases)) {
      if (!settings.timezones.includes(key)) delete nextAliases[key]
    }

    setTzAliases(nextAliases)
    cancelRename()

    setUpdatingTimezones(true)
    setError(null)
    try {
      const updated = await updateTimezones({
        base_timezone: settings.base_timezone,
        timezones: settings.timezones,
        tz_aliases: nextAliases,
      })
      setSettings(updated)
      if (updated.tz_aliases) setTzAliases(updated.tz_aliases)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setUpdatingTimezones(false)
    }
  }

  return (
    <div className="app" onMouseLeave={() => setActiveSlotIndex(null)}>
      <header className="topbar">
        <div className="brand">
          <div className="brandTitleRow">
            <span className="brandLogo" aria-hidden="true">
              <svg className="logo" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  className="logoPrimary"
                  d="M12 3.25c4.832 0 8.75 3.918 8.75 8.75S16.832 20.75 12 20.75 3.25 16.832 3.25 12 7.168 3.25 12 3.25Z"
                  strokeWidth="1.6"
                />
                <path
                  className="logoSecondary"
                  d="M12 7.2v4.95l3.35 2.05"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  className="logoSecondary"
                  d="M6.1 15.9c.95-1.25 2.45-2.05 4.1-2.05 1.85 0 3.5 1 4.4 2.5"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <div className="brandTitle">AvailableTime</div>
          </div>
          <div className="brandSubtitle">Overlap-friendly meeting slots across timezones</div>
        </div>

        <div className="topControls">
          <div className="dateControls">
            <button className="btn" type="button" onClick={() => shiftDay(-1)} aria-label="Previous day">
              ←
            </button>
            <input
              className="dateInput"
              type="date"
              value={dayIso}
              onChange={(e) => setDayIso(e.target.value)}
              aria-label="Select date"
            />
            <button className="btn" type="button" onClick={() => shiftDay(1)} aria-label="Next day">
              →
            </button>
          </div>

          <div className="tzSearch" data-tz-search>
            <button
              className="btn btnPrimary tzPickerBtn"
              type="button"
              disabled={!settings || updatingTimezones}
              onClick={() => setTzDropdownOpen((v) => !v)}
            >
              Add timezone
            </button>

            {tzDropdownOpen && (
              <div className="tzDropdown" role="listbox">
                <div className="tzSectionTitle">Defaults</div>
                {DEFAULT_PINNED_TIMEZONES.map((tz) => {
                  const disabled = timezones.includes(tz) || updatingTimezones
                  return (
                    <button
                      key={`p-${tz}`}
                      className={disabled ? 'tzOption isDisabled' : 'tzOption'}
                      type="button"
                      disabled={disabled}
                      onClick={() => void addTimezone(tz)}
                      role="option"
                      aria-selected={false}
                    >
                      {tz}
                    </button>
                  )
                })}

                <div className="tzSectionTitle">All timezones</div>
                {loadingTimezones && <div className="tzSectionHint">Loading…</div>}
                {!loadingTimezones && timezonePickerList.length === 0 && (
                  <div className="tzSectionHint">No timezones loaded</div>
                )}
                {timezonePickerList.map((tz) => {
                  const disabled = timezones.includes(tz) || updatingTimezones
                  return (
                    <button
                      key={tz}
                      className={disabled ? 'tzOption isDisabled' : 'tzOption'}
                      type="button"
                      disabled={disabled}
                      onClick={() => void addTimezone(tz)}
                      role="option"
                      aria-selected={false}
                    >
                      {tz}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="layout">
        <section className="gridCard" aria-busy={loadingSlots || loadingSettings}>
          <div className="gridTop">
            <div className="meta">
              <div className="metaLine">
                <span className="metaLabel">Base timezone:</span>
                <span className="metaValue">{tzLabel(baseTz)}</span>
              </div>
              {summaryText && (
                <div className="metaLine">
                  <span className="metaLabel">Perfect overlap:</span>
                  <span className="metaValue">{summaryText.perfect} slots</span>
                  {summaryText.best && (
                    <span className="metaHint">Best: {summaryText.best}</span>
                  )}
                  {summaryText.bestExpanded && (
                    <span className="metaHint">(Expanded 07:00–21:00: {summaryText.bestExpanded})</span>
                  )}
                </div>
              )}
            </div>

            <div className="status">
              {(loadingSettings || loadingSlots) && <span className="pill">Loading…</span>}
              {updatingTimezones && <span className="pill">Saving timezones…</span>}
              {isTodayInBase && <span className="pill">Today in {baseTz}</span>}
            </div>
          </div>

          {error && <div className="error">{error}</div>}

          <div className="gridWrap" ref={gridWrapRef}>
            <div
              className="outlookGrid"
              style={
                {
                  '--cols': String(Math.max(1, timezones.length || 1)),
                  '--rows': String(Math.max(1, slots.length || 48)),
                  '--current-idx': currentSlotIndex == null ? '-1' : String(currentSlotIndex),
                } as React.CSSProperties
              }
            >
              <div className="cell corner stickyBoth">Time</div>
              {timezones.map((tz) => (
                <div key={`th-${tz}`} className="cell header stickyTop">
                  <div className="tzHeader">
                    {editingTz === tz ? (
                      <div className="tzHeaderEdit">
                        <input
                          className="tzRenameInput"
                          value={editingLabel}
                          onChange={(e) => setEditingLabel(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveRename(tz)
                            if (e.key === 'Escape') cancelRename()
                          }}
                          autoFocus
                          aria-label={`Rename ${tz}`}
                        />
                        <button className="linkBtn" type="button" onClick={() => saveRename(tz)}>
                          Save
                        </button>
                        <button className="linkBtn" type="button" onClick={cancelRename}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="tzHeaderMain" data-tz-menu-root>
                        <div className="tzHeaderName" title={tz}>
                          {tzDisplay(tz)}
                        </div>
                        <div className="tzHeaderActions">
                          <button
                            className="tzMenuBtn"
                            type="button"
                            aria-label={`Timezone actions for ${tz}`}
                            title="Actions"
                            onClick={() => setOpenTzMenu((cur) => (cur === tz ? null : tz))}
                          >
                            ⋯
                          </button>
                          {openTzMenu === tz && (
                            <div className="tzMenu" role="menu">
                              <button className="tzMenuItem" type="button" role="menuitem" onClick={() => startRename(tz)}>
                                Rename
                              </button>
                              <button
                                className={tz === baseTz ? 'tzMenuItem isDisabled' : 'tzMenuItem'}
                                type="button"
                                role="menuitem"
                                disabled={tz === baseTz || updatingTimezones}
                                onClick={() => {
                                  setOpenTzMenu(null)
                                  void removeTimezone(tz)
                                }}
                                title={tz === baseTz ? 'Base timezone (cannot remove)' : 'Remove'}
                              >
                                Remove
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {slots.map((s) => {
                const isRowActive = highlightIndex === s.index
                const isRowSelected = selectedSlotIndex === s.index
                const isRowOverlap = s.perfect_overlap
                const isRowSuggested = expandedBestIndex === s.index

                return (
                  <div
                    key={`r-${s.index}`}
                    className={
                      'rowWrap ' +
                      (isRowOverlap ? 'rowOverlap ' : '') +
                      (isRowSuggested ? 'rowSuggested ' : '') +
                      (isRowActive ? 'rowActive ' : '') +
                      (isRowSelected ? 'rowSelected ' : '')
                    }
                    onMouseEnter={() => setActiveSlotIndex(s.index)}
                    onMouseLeave={() => setActiveSlotIndex(null)}
                  >
                    <div className="cell timeCell stickyLeft">
                      <div className="timeLabel">{s.base_label}</div>
                    </div>

                    {timezones.map((tz, colIdx) => {
                      const per = s.per_timezone[colIdx]
                      const isWorking = per?.is_working ?? false
                      const title = per
                        ? `${tz}: ${per.local_label}${isWorking ? '' : ' (outside working hours)'}\nInstant: ${s.instant_iso}`
                        : `${tz}: (missing)`

                      return (
                        <button
                          key={`${tz}-${s.index}`}
                          className={
                            'cell slot ' +
                            (isWorking ? 'isWorking ' : 'isOff ') +
                            (isRowOverlap ? 'isOverlap ' : '') +
                            (isRowSuggested ? 'isSuggested ' : '') +
                            (isRowActive ? 'isActive ' : '') +
                            (isRowSelected ? 'isSelected ' : '')
                          }
                          type="button"
                          title={title}
                          onFocus={() => setActiveSlotIndex(s.index)}
                          onBlur={() => setActiveSlotIndex(null)}
                          onClick={() => setSelectedSlotIndex(s.index)}
                          aria-label={`Select slot ${s.base_label} for ${tz}`}
                        >
                          <span className="slotText">{per?.local_label ?? '—'}</span>
                        </button>
                      )
                    })}
                  </div>
                )
              })}

              {currentSlotIndex != null && isTodayInBase && slots.length > 0 && (
                <div className="nowRowMarker" aria-hidden="true">
                  <div className="nowRowLine" />
                  <div className="nowRowLabel">Now</div>
                </div>
              )}
            </div>
          </div>
        </section>

        <aside className="sidePanel">
          <div className="panelTitle">Selected time</div>
          {!selectedSlot && <div className="panelHint">Click a 30‑minute slot to see the local times.</div>}
          {selectedSlot && (
            <>
              <div className="panelMeta">
                <div className="panelMetaRow">
                  <span className="metaLabel">Base:</span>
                  <span className="metaValue">{selectedSlot.base_label}</span>
                </div>
                <div className="panelMetaRow">
                  <span className="metaLabel">Overlap:</span>
                  <span className="metaValue">
                    {selectedSlot.working_count}/{timezones.length}{' '}
                    {selectedSlot.perfect_overlap ? '(perfect)' : ''}
                  </span>
                </div>
              </div>

              <div className="timesList">
                {selectedSlot.per_timezone.map((p) => {
                  const inExpanded = isWithinExpandedWindow(p.local_iso)
                  const cls = p.is_working ? 'timeVal ok' : inExpanded ? 'timeVal suggest' : 'timeVal off'
                  return (
                    <div key={p.timezone} className="timeRow">
                      <div className="timeTz" title={p.timezone}>
                        {tzDisplay(p.timezone)}
                      </div>
                      <div className={cls}>{p.local_label}</div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </aside>
      </main>
    </div>
  )
}

export default App
