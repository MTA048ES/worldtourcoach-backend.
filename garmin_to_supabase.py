#!/usr/bin/env python3
"""
Garmin → Supabase Sync
======================
Conecta con Garmin Connect para extraer datos de salud
y los sube directamente a Supabase.

Usa las mismas tablas que el SQL de crear_tablas.sql:
- garmin_wellness: datos diarios de salud
- garmin_hrv: HRV detallado
- garmin_sleep: sueño detallado
- garmin_sleep_analysis: métricas derivadas del RAW de sueño (1 fila por noche)
- garmin_sleep_series: series temporales del RAW de sueño (1 fila por muestra)
- garmin_activities: actividades
"""

import os
import json
import sys
import argparse
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Configurar salida UTF-8
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from dotenv import load_dotenv
from garminconnect import Garmin

# Cargar .env
load_dotenv()

EMAIL = os.getenv("GARMIN_EMAIL")
PASSWORD = os.getenv("GARMIN_PASSWORD")

# Supabase config
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_ANON_KEY")
USER_ID = os.getenv("USER_ID")

# Validar que las variables de entorno requeridas existen
for _var in ("GARMIN_EMAIL", "GARMIN_PASSWORD", "SUPABASE_URL", "SUPABASE_ANON_KEY", "USER_ID"):
    if not os.getenv(_var):
        raise SystemExit(f"[ERROR] Falta la variable de entorno: {_var}")

# Rango de fechas
DEFAULT_START = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
DEFAULT_END = datetime.now().strftime("%Y-%m-%d")
START_DATE = os.getenv("START_DATE", DEFAULT_START)
END_DATE = os.getenv("END_DATE", DEFAULT_END)

SESSION_DIR = Path(__file__).parent / "session"

import requests

def validate_date_in_range(row_date, requested_start, requested_end):
    """
    Valida que una fecha de fila esté dentro del rango solicitado.
    Retorna (is_valid, row_date_str) para logging.
    """
    if not row_date:
        return False, "null"

    row_date_str = str(row_date)

    # Determinar si es fecha única o rango
    is_single_day = (requested_start == requested_end)

    if is_single_day:
        # Caso A: Fecha única - debe coincidir exactamente
        if row_date_str == requested_start:
            return True, row_date_str
        else:
            return False, row_date_str
    else:
        # Caso B: Rango de fechas - debe estar dentro del rango
        try:
            row_dt = datetime.strptime(row_date_str, "%Y-%m-%d").date()
            start_dt = datetime.strptime(requested_start, "%Y-%m-%d").date()
            end_dt = datetime.strptime(requested_end, "%Y-%m-%d").date()

            if start_dt <= row_dt <= end_dt:
                return True, row_date_str
            else:
                return False, row_date_str
        except ValueError:
            return False, row_date_str

def _extract_date(value):
    """
    Extrae una fecha YYYY-MM-DD de un valor temporal real de actividad.

    Acepta formatos vistos en Garmin:
      - '2026-08-19 17:08:06'   (startTimeLocal / startTimeGMT)
      - '2026-08-19T17:08:06+00:00' (start_time_local ya almacenado en Supabase)
      - 1787152086000           (beginTimestamp en milisegundos)

    Retorna None si no se puede extraer una fecha YYYY-MM-DD.
    """
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    # Formato con guion: tomar los primeros 10 caracteres si parecen YYYY-MM-DD
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        candidate = s[0:10]
        try:
            datetime.strptime(candidate, "%Y-%m-%d")
            return candidate
        except ValueError:
            return None
    # Formato epoch (beginTimestamp en milisegundos)
    try:
        epoch_ms = float(s)
        return datetime.utcfromtimestamp(epoch_ms / 1000.0).strftime("%Y-%m-%d")
    except (ValueError, TypeError, OSError):
        return None
# Tamaño maximo (bytes) del JSON de cada POST de upsert. garmin_sleep_series genera
# miles de filas por ejecucion (una ventana de 7 dias supera el limite del cuerpo HTTP),
# de modo que se envian varios POST con la MISMA semantica de upsert.
MAX_POST_BYTES = 700000


def post_batches(rows, max_bytes=MAX_POST_BYTES):
    """
    Agrupa filas en lotes listos para el POST de upsert.

    Cada lote cumple dos condiciones:
      - todas sus filas tienen EXACTAMENTE las mismas claves. PostgREST construye un
        unico INSERT con una lista de columnas comun, asi que las filas que ahora
        omiten claves sin dato (para no sobrescribir con NULL) deben ir en lotes
        separados segun su conjunto de claves;
      - el JSON del lote no supera max_bytes (siempre al menos 1 fila por lote).
    """
    batch = []
    batch_keys = None
    used = 2  # corchetes del array JSON
    for row in rows:
        keys = tuple(sorted(row.keys()))
        size = len(json.dumps(row, default=str, ensure_ascii=False)) + 1
        if batch and (keys != batch_keys or used + size > max_bytes):
            yield batch
            batch = []
            used = 2
        if not batch:
            batch_keys = keys
        batch.append(row)
        used += size
    if batch:
        yield batch


