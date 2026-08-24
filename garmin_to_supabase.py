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
- garmin_activities: actividades
"""

import os
import json
import sys
import argparse
import time
from datetime import datetime, timedelta
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
        row_date = row.get("date")
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

    # Proceder con el UPSERT solo para filas válidas
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal"
    }

    # Primero intentar POST con upsert
    try:
        resp = requests.post(url, headers=headers, json=valid_rows, timeout=30)
        if resp.status_code < 400:
            print(f"    [OK] {len(valid_rows)} filas procesadas mediante UPSERT en {table}")
            return True, None
        if resp.status_code != 409:
            print(f"    [ERROR] {resp.status_code}: {resp.text[:200]}")
            return False, resp.text
        # 409 = conflictos de duplicados -> usar PATCH por fila
    except Exception as e:
        print(f"    [ERROR] Conexion Supabase: {e}")
        return False, str(e)

    # PATCH por fila (fallback cuando ya existen)
    updated = 0
    for row in valid_rows:
        # Construir filtro segun la clave unica de cada tabla
        if table == "garmin_activities":
            filters = f"activity_id=eq.{row['activity_id']}"
        else:
            filters = f"user_id=eq.{row['user_id']}&date=eq.{row['date']}"
        patch_url = f"{url}?{filters}"
        headers_patch = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
        }
        try:
            r = requests.patch(patch_url, headers=headers_patch, json=row, timeout=30)
            if r.status_code < 400:
                updated += 1
        except Exception:
            pass
    print(f"    [OK] {updated} filas actualizadas en {table} (PATCH)")
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