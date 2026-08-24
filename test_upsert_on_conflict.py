#!/usr/bin/env python3
"""
Pruebas del target de upsert (on_conflict) en supabase_upsert().

Usan MOCKS: cero llamadas de red, cero escrituras en Supabase.
"""

import sys
import os

# Envs dummy ANTES de importar el modulo
os.environ.setdefault("GARMIN_EMAIL", "demo@demo")
os.environ.setdefault("GARMIN_PASSWORD", "demo")
os.environ.setdefault("SUPABASE_URL", "https://demo.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "demo-key")
os.environ.setdefault("USER_ID", "user-demo")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import garmin_to_supabase as gs


class FakeResp:
    def __init__(self, status, payload=None, text=""):
        self.status_code = status
        self._payload = payload
        self.text = text

    def json(self):
        if self._payload is None:
            raise ValueError("sin body json")
        return self._payload


class FakeRequests:
    """Mock de requests: registra llamadas y nunca toca la red."""

    def __init__(self, post_status=201):
        self.calls = []
        self.post_status = post_status

    def post(self, url, headers=None, json=None, timeout=None):
        self.calls.append(("POST", url, headers))
        return FakeResp(self.post_status)

    def patch(self, url, headers=None, json=None, timeout=None):
        # Simula: la fila existe solo si el filtro incluye date=eq.2026-08-19
        matched = "date=eq.2026-08-19" in url or "activity_id=eq.24039396393" in url
        self.calls.append(("PATCH", url, headers))
        if matched:
            return FakeResp(200, payload=[{"ok": True}])
        return FakeResp(200, payload=[])


def build_wellness_row(date_str):
    row = {f: None for f in gs.WELLNESS_FIELDS}
    row["user_id"] = "user-demo"
    row["date"] = date_str
    return row


def run_case(table, rows, expected_fragment, fake=None):
    fr = fake if fake is not None else FakeRequests()
    gs.requests = fr
    ok, err = gs.supabase_upsert(table, rows, "2026-08-17", "2026-08-24")
    assert ok is True, f"{table}: se esperaba ok=True, obtuve {ok} ({err})"
    posts = [c for c in fr.calls if c[0] == "POST"]
    assert len(posts) == 1, f"{table}: se esperaba exactamente 1 POST"
    _, url, headers = posts[0]
    assert expected_fragment in url, (
        f"{table}: URL del POST deberia contener '{expected_fragment}'. URL={url}"
    )
    prefer = headers.get("Prefer", "")
    assert prefer == "resolution=merge-duplicates,return=minimal", (
        f"{table}: Prefer inesperado: {prefer}"
    )
    patches = [c for c in fr.calls if c[0] == "PATCH"]
    return url, prefer, patches


def test_on_conflict_wellness():
    url, _, _ = run_case(
        "garmin_wellness",
        [build_wellness_row("2026-08-19")],
        "?on_conflict=user_id,date",
    )
    assert "on_conflict=activity_id" not in url
    print("✓ on_conflict garmin_wellness  -> ?on_conflict=user_id,date")


def test_on_conflict_hrv():
    url, _, _ = run_case(
        "garmin_hrv",
        [build_wellness_row("2026-08-19")],
        "?on_conflict=user_id,date",
    )
    print("✓ on_conflict garmin_hrv       -> ?on_conflict=user_id,date")


def test_on_conflict_sleep():
    url, _, _ = run_case(
        "garmin_sleep",
        [build_wellness_row("2026-08-19")],
        "?on_conflict=user_id,date",
    )
    print("✓ on_conflict garmin_sleep     -> ?on_conflict=user_id,date")


def test_on_conflict_activities():
    act = {
        "activityId": "24039396393",
        "startTimeLocal": "2026-08-19 17:08:06",
        "activityType": {"typeKey": "cycling"},
    }
    url, _, _ = run_case(
        "garmin_activities",
        gs.build_activity_rows([act]),
        "?on_conflict=activity_id",
    )
    assert "on_conflict=user_id" not in url
    print("✓ on_conflict garmin_activities -> ?on_conflict=activity_id")


def test_patch_fallback_intacto():
    """Con POST 409, el PATCH usa la url base limpia (sin on_conflict) y cuenta bien."""
    fr = FakeRequests(post_status=409)
    post_url, _, patches = run_case(
        "garmin_wellness",
        [build_wellness_row("2026-08-17"), build_wellness_row("2026-08-19")],
        "?on_conflict=user_id,date",
        fake=fr,
    )
    assert len(patches) == 2, f"se esperaban 2 PATCH, hubo {len(patches)}"
    base_url = post_url.split("?")[0]  # url sin query -> lo que usa el PATCH
    for _, purl, pheaders in patches:
        assert purl.startswith(base_url + "?"), f"patch_url inesperada: {purl}"
        assert "on_conflict" not in purl, f"el PATCH no debe llevar on_conflict: {purl}"
        assert "return=representation" in pheaders.get("Prefer", "")
    updated = sum(1 for _, purl, _ in patches if "2026-08-19" in purl)
    assert updated == 1
    print("✓ PATCH fallback intacto: sin on_conflict, filtros y conteo correctos")


def test_post_exitoso_no_llama_patch():
    """Si el POST resuelve (<400), no debe ejecutarse ningun PATCH."""
    fr = FakeRequests(post_status=201)
    gs.requests = fr
    ok, err = gs.supabase_upsert(
        "garmin_wellness", [build_wellness_row("2026-08-17")], "2026-08-17", "2026-08-24"
    )
    assert ok is True
    patches = [c for c in fr.calls if c[0] == "PATCH"]
    assert len(patches) == 0, "con POST exitoso no deberia haber PATCH"
    print("✓ POST exitoso -> sin PATCH (camino feliz)")


if __name__ == "__main__":
    print("Ejecutando pruebas de on_conflict en supabase_upsert()...\n")
    try:
        test_on_conflict_wellness()
        test_on_conflict_hrv()
        test_on_conflict_sleep()
        test_on_conflict_activities()
        test_patch_fallback_intacto()
        test_post_exitoso_no_llama_patch()

        print("\n" + "=" * 60)
        print("✅ TODOS LOS TESTS DE ON_CONFLICT PASARON CORRECTAMENTE")
        print("=" * 60)
    except AssertionError as e:
        print(f"\n❌ TEST FALLÓ: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ ERROR INESPERADO: {type(e).__name__}: {e}")
        sys.exit(1)