def supabase_upsert(table: str, rows: list, requested_start_date: str = None, requested_end_date: str = None):
    """
    Sube datos a Supabase con upsert. Si POST falla por duplicados (409), usa PATCH.

    Parámetros:
    - table: nombre de la tabla
    - rows: lista de filas a insertar
    - requested_start_date: fecha de inicio solicitada (para validación)
    - requested_end_date: fecha de fin solicitada (para validación)
    """
    if not rows:
        return True, None

    # Si no se proporcionan fechas de solicitud, usar START_DATE/END_DATE globales
    if requested_start_date is None:
        requested_start_date = START_DATE
    if requested_end_date is None:
        requested_end_date = END_DATE

    # Validar fechas de cada fila antes del UPSERT
    valid_rows = []
    skipped_count = 0

    for row in rows:
        # La fecha de validación puede venir de la clave 'date' (wellness/hrv/sleep)
        # o, para garmin_activities, de un campo temporal real de la actividad.
        row_date = row.get("date")
        if row_date is None and row.get("start_time_local"):
            # Extraer solo la parte YYYY-MM-DD como fecha de validación sin tocar el esquema.
            row_date = _extract_date(row.get("start_time_local"))
        elif row_date is None and row.get("start_time_gmt"):
            row_date = _extract_date(row.get("start_time_gmt"))

        is_valid, row_date_str = validate_date_in_range(row_date, requested_start_date, requested_end_date)

        if is_valid:
            # Log solo para información, no datos sensibles
            is_single_day = (requested_start_date == requested_end_date)
            if is_single_day:
                print(f"  [SYNC] DATE_VALID requested_date={requested_start_date} row_date={row_date_str} action=UPSERT")
            else:
                print(f"  [SYNC] DATE_VALID requested_start={requested_start_date} requested_end={requested_end_date} row_date={row_date_str} action=UPSERT")
            valid_rows.append(row)
        else:
            # Log de discrepancia de fechas
            skipped_count += 1
            is_single_day = (requested_start_date == requested_end_date)
            if is_single_day:
                print(f"  [WARN] DATE_MISMATCH requested_date={requested_start_date} garmin_date={row_date_str} action=SKIPPED")
            else:
                print(f"  [WARN] DATE_OUT_OF_RANGE requested_start={requested_start_date} requested_end={requested_end_date} garmin_date={row_date_str} action=SKIPPED")

    # Si no hay filas válidas después de la validación, retornar éxito pero con 0 filas
    if not valid_rows:
        if skipped_count > 0:
            print(f"  [WARN] {skipped_count} filas omitidas por discrepancia de fechas en {table}")
        return True, None  # Retornar True para no interrumpir la sincronización

    # Proceder con el UPSERT solo para filas válidas.
    # El target del conflicto debe ser la UNIQUE constraint real de cada tabla:
    #   - garmin_wellness/garmin_hrv/garmin_sleep/garmin_sleep_analysis
    #       -> UNIQUE(user_id, date)
    #   - garmin_activities -> UNIQUE(activity_id)
    #   - garmin_sleep_series
    #       -> UNIQUE(user_id, date, metric, timestamp_ms, ordinal)
    # Sin este parámetro, PostgREST usa la PK (id BIGSERIAL) como target por defecto,
    # pero esa columna no viaja en el payload y los lotes mixtos fallan con HTTP 409.
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if table == "garmin_activities":
        post_url = f"{url}?on_conflict=activity_id"
    elif table == "garmin_sleep_series":
        post_url = f"{url}?on_conflict=user_id,date,metric,timestamp_ms,ordinal"
    else:
        post_url = f"{url}?on_conflict=user_id,date"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal"
    }

    # UPSERT por lotes: se envian varios POST con las mismas claves y acotados en
    # tamano (ver post_batches). La semantica es la de siempre
    # (Prefer: resolution=merge-duplicates + on_conflict); solo cambia el numero de
    # peticiones.
    conflict_rows = []
    for batch in post_batches(valid_rows):
        try:
            resp = requests.post(post_url, headers=headers, json=batch, timeout=30)
        except Exception as e:
            print(f"    [ERROR] Conexion Supabase: {e}")
            return False, str(e)

        if resp.status_code < 400:
            print(f"    [OK] {len(batch)} filas procesadas mediante UPSERT en {table}")
            continue
        if resp.status_code != 409:
            print(f"    [ERROR] {resp.status_code}: {resp.text[:200]}")
            return False, resp.text
        # 409 = conflictos de duplicados -> PATCH por fila (solo este lote)
        conflict_rows.extend(batch)

    if not conflict_rows:
        return True, None

    # PATCH por fila (fallback cuando ya existen).
    # Con 'Prefer: return=representation' podemos distinguir si PostgREST
    # encontró una fila real (devuelve el registro actualizado) o no (devuelve []).
    updated = 0
    not_found = 0
    errors = 0
    for row in conflict_rows:
        # Construir filtro segun la clave unica de cada tabla
        if table == "garmin_activities":
            filters = f"activity_id=eq.{row['activity_id']}"
        elif table == "garmin_sleep_series":
            filters = (f"user_id=eq.{row['user_id']}&date=eq.{row['date']}"
                       f"&metric=eq.{row['metric']}")
            ts = row.get("timestamp_ms")
            filters += f"&timestamp_ms=eq.{ts}" if ts is not None else "&timestamp_ms=is.null"
            filters += f"&ordinal=eq.{row['ordinal']}"
        else:
            filters = f"user_id=eq.{row['user_id']}&date=eq.{row['date']}"
        patch_url = f"{url}?{filters}"
        headers_patch = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation"
        }
        try:
            r = requests.patch(patch_url, headers=headers_patch, json=row, timeout=30)
            if r.status_code < 400:
                # return=representation: si la fila existia, devuelve el registro [{}]; si no, []
                try:
                    payload = r.json()
                except Exception:
                    payload = None
                if isinstance(payload, list) and len(payload) > 0:
                    updated += 1
                elif isinstance(payload, dict) and payload:
                    updated += 1
                else:
                    not_found += 1
                    print(f"    [WARN] PATCH_SIN_MATCH table={table} activity_id={row.get('activity_id', '-')} date={row.get('date', '-')}")
            else:
                errors += 1
                print(f"    [WARN] PATCH_ERROR table={table} status={r.status_code} detail={r.text[:120]}")
        except Exception as e:
            errors += 1
            print(f"    [WARN] PATCH_EXCEPTION table={table} error={e}")
    print(f"    [OK] {updated} filas actualizadas en {table} (PATCH)")
    if not_found:
        print(f"    [WARN] {not_found} filas no encontradas en {table} (PATCH sin match)")
    if errors:
        print(f"    [WARN] {errors} errores de PATCH en {table}")
    return True, None

