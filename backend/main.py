from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from zoneinfo import ZoneInfo, available_timezones


APP_ROOT = Path(__file__).resolve().parents[1]
SETTINGS_PATH = APP_ROOT / "settings.json"

DEFAULT_BASE_TZ = "Asia/Shanghai"  # Beijing
DEFAULT_TIMEZONES = [
    "Asia/Shanghai",
    "America/Los_Angeles",  # PST/PDT
    "America/New_York",  # EST/EDT
    "Asia/Kolkata",  # India
    "Asia/Jerusalem",  # Israel
]

WORK_START = time(7, 30)
WORK_END = time(18, 0)
SUGGEST_START = time(7, 0)
SUGGEST_END = time(21, 0)
SLOT_MINUTES = 30


class Settings(BaseModel):
    base_timezone: str = Field(default=DEFAULT_BASE_TZ)
    timezones: list[str] = Field(default_factory=lambda: list(DEFAULT_TIMEZONES))
    tz_aliases: dict[str, str] = Field(default_factory=dict)


class UpdateTimezonesRequest(BaseModel):
    base_timezone: str | None = None
    timezones: list[str]
    tz_aliases: dict[str, str] | None = None


class TimezonesResponse(BaseModel):
    timezones: list[str]


class SettingsResponse(BaseModel):
    settings: Settings


class SlotPerTimezone(BaseModel):
    timezone: str
    local_iso: str
    local_label: str
    is_working: bool


class Slot(BaseModel):
    index: int
    instant_iso: str
    base_label: str
    per_timezone: list[SlotPerTimezone]
    perfect_overlap: bool
    working_count: int


class SlotsResponse(BaseModel):
    date: str
    base_timezone: str
    timezones: list[str]
    slots: list[Slot]
    summary: dict[str, Any]


def _load_settings() -> Settings:
    if not SETTINGS_PATH.exists():
        settings = Settings()
        _save_settings(settings)
        return settings

    try:
        raw = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
        settings = Settings(**raw)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Failed to load settings.json: {exc}")

    # Normalize / validate stored timezones
    tz_set = available_timezones()
    if settings.base_timezone not in tz_set:
        settings.base_timezone = DEFAULT_BASE_TZ

    settings.timezones = [tz for tz in settings.timezones if tz in tz_set]
    if not settings.timezones:
        settings.timezones = list(DEFAULT_TIMEZONES)

    if settings.base_timezone not in settings.timezones:
        settings.timezones = [settings.base_timezone, *[tz for tz in settings.timezones if tz != settings.base_timezone]]

    # Normalize / validate stored aliases
    aliases: dict[str, str] = {}
    for tz, label in (settings.tz_aliases or {}).items():
        if tz in tz_set and isinstance(label, str):
            cleaned = label.strip()
            if cleaned:
                aliases[tz] = cleaned
    # Keep only aliases for selected timezones
    settings.tz_aliases = {tz: aliases[tz] for tz in settings.timezones if tz in aliases}

    return settings


def _save_settings(settings: Settings) -> None:
    SETTINGS_PATH.write_text(settings.model_dump_json(indent=2) + "\n", encoding="utf-8")


def _parse_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid date (expected YYYY-MM-DD): {value}") from exc


def _is_within_window(local_t: time, start: time, end: time) -> bool:
    return (local_t >= start) and (local_t < end)


def _format_local_label(local_dt: datetime) -> str:
    # Example: 14:00
    return local_dt.strftime("%H:%M")


app = FastAPI(title="AvailableTime API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/settings", response_model=SettingsResponse)
def get_settings() -> SettingsResponse:
    return SettingsResponse(settings=_load_settings())


