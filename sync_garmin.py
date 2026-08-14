#!/usr/bin/env python3
"""
sync_garmin.py — Orquestador de sincronización Garmin → Supabase
=================================================================

Este script es un ORQUESTADOR. No implementa lógica de Garmin, Supabase,
UPSERT, build_*_rows ni gestión de sesión. Reutiliza exclusivamente las
funciones y mecanismos ya existentes en `garmin_to_supabase.py`.

Arquitectura:
    GitHub Actions
    → descarga sesión Garmin (session/garmin_session)
    → ejecuta sync_garmin.py
    → sync_garmin.py calcula ventana temporal (últimos N días)
    → carga/reutiliza sesión existente
    → utiliza funciones Garmin EXISTENTES (get_daily_steps, get_sleep_data, etc.)
    → utiliza build_*_rows EXISTENTES
    → utiliza UPSERT EXISTENTE (supabase_upsert)
    → guarda sesión Garmin actualizada
    → GitHub Actions conserva la sesión para la siguiente ejecución.

Uso:
    python sync_garmin.py [--days N] [--mfa CODE]

Variables de entorno (definidas en .env o GitHub Secrets):
    GARMIN_EMAIL, GARMIN_PASSWORD, SUPABASE_URL, SUPABASE_ANON_KEY, USER_ID
"""

import os
import sys
import json
import argparse
from datetime import datetime, timedelta
from pathlib import Path

# Configurar salida UTF-8
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from dotenv import load_dotenv
load_dotenv()

# Importar todo lo necesario desde el módulo existente
# No duplicamos funciones: reutilizamos build_*_rows, supabase_upsert, fetch_by_day, etc.
from garmin_to_supabase import (
    Garmin,
    EMAIL,
    PASSWORD,
    SUPABASE_URL,
    SUPABASE_KEY,
    USER_ID,
    SESSION_DIR,
    date_range,
    fetch_by_day,
    build_wellness_rows,
    build_hrv_rows,
    build_sleep_rows,
    build_activity_rows,
    supabase_upsert,
)


def calculate_date_window(days: int):
    """
    Calcula dinámicamente la ventana de fechas a partir de la fecha actual.
    No hardcodea fechas.
    """
    end_date = datetime.now().strftime("%Y-%m-%d")
    start_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    return start_date, end_date


def load_garmin_session(session_file: Path):
    """
    Carga la sesión Garmin existente desde session/garmin_session.
    Reutiliza exactamente el mecanismo de garminconnect.Garmin.login(path).
    No crea un sistema de sesiones paralelo.
    """
    garmin = Garmin()
    garmin.login(str(session_file))
    return garmin


def authenticate_garmin(session_file: Path, mfa_code: str = None):
    """
    Gestiona la autenticación de Garmin.
    - Si existe una sesión válida en session/garmin_session, la reutiliza.
    - Si la sesión expiró, usa la lógica de autenticación EXISTENTE en garmin_to_supabase.py.
    - Las credenciales provienen de las variables de entorno existentes (EMAIL, PASSWORD).
    - El código MFA se pasa como argumento si es necesario.
    """
    if session_file.exists():
        print("  Usando sesión guardada...")
        try:
            garmin = load_garmin_session(session_file)
            print("  Autenticación exitosa (sesión reutilizada)")
            return garmin
        except Exception as e:
            print(f"  [WARN] Sesión expirada o inválida: {type(e).__name__}")
            # La sesión expiró; caer al login con credenciales

    print("  Iniciando sesión con credenciales...")

    def get_mfa_code():
        if mfa_code:
            return mfa_code
        print()
        print("  GARMIN REQUIERE VERIFICACIÓN EN DOS PASOS")
        print("  Revisa tu correo para el código de seguridad")
        return input("  Código de seguridad (6 dígitos): ").strip()

    garmin = Garmin(
        email=EMAIL,
        password=PASSWORD,
        prompt_mfa=get_mfa_code,
    )
    garmin.login()
    garmin.garth.dump(str(session_file))
    print("  Sesión guardada")
    print("  Autenticación exitosa")
    return garmin


def save_garmin_session(garmin, session_file: Path):
    """
    Guarda la sesión Garmin actualizada en session/garmin_session.
    Mantiene exactamente el formato que utiliza garth.dump().
    """
    session_file.parent.mkdir(parents=True, exist_ok=True)
    garmin.garth.dump(str(session_file))