def date_range(start_str, end_str):
    start = datetime.strptime(start_str, "%Y-%m-%d").date()
    end = datetime.strptime(end_str, "%Y-%m-%d").date()
    dates = []
    current = start
    while current <= end:
        dates.append(current.strftime("%Y-%m-%d"))
        current += timedelta(days=1)
    return dates

def safe_item(item):
    """Si el item es una lista, usa el primer elemento (los datos anidados)."""
    if isinstance(item, list):
        return item[0] if item else None
    return item

def safe_num(val, fallback=None):
    if val is None or val == "":
        return fallback
    try:
        return float(val)
    except (ValueError, TypeError):
        return fallback

def safe_int(val, fallback=None):
    n = safe_num(val)
    return int(n) if n is not None and not isinstance(val, bool) else fallback

# Campos fijos que todas las filas de wellness deben tener
WELLNESS_FIELDS = [
    "user_id", "date", "resting_hr", "max_hr", "min_hr",
    "stress_avg", "stress_max", "total_steps", "distance_meters",
    "total_calories", "active_calories", "body_battery",
    "body_battery_max", "body_battery_min", "hrv_weekly",
    "hrv_last_night", "avg_respiration", "avg_spo2",
    "sleep_seconds", "deep_sleep_seconds", "light_sleep_seconds",
    "rem_sleep_seconds", "awake_sleep_seconds", "sleep_score",
    "sleep_quality", "raw_data"
]

def get_sleep_score(sleep_dto):
    """Extrae el sleep score de la estructura real (sleepScores.overall.value)."""
    scores = sleep_dto.get("sleepScores") if isinstance(sleep_dto.get("sleepScores"), dict) else {}
    overall = scores.get("overall") if isinstance(scores.get("overall"), dict) else {}
    return safe_int(overall.get("value"))

# --- Utilidades de sueno/series (garmin_sleep_analysis / garmin_sleep_series) ---
# Funciones puras respecto a la red: reciben el item RAW ya descargado y
# devuelven filas listas para UPSERT. No inventan datos: si una serie o campo
# no existe, la metrica queda ausente/NULL.

_SLEEP_SERIES_METRICS = (
    "sleepHeartRate",
    "sleepStress",
    "sleepBodyBattery",
    "sleepMovement",
    "sleepLevels",
    "wellnessEpochRespirationDataDTOList",
    "wellnessEpochSPO2DataDTOList",
    "breathingDisruptionData",
    "sleepRestlessMoments",
)

# Claves candidatas de inicio/fin por muestra (se prueban en orden).
_SERIES_START_KEYS = ("startGMT", "startTimeGMT", "epochTimestamp", "timestampGMT")
_SERIES_END_KEYS = ("endGMT", "endTimeGMT", "epochEndTimestampGmt", "endTimestampGMT")

# Clave de valor por metrica.
_SERIES_VALUE_KEYS = {
    "sleepHeartRate": ("value",),
    "sleepStress": ("value",),
    "sleepBodyBattery": ("value",),
    "sleepMovement": ("activityLevel",),
    "sleepLevels": ("activityLevel",),
    "wellnessEpochRespirationDataDTOList": ("respirationValue",),
    "wellnessEpochSPO2DataDTOList": ("spo2Reading",),
    "breathingDisruptionData": ("value",),
    "sleepRestlessMoments": ("value",),
}

# Criterio documentado: estres alto = nivel >= 75 (escala Garmin 0-100).
# stress_high_minutes se calcula como minutos equivalentes: cada muestra de
# sleepStress representa el intervalo hasta la siguiente muestra
# (diferencia de startGMT en ms); la ultima usa la mediana de los
# intervalos (180000 ms en el RAW observado). Solo pondera la fraccion
# del intervalo cuyo nivel inicial es >= 75.
STRESS_HIGH_THRESHOLD = 75

# Criterio documentado: SpO2 baja = lectura < 95. Cada muestra de
# wellnessEpochSPO2DataDTOList dura epochDuration segundos (60s en el RAW
# observado). spo2_below_95_minutes = segundos_bajo_95 / 60.
SPO2_LOW_THRESHOLD = 95

# NOTA sleepLevels: activityLevel es un codigo numerico de fase no
# documentado por Garmin en este payload (observado: 0.0/1.0/2.0/3.0). NO se
# interpreta fase concreta: las transiciones se cuentan como cambios de valor
# de activityLevel y deep/rem/light/awake se toman del DTO (segundos reales).

# --- Fin utilidades de sueno/series ---


def set_if_value(row, key, value):
    """
    Asigna la clave solo si hay dato real (no None y no cadena vacia).

    Motivo: en el UPSERT (Prefer: resolution=merge-duplicates) las columnas que
    viajan en el payload se sobrescriben. Si enviamos null en una columna que no
    tiene dato, destruimos un valor valido ya existente en Supabase. Las claves sin
    dato simplemente NO viajan en el payload.
    """
    if value is None or value == "":
        return
    row[key] = value


def as_dict(value):
    """Devuelve value si es dict, o {} en caso contrario."""
    return value if isinstance(value, dict) else {}


def get_biometric_date(item, dto):
    """Fecha YYYY-MM-DD de un item biometrico (sleep/HRV).

    Orden: calendarDate inyectado en el wrapper, calendarDate del DTO/summary.
    """
    for cand in (item.get("calendarDate"), dto.get("calendarDate")):
        if isinstance(cand, str) and len(cand) >= 10 and cand[4] == "-" and cand[7] == "-":
            try:
                datetime.strptime(cand[0:10], "%Y-%m-%d")
                return cand[0:10]
            except ValueError:
                pass
    return None


