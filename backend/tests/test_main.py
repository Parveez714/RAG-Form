from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_reports_demo_mode() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_unknown_fields_are_never_fabricated() -> None:
    response = client.post(
        "/fill-suggestions",
        json={
            "fields": [
                {
                    "id": "field-1",
                    "label": "Passport number",
                    "type": "text",
                    "required": True,
                    "options": [],
                }
            ]
        },
    )
    assert response.status_code == 200
    suggestion = response.json()["suggestions"][0]
    assert suggestion["proposed_value"] == ""
    assert suggestion["confidence"] == 0
    assert suggestion["source"] is None
    assert suggestion["needs_review"] is True


def test_exact_answer_key_match_has_citation() -> None:
    response = client.post(
        "/fill-suggestions",
        json={
            "fields": [
                {
                    "id": "field-1",
                    "label": "Full Name",
                    "type": "text",
                    "required": True,
                    "options": [],
                }
            ]
        },
    )
    assert response.status_code == 200
    suggestion = response.json()["suggestions"][0]
    assert suggestion["proposed_value"] == "Verified Example"
    assert suggestion["confidence"] == 0.9
    assert suggestion["source"]["document_id"] == "test-profile"


def test_invalid_field_type_is_rejected() -> None:
    response = client.post(
        "/fill-suggestions",
        json={"fields": [{"id": "x", "label": "Password", "type": "password"}]},
    )
    assert response.status_code == 422


def test_auth_required_fails_closed(monkeypatch) -> None:
    monkeypatch.setenv("AUTH_REQUIRED", "true")
    response = client.post("/fill-suggestions", json={"fields": []})
    assert response.status_code == 401