def sync_data(garmin, start_date: str, end_date: str):
    """
    Descarga datos de Garmin y los sube a Supabase.
    Reutiliza las funciones EXISTENTES de garmin_to_supabase.py:
    - garmin.get_daily_steps, garmin.get_sleep_data, etc.
    - fetch_by_day
    - build_*_rows
    - supabase_upsert
    """
    dates = date_range(start_date, end_date)
    print(f"  {len(dates)} días de datos ({start_date} -> {end_date})")

    # --- Descargar datos de Garmin ---
    print("Descargando datos de Garmin...")

    print("  Pasos...")
    steps = garmin.get_daily_steps(start_date, end_date)
    print(f"    {len(steps)} días")

    print("  Sueño...")
    sleep = fetch_by_day(garmin, "get_sleep_data", dates)
    print(f"    {len(sleep)} días")

    print("  Body Battery...")
    body = fetch_by_day(garmin, "get_body_battery", dates)
    print(f"    {len(body)} días")

    print("  Frecuencia cardíaca...")
    hr = fetch_by_day(garmin, "get_heart_rates", dates)
    print(f"    {len(hr)} días")

    print("  Estrés...")
    stress = fetch_by_day(garmin, "get_all_day_stress", dates)
    print(f"    {len(stress)} días")

    print("  HRV...")
    hrv = fetch_by_day(garmin, "get_hrv_data", dates)
    print(f"    {len(hrv)} días")

    print("  Respiración...")
    resp = fetch_by_day(garmin, "get_respiration_data", dates)
    print(f"    {len(resp)} días")

    print("  SpO2...")
    spo2 = fetch_by_day(garmin, "get_spo2_data", dates)
    print(f"    {len(spo2)} días")

    print("  Actividades de ciclismo...")
    activities = garmin.get_activities_by_date(start_date, end_date, "cycling")
    print(f"    {len(activities)} actividades")

    # --- Construir filas con build_*_rows EXISTENTES ---
    print("Construyendo filas...")

    wellness_rows = build_wellness_rows(steps, hr, stress, body, hrv, resp, spo2, sleep)
    hrv_rows = build_hrv_rows(hrv)
    sleep_rows = build_sleep_rows(sleep)
    activity_rows = build_activity_rows(activities)

    # --- Subir a Supabase con UPSERT EXISTENTE ---
    print("Subiendo a Supabase...")

    upsert_results = []

    print("  garmin_wellness...")
    ok, err = supabase_upsert("garmin_wellness", wellness_rows)
    if not ok:
        print(f"    [ERROR] {err}")
        upsert_results.append(("garmin_wellness", err))
    else:
        upsert_results.append(("garmin_wellness", None))

    print("  garmin_hrv...")
    ok, err = supabase_upsert("garmin_hrv", hrv_rows)
    if not ok:
        print(f"    [ERROR] {err}")
        upsert_results.append(("garmin_hrv", err))
    else:
        upsert_results.append(("garmin_hrv", None))

    print("  garmin_sleep...")
    ok, err = supabase_upsert("garmin_sleep", sleep_rows)
    if not ok:
        print(f"    [ERROR] {err}")
        upsert_results.append(("garmin_sleep", err))
    else:
        upsert_results.append(("garmin_sleep", None))

    print("  garmin_activities...")
    ok, err = supabase_upsert("garmin_activities", activity_rows)
    if not ok:
        print(f"    [ERROR] {err}")
        upsert_results.append(("garmin_activities", err))
    else:
        upsert_results.append(("garmin_activities", None))

    # Si cualquier UPSERT falló, la sincronización se considera fallida
    failed = [(table, err) for table, err in upsert_results if err is not None]
    if failed:
        error_msg = "; ".join([f"{table}: {err}" for table, err in failed])
        raise RuntimeError(f"Falló el UPSERT en: {error_msg}")


def main():
    parser = argparse.ArgumentParser(
        description="Orquestador de sincronización Garmin → Supabase (GitHub Actions)"
    )
    parser.add_argument(
        "--days",
        type=int,
        default=7,
        help="Número de días hacia atrás para sincronizar (default: 7)",
    )
    parser.add_argument(
        "--mfa",
        help="Código de seguridad de 6 dígitos (2FA) si Garmin lo requiere",
    )
    args = parser.parse_args()

    # Validar credenciales
    if not EMAIL or not PASSWORD:
        print("[ERROR] Falta GARMIN_EMAIL o GARMIN_PASSWORD en .env o GitHub Secrets")
        sys.exit(1)

    # Calcular ventana temporal dinámicamente
    start_date, end_date = calculate_date_window(args.days)

    print("=" * 60)
    print("  GARMIN → SUPABASE SYNC (Automatizado)")
    print("=" * 60)
    print(f"  Rango: {start_date} -> {end_date}")
    print(f"  Supabase: {SUPABASE_URL}")
    print(f"  User ID: {USER_ID}")
    print()

    # Ruta de la sesión Garmin (misma que usa garmin_to_supabase.py)
    session_file = SESSION_DIR / "garmin_session"

    # Autenticación: reutiliza sesión existente o autentica con credenciales
    print("Conectando a Garmin Connect...")
    try:
        garmin = authenticate_garmin(session_file, args.mfa)
    except Exception as e:
        print(f"  [ERROR] Error de autenticación: {e}")
        sys.exit(1)

    # Sincronizar datos
    try:
        sync_data(garmin, start_date, end_date)
    except Exception as e:
        print(f"\n[ERROR] Falló la sincronización: {type(e).__name__}: {e}")
        # Guardar la sesión incluso si falla la sincronización
        try:
            save_garmin_session(garmin, session_file)
            print("  Sesión guardada (aunque la sincronización falló)")
        except Exception:
            pass
        sys.exit(1)

    # Guardar sesión actualizada
    try:
        save_garmin_session(garmin, session_file)
        print("  Sesión Garmin actualizada y guardada")
    except Exception as e:
        print(f"  [WARN] No se pudo guardar la sesión: {e}")

    print("\n" + "=" * 60)
    print("  SYNC COMPLETADO")
    print("  Datos de Garmin ahora en Supabase")
    print("  El bot puede leerlos desde el backend")
    print("=" * 60)


if __name__ == "__main__":
    main()