@app.post("/api/settings/timezones", response_model=SettingsResponse)
def update_timezones(req: UpdateTimezonesRequest) -> SettingsResponse:
    tz_set = available_timezones()
    requested = [tz for tz in req.timezones if tz in tz_set]
    if not requested:
        raise HTTPException(status_code=400, detail="No valid timezones provided")

    base_tz = req.base_timezone
    if base_tz is None:
        current = _load_settings()
        base_tz = current.base_timezone

    if base_tz not in tz_set:
        raise HTTPException(status_code=400, detail="Invalid base_timezone")

    if base_tz not in requested:
        requested = [base_tz, *[tz for tz in requested if tz != base_tz]]

    current = _load_settings()
    next_aliases = current.tz_aliases
    if req.tz_aliases is not None:
        cleaned: dict[str, str] = {}
        for tz, label in req.tz_aliases.items():
            if tz in tz_set and isinstance(label, str):
                val = label.strip()
                if val:
                    cleaned[tz] = val
        next_aliases = cleaned

    # Keep only aliases for selected timezones
    next_aliases = {tz: next_aliases[tz] for tz in requested if tz in next_aliases}

    settings = Settings(base_timezone=base_tz, timezones=requested, tz_aliases=next_aliases)
    _save_settings(settings)
    return SettingsResponse(settings=settings)


@app.get("/api/timezones", response_model=TimezonesResponse)
def list_timezones(q: str | None = None, limit: int = 50) -> TimezonesResponse:
    tzs = sorted(available_timezones())

    if q:
        q_norm = q.strip().lower()
        tzs = [t for t in tzs if q_norm in t.lower()]

    limit = max(1, min(500, limit))
    return TimezonesResponse(timezones=tzs[:limit])


@app.get("/api/slots", response_model=SlotsResponse)
def get_slots(day: str) -> SlotsResponse:
    settings = _load_settings()
    target_date = _parse_date(day)

    base_zone = ZoneInfo(settings.base_timezone)

    # Timeline is defined as the base timezone's local day.
    start_of_day = datetime.combine(target_date, time(0, 0), tzinfo=base_zone)

    slots: list[Slot] = []
    n = len(settings.timezones)

    best_working_count = -1
    best_slot_index: int | None = None
    best_slot_label: str | None = None

    best_suggest_count = -1
    best_suggest_index: int | None = None
    best_suggest_label: str | None = None

    for idx in range(int(24 * 60 / SLOT_MINUTES)):
        instant = start_of_day + timedelta(minutes=idx * SLOT_MINUTES)

        per: list[SlotPerTimezone] = []
        working_count = 0
        suggest_count = 0

        for tz_name in settings.timezones:
            z = ZoneInfo(tz_name)
            local_dt = instant.astimezone(z)
            local_t = local_dt.timetz().replace(tzinfo=None)

            is_working = _is_within_window(local_t, WORK_START, WORK_END)
            is_suggest = _is_within_window(local_t, SUGGEST_START, SUGGEST_END)

            per.append(
                SlotPerTimezone(
                    timezone=tz_name,
                    local_iso=local_dt.isoformat(),
                    local_label=_format_local_label(local_dt),
                    is_working=is_working,
                )
            )

            if is_working:
                working_count += 1
            if is_suggest:
                suggest_count += 1

        perfect_overlap = working_count == n

        base_local = instant.astimezone(base_zone)
        base_label = _format_local_label(base_local)

        slots.append(
            Slot(
                index=idx,
                instant_iso=instant.astimezone(ZoneInfo("UTC")).isoformat(),
                base_label=base_label,
                per_timezone=per,
                perfect_overlap=perfect_overlap,
                working_count=working_count,
            )
        )

        if working_count > best_working_count:
            best_working_count = working_count
            best_slot_index = idx
            best_slot_label = base_label

        if suggest_count > best_suggest_count:
            best_suggest_count = suggest_count
            best_suggest_index = idx
            best_suggest_label = base_label

    perfect_count = sum(1 for s in slots if s.perfect_overlap)

    summary: dict[str, Any] = {
        "perfect_overlap_slots": perfect_count,
        "best_slot": {
            "index": best_slot_index,
            "base_label": best_slot_label,
            "working_count": best_working_count,
            "total": n,
        },
        "best_slot_expanded_window": {
            "index": best_suggest_index,
            "base_label": best_suggest_label,
            "within_0700_2100_count": best_suggest_count,
            "total": n,
        },
    }

    return SlotsResponse(
        date=target_date.isoformat(),
        base_timezone=settings.base_timezone,
        timezones=settings.timezones,
        slots=slots,
        summary=summary,
    )
