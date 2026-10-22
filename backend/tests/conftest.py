import json

import pytest

from app import main


@pytest.fixture(autouse=True)
def temporary_knowledge_file(tmp_path, monkeypatch):
    knowledge = tmp_path / "knowledge.json"
    knowledge.write_text(
        json.dumps(
            [
                {
                    "id": "test-profile",
                    "title": "Verified test profile",
                    "content": "Synthetic data used only by unit tests.",
                    "answers": {"Full Name": "Verified Example"},
                }
            ]
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(main, "DOCUMENTS_PATH", knowledge)
    monkeypatch.delenv("AUTH_REQUIRED", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