def _epoch_ms_to_iso(ts):
    """Convierte epoch en milisegundos a ISO-8601 UTC con 'Z' (o None)."""
    if ts is None or isinstance(ts, bool):
        return None
    try:
        n = float(ts)
    except (TypeError, ValueError):
        return None
    if n <= 0:
        return None
    if n < 1e12:
        n = n * 1000.0
    sec, ms = divmod(int(n), 1000)
    try:
        dt = datetime.fromtimestamp(sec, tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None
    base = dt.strftime("%Y-%m-%dT%H:%M:%S")
    return base + (".%03dZ" % ms if ms else "Z")


def _parse_series_ts(value):
    if value is None or isinstance(value, bool):
        return None, None
    if isinstance(value, (int, float)):
        if value <= 0:
            return None, None
        ms = int(value) if value >= 1e12 else int(value * 1000)
        return ms, _epoch_ms_to_iso(ms)
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return None, None
        if s.lstrip("-").replace(".", "", 1).isdigit():
            try:
                n = float(s)
            except ValueError:
                return None, None
            if n <= 0:
                return None, None
            ms = int(n) if n >= 1e12 else int(n * 1000)
            return ms, _epoch_ms_to_iso(ms)
        try:
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            return None, None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        dt = dt.astimezone(timezone.utc)
        ms = int(dt.timestamp() * 1000)
        frac = ".%03dZ" % (ms % 1000) if ms % 1000 else "Z"
        return ms, dt.strftime("%Y-%m-%dT%H:%M:%S") + frac
    return None, None


def _sample_value(sample, value_keys):
    for k in value_keys:
        v = sample.get(k)
        if v is None or isinstance(v, bool):
            continue
        try:
            return float(v)
        except (TypeError, ValueError):
            continue
    return None


def _series_values(items, value_keys):
    vals = []
    for s in items or []:
        if not isinstance(s, dict):
            continue
        v = _sample_value(s, value_keys)
        if v is None or v < 0:
            continue
        vals.append(v)
    return vals


def _stats(vals):
    if not vals:
        return None, None, None
    return sum(vals) / len(vals), min(vals), max(vals)


def _parse_sleep_item(sleep_item):
    item = as_dict(sleep_item)
    dto = as_dict(item.get("dailySleepDTO"))
    date = get_biometric_date(item, dto)
    return date, item, dto


def _series_items(item, metric):
    v = item.get(metric)
    if not isinstance(v, list):
        return []
    return [s for s in v if isinstance(s, dict)]


def _sleep_level_transitions(items):
    prev = None
    n = 0
    for s in items:
        v = s.get("activityLevel")
        if v is None or isinstance(v, bool):
            continue
        try:
            f = float(v)
        except (TypeError, ValueError):
            continue
        if prev is not None and f != prev:
            n += 1
        prev = f
    return n


def _stress_high_minutes(st_items):
    if not st_items:
        return None
    ts = []
    for s in st_items:
        v = _sample_value(s, ("value",))
        if v is None or v < 0:
            continue
        ms, _iso = _parse_series_ts(s.get("startGMT"))
        if ms is None:
            return None
        ts.append((ms, v))
    if not ts:
        return None
    ts.sort(key=lambda t: t[0])
    gaps = [b[0] - a[0] for a, b in zip(ts, ts[1:]) if b[0] > a[0]]
    last_gap = sorted(gaps)[len(gaps) // 2] if gaps else 180000
    total_ms = 0
    for i, (ms, f) in enumerate(ts):
        gap = (ts[i + 1][0] - ms) if i + 1 < len(ts) else last_gap
        if gap <= 0:
            continue
        if f >= STRESS_HIGH_THRESHOLD:
            total_ms += gap
    return total_ms / 60000.0


def _spo2_below_95_minutes(spo2_items):
    if not spo2_items:
        return None
    total_s = 0.0
    n = 0
    for s in spo2_items:
        v = _sample_value(s, ("spo2Reading",))
        if v is None or v < 0:
            continue
        n += 1
        dur = s.get("epochDuration")
        try:
            dur_s = float(dur) if dur is not None else 60.0
        except (TypeError, ValueError):
            dur_s = 60.0
        if dur_s <= 0:
            dur_s = 60.0
        if v < SPO2_LOW_THRESHOLD:
            total_s += dur_s
    if not n:
        return None
    return total_s / 60.0


def build_sleep_analysis_rows(sleep_data):
    rows = []
    for sleep in sleep_data or []:
        date, item, dto = _parse_sleep_item(sleep)
        if not date:
            continue
        duration = safe_int(dto.get("sleepTimeSeconds"))
        deep_s = safe_int(dto.get("deepSleepSeconds"))
        light_s = safe_int(dto.get("lightSleepSeconds"))
        rem_s = safe_int(dto.get("remSleepSeconds"))
        awake_s = safe_int(dto.get("awakeSleepSeconds"))
        score = get_sleep_score(dto)
        has_dto = any(v is not None for v in (duration, deep_s, light_s, rem_s, awake_s, score))
        has_series = any(_series_items(item, m) for m in _SLEEP_SERIES_METRICS)
        if not has_dto and not has_series:
            continue
        hr_vals = _series_values(_series_items(item, "sleepHeartRate"), ("value",))
        hr_mean, hr_min, hr_max = _stats(hr_vals)
        st_items = _series_items(item, "sleepStress")
        st_vals = _series_values(st_items, ("value",))
        st_mean, st_min, st_max = _stats(st_vals)
        st_high_min = _stress_high_minutes(st_items)
        bb_vals = _series_values(_series_items(item, "sleepBodyBattery"), ("value",))
        bb_start = bb_vals[0] if bb_vals else None
        bb_min = min(bb_vals) if bb_vals else None
        bb_end = bb_vals[-1] if bb_vals else None
        bb_rec = (bb_end - bb_start) if (bb_start is not None and bb_end is not None) else None
        mv_vals = _series_values(_series_items(item, "sleepMovement"), ("activityLevel",))
        mv_mean, _a, _b = _stats(mv_vals)
        resp_items = _series_items(item, "wellnessEpochRespirationDataDTOList")
        resp_vals = _series_values(resp_items, ("respirationValue",))
        resp_mean, resp_min, resp_max = _stats(resp_vals)
        spo2_items = _series_items(item, "wellnessEpochSPO2DataDTOList")
        spo2_vals = _series_values(spo2_items, ("spo2Reading",))
        spo2_mean, spo2_min, _c = _stats(spo2_vals)
        spo2_below = _spo2_below_95_minutes(spo2_items)
        breath_items = _series_items(item, "breathingDisruptionData")
        breath_events = None
        if breath_items:
            breath_events = sum(1 for s in breath_items if _sample_value(s, ("value",)) is not None)
        restless_n = safe_int(item.get("restlessMomentsCount"))
        if restless_n is None:
            restless_items = _series_items(item, "sleepRestlessMoments")
            if restless_items:
                restless_n = sum(1 for s in restless_items if _sample_value(s, ("value",)) is not None)
        levels_items = _series_items(item, "sleepLevels")
        transitions = _sleep_level_transitions(levels_items) if levels_items else None
        row = {"user_id": USER_ID, "date": date}
        set_if_value(row, "sleep_start_gmt", _epoch_ms_to_iso(dto.get("sleepStartTimestampGMT")))
        set_if_value(row, "sleep_end_gmt", _epoch_ms_to_iso(dto.get("sleepEndTimestampGMT")))
        set_if_value(row, "sleep_duration_seconds", duration)
        set_if_value(row, "deep_sleep_seconds", deep_s)
        set_if_value(row, "light_sleep_seconds", light_s)
        set_if_value(row, "rem_sleep_seconds", rem_s)
        set_if_value(row, "awake_sleep_seconds", awake_s)
        set_if_value(row, "sleep_score", score)
        set_if_value(row, "resting_hr", safe_int(item.get("restingHeartRate")))
        set_if_value(row, "avg_overnight_hrv", safe_num(item.get("avgOvernightHrv")))
        set_if_value(row, "hrv_status", item.get("hrvStatus"))
        set_if_value(row, "hr_mean", hr_mean)
        set_if_value(row, "hr_min", safe_int(hr_min))
        set_if_value(row, "hr_max", safe_int(hr_max))
        set_if_value(row, "stress_mean", st_mean)
        set_if_value(row, "stress_min", safe_int(st_min))
        set_if_value(row, "stress_max", safe_int(st_max))
        set_if_value(row, "stress_high_minutes", st_high_min)
        set_if_value(row, "movement_mean", mv_mean)
        set_if_value(row, "movement_total", sum(mv_vals) if mv_vals else None)
        set_if_value(row, "movement_samples", len(mv_vals) if mv_vals else None)
        set_if_value(row, "restless_moments", restless_n)
        set_if_value(row, "body_battery_start", bb_start)
        set_if_value(row, "body_battery_min", bb_min)
        set_if_value(row, "body_battery_end", bb_end)
        set_if_value(row, "body_battery_recovery", bb_rec)
        set_if_value(row, "respiration_mean", resp_mean)
        set_if_value(row, "respiration_min", resp_min)
        set_if_value(row, "respiration_max", resp_max)
        set_if_value(row, "respiration_samples", len(resp_vals) if resp_vals else None)
        set_if_value(row, "spo2_mean", spo2_mean)
        set_if_value(row, "spo2_min", spo2_min)
        set_if_value(row, "spo2_below_95_minutes", spo2_below)
        set_if_value(row, "spo2_samples", len(spo2_vals) if spo2_vals else None)
        set_if_value(row, "breathing_disruption_events", breath_events)
        skin_c = item.get("avgSkinTempDeviationC")
        if skin_c is None:
            skin_c = dto.get("avgSkinTempDeviationC")
        set_if_value(row, "skin_temp_deviation_c", safe_num(skin_c))
        set_if_value(row, "sleep_level_transitions", transitions)
        if duration and duration > 0:
            set_if_value(row, "deep_percentage", (deep_s / duration * 100.0) if deep_s is not None else None)
            set_if_value(row, "rem_percentage", (rem_s / duration * 100.0) if rem_s is not None else None)
        set_if_value(row, "source_raw_keys", sorted([k for k in _SLEEP_SERIES_METRICS if _series_items(item, k)]))
        rows.append(row)
    return rows


def build_sleep_series_rows(sleep_data):
    rows = []
    for sleep in sleep_data or []:
        date, item, _dto = _parse_sleep_item(sleep)
        if not date:
            continue
        for metric in _SLEEP_SERIES_METRICS:
            items = _series_items(item, metric)
            if not items:
                continue
            value_keys = _SERIES_VALUE_KEYS.get(metric, ("value",))
            for ordinal, s in enumerate(items):
                start_raw = None
                for k in _SERIES_START_KEYS:
                    if s.get(k) is not None:
                        start_raw = s.get(k)
                        break
                ts_ms, ts_iso = _parse_series_ts(start_raw)
                end_raw = None
                for k in _SERIES_END_KEYS:
                    if s.get(k) is not None:
                        end_raw = s.get(k)
                        break
                dur_s = None
                if end_raw is not None and ts_ms is not None:
                    end_ms, _eiso = _parse_series_ts(end_raw)
                    if end_ms is not None and end_ms >= ts_ms:
                        dur_s = (end_ms - ts_ms) / 1000.0
                value = _sample_value(s, value_keys)
                row = {"user_id": USER_ID, "date": date, "metric": metric, "ordinal": ordinal, "source_key": metric}
                set_if_value(row, "timestamp_ms", ts_ms)
                set_if_value(row, "timestamp_gmt", ts_iso)
                set_if_value(row, "duration_seconds", dur_s)
                set_if_value(row, "value", value)
                if metric == "wellnessEpochSPO2DataDTOList":
                    set_if_value(row, "confidence", safe_int(s.get("readingConfidence")))
                try:
                    row["raw_sample"] = json.dumps(s, ensure_ascii=False, default=str)
                except (TypeError, ValueError):
                    continue
                rows.append(row)
    return rows




# Formatos de fecha/hora que devuelve Garmin en las actividades.
_ACTIVITY_DT_FORMATS = (
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%d %H:%M:%S.%f",
    "%Y-%m-%dT%H:%M:%S.%f",
)


def build_wellness_rows(steps, hr, stress, body, hrv, resp, spo2, sleep):
    """Combina datos de multiples fuentes en filas de garmin_wellness."""
    data_map = {}

    # Pasos (estructura real: totalSteps, totalDistance, stepGoal)
    for raw_item in steps:
        item = safe_item(raw_item)
        if not item or not item.get("calendarDate"):
            continue
        d = item["calendarDate"]
        data_map.setdefault(d, {})
        data_map[d].update({
            "total_steps": safe_int(item.get("totalSteps")),
            "distance_meters": safe_int(item.get("totalDistance")),
            "total_calories": safe_int(item.get("totalKilocalories")),
            "active_calories": safe_int(item.get("activeKilocalories")),
        })

    # HR
    for raw_item in hr:
        item = safe_item(raw_item)
        if not item or not item.get("calendarDate"):
            continue
        d = item["calendarDate"]
        data_map.setdefault(d, {})
        data_map[d].update({
            "resting_hr": safe_int(item.get("restingHeartRate")),
            "max_hr": safe_int(item.get("maxHeartRate")),
            "min_hr": safe_int(item.get("minHeartRate")),
        })

    # Estres (estructura real: dict con avgStressLevel)
    for raw_item in stress:
        item = safe_item(raw_item)
        if not item or not item.get("calendarDate"):
            continue
        d = item["calendarDate"]
        data_map.setdefault(d, {})
        data_map[d].update({
            "stress_avg": safe_num(item.get("avgStressLevel")),
            "stress_max": safe_int(item.get("maxStressLevel")),
        })

    # Body Battery (estructura real: lista con dict que tiene date, charged, drained, bodyBatteryValuesArray)
    for raw_item in body:
        item = safe_item(raw_item)
        if not item:
            continue
        d = item.get("date") or item.get("calendarDate")
        if not d:
            continue
        data_map.setdefault(d, {})
        # Ultimo valor no-null de bodyBatteryValuesArray = body battery actual
        last_bb = None
        bb_values = item.get("bodyBatteryValuesArray") or []
        for pair in bb_values:
            if isinstance(pair, (list, tuple)) and len(pair) >= 2 and pair[1] is not None:
                last_bb = pair[1]
        data_map[d].update({
            "body_battery": safe_int(last_bb),
            "body_battery_max": safe_int(item.get("charged")),
            "body_battery_min": safe_int(item.get("drained")),
        })

    # HRV (estructura real: dict con hrvSummary anidado)
    for raw_item in hrv:
        item = safe_item(raw_item)
        if not item:
            continue
        hrv_summary = item.get("hrvSummary") if isinstance(item, dict) else None
        if not hrv_summary:
            continue
        d = hrv_summary.get("calendarDate")
        if not d:
            continue
        data_map.setdefault(d, {})
        data_map[d].update({
            "hrv_weekly": safe_num(hrv_summary.get("weeklyAvg")),
            "hrv_last_night": safe_num(hrv_summary.get("lastNightAvg")),
        })

    # Respiracion (estructura real: dict con avgWakingRespirationValue)
    for raw_item in resp:
        item = safe_item(raw_item)
        if not item or not item.get("calendarDate"):
            continue
        d = item["calendarDate"]
        data_map.setdefault(d, {})
        data_map[d].update({
            "avg_respiration": safe_num(item.get("avgWakingRespirationValue")),
        })

    # SpO2 (estructura real: dict con averageSpO2)
    for raw_item in spo2:
        item = safe_item(raw_item)
        if not item or not item.get("calendarDate"):
            continue
        d = item["calendarDate"]
        data_map.setdefault(d, {})
        data_map[d].update({
            "avg_spo2": safe_num(item.get("averageSpO2")),
        })

    # Sueno (estructura real: dict con dailySleepDTO anidado)
    for raw_item in sleep:
        item = safe_item(raw_item)
        if not item:
            continue
        sleep_dto = item.get("dailySleepDTO") if isinstance(item, dict) else None
        if not sleep_dto:
            continue
        d = sleep_dto.get("calendarDate")
        if not d:
            continue
        data_map.setdefault(d, {})
        data_map[d].update({
            "sleep_seconds": safe_int(sleep_dto.get("sleepTimeSeconds")),
            "deep_sleep_seconds": safe_int(sleep_dto.get("deepSleepSeconds")),
            "light_sleep_seconds": safe_int(sleep_dto.get("lightSleepSeconds")),
            "rem_sleep_seconds": safe_int(sleep_dto.get("remSleepSeconds")),
            "awake_sleep_seconds": safe_int(sleep_dto.get("awakeSleepSeconds")),
            "sleep_score": get_sleep_score(sleep_dto),
            "sleep_quality": sleep_dto.get("sleepScoreFeedback"),
        })

    # Construir filas finales con TODAS las claves (mismo orden para todas)
    rows = []
    for d, data in sorted(data_map.items()):
        row = {field: None for field in WELLNESS_FIELDS}
        row["user_id"] = USER_ID
        row["date"] = d
        for key, value in data.items():
            if key in WELLNESS_FIELDS:
                row[key] = value
        row["raw_data"] = json.dumps({k: v for k, v in data.items()}, default=str)
        rows.append(row)

    return rows

def build_hrv_rows(hrv):
    rows = []
    for raw_item in hrv:
        item = safe_item(raw_item)
        if not item:
            continue
        hrv_summary = item.get("hrvSummary") if isinstance(item, dict) else None
        if not hrv_summary:
            continue
        d = hrv_summary.get("calendarDate")
        if not d:
            continue
        baseline = hrv_summary.get("baseline") if isinstance(hrv_summary.get("baseline"), dict) else {}
        rows.append({
            "user_id": USER_ID,
            "date": d,
            "weekly_avg": safe_num(hrv_summary.get("weeklyAvg")),
            "last_night_avg": safe_num(hrv_summary.get("lastNightAvg")),
            "last_night_5min_high": safe_num(hrv_summary.get("lastNight5MinHigh")),
            "last_night_5min_low": safe_num(hrv_summary.get("lastNight5MinLow")),
            "baseline_low_upper": safe_num(baseline.get("lowUpper")),
            "baseline_low_lower": safe_num(baseline.get("lowLower")),
            "baseline_balanced_lower": safe_num(baseline.get("balancedLow")),
            "baseline_balanced_upper": safe_num(baseline.get("balancedUpper")),
            "baseline_high_upper": safe_num(baseline.get("highUpper")),
            "baseline_high_lower": safe_num(baseline.get("highLower")),
            "raw_data": json.dumps(item, default=str),
        })
    return rows

def build_sleep_rows(sleep):
    rows = []
    for raw_item in sleep:
        item = safe_item(raw_item)
        if not item:
            continue
        sleep_dto = item.get("dailySleepDTO") if isinstance(item, dict) else None
        if not sleep_dto:
            continue
        d = sleep_dto.get("calendarDate")
        if not d:
            continue
        rows.append({
            "user_id": USER_ID,
            "date": d,
            "sleep_time_seconds": safe_int(sleep_dto.get("sleepTimeSeconds")),
            "deep_sleep_seconds": safe_int(sleep_dto.get("deepSleepSeconds")),
            "light_sleep_seconds": safe_int(sleep_dto.get("lightSleepSeconds")),
            "rem_sleep_seconds": safe_int(sleep_dto.get("remSleepSeconds")),
            "awake_sleep_seconds": safe_int(sleep_dto.get("awakeSleepSeconds")),
            "sleep_score": get_sleep_score(sleep_dto),
            "sleep_quality": sleep_dto.get("sleepScoreFeedback"),
            "avg_spo2": None,
            "avg_respiration": safe_num(sleep_dto.get("averageRespirationValue")),
            "lowest_hr": safe_int(sleep_dto.get("avgHeartRate")),
            "raw_data": json.dumps(item, default=str),
        })
    return rows

def build_activity_rows(activities):
    rows = []
    for act in activities:
        if not act:
            continue
        rows.append({
            "user_id": USER_ID,
            "activity_id": str(act.get("activityId", "")),
            "name": act.get("activityName"),
            "type": act.get("activityType", {}).get("typeKey", "") if isinstance(act.get("activityType"), dict) else "",
            "start_time_local": act.get("startTimeLocal"),
            "duration_seconds": safe_int(act.get("duration")),
            "distance": safe_num(act.get("distance")),
            "avg_hr": safe_int(act.get("averageHR")),
            "max_hr": safe_int(act.get("maxHR")),
            "avg_power": safe_int(act.get("avgPower")),
            "max_power": safe_int(act.get("maxPower")),
            "calories": safe_int(act.get("calories")),
            "avg_speed": safe_num(act.get("averageSpeed")),
            "max_speed": safe_num(act.get("maxSpeed")),
            "elevation_gain": safe_num(act.get("elevationGain")),
            "training_effect": safe_num(act.get("trainingEffect")),
            "vo2max": safe_num(act.get("vO2MaxValue")),
            "raw_data": json.dumps(act, default=str),
        })
    return rows

def fetch_by_day(garmin, method_name, dates, max_days=None):
    """Llama al metodo por dia, con pausa para no saturar la API."""
    results = []
    for i, d in enumerate(dates):
        try:
            method = getattr(garmin, method_name)
            data = method(d)
            if data:
                if isinstance(data, dict):
                    data["calendarDate"] = d
                results.append(data)
            # Pequena pausa entre llamadas
            if i > 0 and i % 10 == 0:
                time.sleep(1)
        except Exception as e:
            print(f"    [WARN] {d}: {type(e).__name__}: {str(e)[:80]}")
    return results

def main():
    parser = argparse.ArgumentParser(description="Garmin to Supabase Sync")
    parser.add_argument("--mfa", help="Codigo de seguridad de 6 digitos (2FA)")
    parser.add_argument("--no-supabase", action="store_true", help="Solo descarga a CSV/JSON, no sube a Supabase")
    args = parser.parse_args()

    if not EMAIL or not PASSWORD:
        print("[ERROR] Falta GARMIN_EMAIL o GARMIN_PASSWORD en .env")
        sys.exit(1)

    print("=" * 60)
    print("  GARMIN -> SUPABASE SYNC")
    print("=" * 60)
    print(f"  Rango: {START_DATE} -> {END_DATE}")
    print(f"  Supabase: {SUPABASE_URL}")
    print(f"  User ID: {USER_ID}")
    print()

    # AUTENTICACION
    print("Conectando a Garmin Connect...")
    try:
        session_file = SESSION_DIR / "garmin_session"
        if session_file.exists():
            print("  Usando sesion guardada...")
            garmin = Garmin()
            garmin.login(str(session_file))
        else:
            print("  Iniciando sesion con credenciales...")

            def get_mfa_code():
                if args.mfa:
                    return args.mfa
                print()
                print("  GARMIN REQUIERE VERIFICACION EN DOS PASOS")
                print("  Revisa tu correo para el codigo de seguridad")
                return input("  Codigo de seguridad (6 digitos): ").strip()

            garmin = Garmin(
                email=EMAIL,
                password=PASSWORD,
                prompt_mfa=get_mfa_code,
            )
            garmin.login()
            garmin.client.dump(str(session_file))
            print("  Sesion guardada")
        print("  Autenticacion exitosa")
    except Exception as e:
        print(f"  Error de autenticacion: {e}")
        sys.exit(1)

    dates = date_range(START_DATE, END_DATE)
    print(f"  {len(dates)} dias de datos")

    # SOLO DESCARGAR (sin Supabase)
    if args.no_supabase:
        print("Descargando datos a output/ ...")
        output = Path(__file__).parent / "output"
        output.mkdir(exist_ok=True)

        steps = garmin.get_daily_steps(START_DATE, END_DATE)
        with open(output / "steps.json", "w", encoding="utf-8") as f:
            json.dump(steps, f, ensure_ascii=False, indent=2, default=str)

        sleep = fetch_by_day(garmin, "get_sleep_data", dates)
        with open(output / "sleep.json", "w", encoding="utf-8") as f:
            json.dump(sleep, f, ensure_ascii=False, indent=2, default=str)

        body = fetch_by_day(garmin, "get_body_battery", dates)
        with open(output / "body_battery.json", "w", encoding="utf-8") as f:
            json.dump(body, f, ensure_ascii=False, indent=2, default=str)

        hr = fetch_by_day(garmin, "get_heart_rates", dates)
        with open(output / "heart_rate.json", "w", encoding="utf-8") as f:
            json.dump(hr, f, ensure_ascii=False, indent=2, default=str)

        stress = fetch_by_day(garmin, "get_all_day_stress", dates)
        with open(output / "stress.json", "w", encoding="utf-8") as f:
            json.dump(stress, f, ensure_ascii=False, indent=2, default=str)

        hrv = fetch_by_day(garmin, "get_hrv_data", dates)
        with open(output / "hrv.json", "w", encoding="utf-8") as f:
            json.dump(hrv, f, ensure_ascii=False, indent=2, default=str)

        resp = fetch_by_day(garmin, "get_respiration_data", dates)
        with open(output / "respiration.json", "w", encoding="utf-8") as f:
            json.dump(resp, f, ensure_ascii=False, indent=2, default=str)

        spo2 = fetch_by_day(garmin, "get_spo2_data", dates)
        with open(output / "spo2.json", "w", encoding="utf-8") as f:
            json.dump(spo2, f, ensure_ascii=False, indent=2, default=str)

        activities = garmin.get_activities_by_date(START_DATE, END_DATE, "cycling")
        with open(output / "activities.json", "w", encoding="utf-8") as f:
            json.dump(activities, f, ensure_ascii=False, indent=2, default=str)

        print("  Datos descargados a output/")
        return

    # DESCARGAR Y SUBIR A SUPABASE
    print("Descargando datos de Garmin...")

    print("  Pasos...")
    steps = garmin.get_daily_steps(START_DATE, END_DATE)
    print(f"    {len(steps)} dias")

    print("  Sueno...")
    sleep = fetch_by_day(garmin, "get_sleep_data", dates)
    print(f"    {len(sleep)} dias")

    print("  Body Battery...")
    body = fetch_by_day(garmin, "get_body_battery", dates)
    print(f"    {len(body)} dias")

    print("  Frecuencia cardiaca...")
    hr = fetch_by_day(garmin, "get_heart_rates", dates)
    print(f"    {len(hr)} dias")

    print("  Estres...")
    stress = fetch_by_day(garmin, "get_all_day_stress", dates)
    print(f"    {len(stress)} dias")

    print("  HRV...")
    hrv = fetch_by_day(garmin, "get_hrv_data", dates)
    print(f"    {len(hrv)} dias")

    print("  Respiracion...")
    resp = fetch_by_day(garmin, "get_respiration_data", dates)
    print(f"    {len(resp)} dias")

    print("  SpO2...")
    spo2 = fetch_by_day(garmin, "get_spo2_data", dates)
    print(f"    {len(spo2)} dias")

    print("  Actividades de ciclismo...")
    activities = garmin.get_activities_by_date(START_DATE, END_DATE, "cycling")
    print(f"    {len(activities)} actividades")

        # SUBIR A SUPABASE
    print("Subiendo a Supabase...")

    print("  garmin_wellness...")
    wellness_rows = build_wellness_rows(steps, hr, stress, body, hrv, resp, spo2, sleep)
    ok, err = supabase_upsert("garmin_wellness", wellness_rows, START_DATE, END_DATE)
    if not ok:
        print(f"    [WARN] {err}")

    print("  garmin_hrv...")
    hrv_rows = build_hrv_rows(hrv)
    ok, err = supabase_upsert("garmin_hrv", hrv_rows, START_DATE, END_DATE)
    if not ok:
        print(f"    [WARN] {err}")

    print("  garmin_sleep...")
    sleep_rows = build_sleep_rows(sleep)
    ok, err = supabase_upsert("garmin_sleep", sleep_rows, START_DATE, END_DATE)
    if not ok:
        print(f"    [WARN] {err}")

    print("  garmin_sleep_analysis...")
    analysis_rows = build_sleep_analysis_rows(sleep)
    ok, err = supabase_upsert("garmin_sleep_analysis", analysis_rows, START_DATE, END_DATE)
    if not ok:
        print(f"    [WARN] {err}")

    print("  garmin_sleep_series...")
    series_rows = build_sleep_series_rows(sleep)
    ok, err = supabase_upsert("garmin_sleep_series", series_rows, START_DATE, END_DATE)
    if not ok:
        print(f"    [WARN] {err}")

    print("  garmin_activities...")
    activity_rows = build_activity_rows(activities)
    ok, err = supabase_upsert("garmin_activities", activity_rows, START_DATE, END_DATE)
    if not ok:
        print(f"    [WARN] {err}")

    print("\n" + "=" * 60)
    print("  SYNC COMPLETADO")
    print("  Datos de Garmin ahora en Supabase")
    print("  El bot puede leerlos desde el backend")
    print("=" * 60)

if __name__ == "__main__":
    main()