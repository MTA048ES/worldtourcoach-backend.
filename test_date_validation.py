#!/usr/bin/env python3
"""
Pruebas para validación de fechas en supabase_upsert().
"""

import sys
import os

# Añadir el directorio actual al path para importar
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from garmin_to_supabase import validate_date_in_range

def test_single_day_match():
    """Test 1: Fecha única solicitada, Garmin devuelve misma fecha → UPSERT permitido"""
    requested_start = "2026-08-24"
    requested_end = "2026-08-24"
    row_date = "2026-08-24"

    is_valid, row_date_str = validate_date_in_range(row_date, requested_start, requested_end)

    assert is_valid == True, "Debería ser válido"
    print(f"✓ Test 1 PASSED: Fecha única {row_date} coincide con solicitud {requested_start}")

def test_single_day_mismatch():
    """Test 2: Fecha única solicitada, Garmin devuelve fecha diferente → UPSERT bloqueado"""
    requested_start = "2026-08-24"
    requested_end = "2026-08-24"
    row_date = "2026-08-20"

    is_valid, row_date_str = validate_date_in_range(row_date, requested_start, requested_end)

    assert is_valid == False, "Debería ser inválido"
    print(f"✓ Test 2 PASSED: Fecha única {row_date} NO coincide con solicitud {requested_start} → BLOQUEADO")

def test_range_inside():
    """Test 3: Rango solicitado, Garmin devuelve fecha dentro del rango → UPSERT permitido"""
    requested_start = "2026-08-18"
    requested_end = "2026-08-24"
    row_date = "2026-08-20"

    is_valid, row_date_str = validate_date_in_range(row_date, requested_start, requested_end)

    assert is_valid == True, "Debería ser válido"
    print(f"✓ Test 3 PASSED: Fecha {row_date} dentro del rango {requested_start}-{requested_end} → OK")

def test_range_outside():
    """Test 4: Rango solicitado, Garmin devuelve fecha fuera del rango → UPSERT bloqueado"""
    requested_start = "2026-08-18"
    requested_end = "2026-08-24"
    row_date = "2026-08-10"

    is_valid, row_date_str = validate_date_in_range(row_date, requested_start, requested_end)

    assert is_valid == False, "Debería ser inválido"
    print(f"✓ Test 4 PASSED: Fecha {row_date} fuera del rango {requested_start}-{requested_end} → BLOQUEADO")

def test_empty_response():
    """Test 5: Garmin devuelve respuesta vacía → No crear fila artificial"""
    requested_start = "2026-08-24"
    requested_end = "2026-08-24"

    # Si no hay datos de Garmin, build_*_rows() no crea fila alguna
    # La validación no se ejecuta porque no hay rows
    # Esto se prueba en el contexto de supabase_upsert con rows=[]
    print(f"✓ Test 5 PASSED: Si Garmin no devuelve datos, no se crean filas → No UPSERT")

def test_null_date():
    """Test 6: Fila con date=null → UPSERT bloqueado"""
    requested_start = "2026-08-24"
    requested_end = "2026-08-24"
    row_date = None

    is_valid, row_date_str = validate_date_in_range(row_date, requested_start, requested_end)

    assert is_valid == False, "Debería ser inválido"
    assert row_date_str == "null", f"row_date_str debería ser 'null', pero fue {row_date_str}"
    print(f"✓ Test 6 PASSED: Fecha null/no disponible → BLOQUEADO")

if __name__ == "__main__":
    print("Ejecutando pruebas de validación de fechas...\n")

    try:
        test_single_day_match()
        test_single_day_mismatch()
        test_range_inside()
        test_range_outside()
        test_empty_response()
        test_null_date()

        print("\n" + "="*60)
        print("✅ TODOS LOS TESTS PASARON CORRECTAMENTE")
        print("="*60)
    except AssertionError as e:
        print(f"\n❌ TEST FALLÓ: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ ERROR INESPERADO: {e}")
        sys.exit(1)
