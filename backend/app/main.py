from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Literal

import httpx
import requests
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

# Load .env file from project root or parent directories
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent.parent / ".env")
load_dotenv()

DOCUMENTS_PATH = Path(os.getenv("KNOWLEDGE_FILE", Path(__file__).parent / "knowledge.json"))
TOKEN_PATTERN = re.compile(r"[a-z0-9]+", re.IGNORECASE)

PRIMARY_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
EXTERNAL_RAG_API_URL = os.getenv("RAG_API_URL", "").strip()
EXTERNAL_RAG_API_KEY = os.getenv("RAG_API_KEY", "").strip()
AUTH_REQUIRED = os.getenv("AUTH_REQUIRED", "false").lower() == "true"
ALLOWED_ISSUER = os.getenv("AUTH_ISSUER", "").strip()
ALLOWED_AUDIENCE = os.getenv("AUTH_AUDIENCE", "").strip()

logger = logging.getLogger("uvicorn.error")


class SelectOption(BaseModel):
    value: str
    label: str


class FormField(BaseModel):
    id: str
    label: str = Field(min_length=1, max_length=500)
    type: Literal[
        "text", "email", "tel", "url", "number", "date",
        "select", "checkbox", "radio", "textarea",
    ]
    required: bool = False
    options: list[SelectOption | str] = Field(default_factory=list, max_length=200)


class FillRequest(BaseModel):
    fields: list[FormField] = Field(max_length=200)
    user_email: str | None = Field(default=None, description="Logged in user email identifier for scoping RAG data")


class SourceCitation(BaseModel):
    document_id: str
    title: str
    excerpt: str


class FillSuggestion(BaseModel):
    field_id: str
    proposed_value: str
    confidence: float = Field(ge=0, le=1)
    source: SourceCitation | None
    needs_review: bool
    reason: str | None


class FillResponse(BaseModel):
    suggestions: list[FillSuggestion]


app = FastAPI(title="Embassy Form Assistant API", version="0.2.0")
allowed_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "*").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)

# Serve extension .crx package and updates.xml for enterprise deployment
static_dir = Path(__file__).parent / "static"
if static_dir.exists():
    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")


@app.get("/health")
def health() -> dict[str, str]:
    has_external_rag = bool(EXTERNAL_RAG_API_URL)
    has_gemini = bool(os.getenv("GEMINI_API_KEY"))

    if has_external_rag:
        mode = "external-rag-service"
        model_info = EXTERNAL_RAG_API_URL
    elif has_gemini:
        mode = "gemini-rag"
        model_info = PRIMARY_MODEL
    else:
        mode = "local-exact-match-fallback"
        model_info = "none"

    return {
        "status": "ok",
        "mode": mode,
        "model": model_info,
        "auth_enforced": str(AUTH_REQUIRED),
    }


@app.get("/test-form", response_class=HTMLResponse)
def get_test_form() -> str:
    test_form_file = Path(__file__).parent / "test_form.html"
    if not test_form_file.exists():
        raise HTTPException(status_code=404, detail="Test form not found.")
    return test_form_file.read_text(encoding="utf-8")


@app.post("/fill-suggestions", response_model=FillResponse)
def fill_suggestions(
    request: FillRequest,
    authorization: str | None = Header(default=None),
) -> FillResponse:
    validated_email = validate_authorization(authorization)
    target_email = request.user_email or validated_email or os.getenv("DEFAULT_USER_EMAIL", "parveezbackup@gmail.com")

    # 1. Production Path: Delegate to external Enterprise/Cloud RAG API if configured
    if EXTERNAL_RAG_API_URL:
        try:
            return call_external_rag_api(request, authorization)
        except Exception as error:
            logger.exception("External RAG API invocation failed: %s", error)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Enterprise RAG service unavailable: {error}",
            )

    # 2. Local/Direct LLM RAG Mode scoped to user email
    all_documents = load_documents()
    user_documents = filter_documents_by_user(all_documents, target_email)

    gemini_key = os.getenv("GEMINI_API_KEY")
    if gemini_key and gemini_key.strip():
        try:
            return llm_suggest_fields(request.fields, user_documents, gemini_key.strip())
        except Exception as error:
            logger.exception("Gemini RAG failed, falling back to local exact match: %s", error)

    # 3. Fallback: Exact match against filtered user documents
    return FillResponse(
        suggestions=[fallback_suggest_field(field, user_documents) for field in request.fields]
    )


def filter_documents_by_user(documents: list[dict[str, object]], user_email: str | None) -> list[dict[str, object]]:
    if not user_email:
        return documents
    normalized_email = user_email.strip().lower()
    matched = [
        doc for doc in documents
        if str(doc.get("email", "")).strip().lower() == normalized_email
    ]
    # If the user has specific documents, return only those; otherwise return all
    return matched if matched else [documents[0]]


def call_external_rag_api(request: FillRequest, authorization: str | None) -> FillResponse:
    headers: dict[str, str] = {
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    # Pass along downstream authorization or configure API key
    if authorization:
        headers["Authorization"] = authorization
    elif EXTERNAL_RAG_API_KEY:
        headers["Authorization"] = f"Bearer {EXTERNAL_RAG_API_KEY}"
        headers["x-api-key"] = EXTERNAL_RAG_API_KEY

    with httpx.Client(timeout=30.0) as client:
        response = client.post(
            EXTERNAL_RAG_API_URL,
            json=request.model_dump(),
            headers=headers,
        )
        if response.status_code >= 400:
            raise RuntimeError(f"HTTP {response.status_code}: {response.text[:300]}")
        data = response.json()
        return FillResponse.model_validate(data)


def validate_authorization(authorization: str | None) -> str | None:
    auth_required = os.getenv("AUTH_REQUIRED", "false").lower() == "true"
    if not auth_required:
        if authorization is not None and not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Invalid authorization header.")
        return None

    if authorization is None or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Bearer access token required.",
        )

    # In production, inspect token structure or verify with identity provider
    token = authorization[len("Bearer ") :].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Bearer token is empty.")

    # Lightweight JWT inspection: ensure it contains valid JWT segments (header.payload.signature)
    parts = token.split(".")
    if len(parts) != 3:
        raise HTTPException(status_code=401, detail="Malformed JWT access token.")

    # Extract user email from JWT payload if present (without full signature check in demo mode)
    try:
        import base64
        payload_b64 = parts[1] + "=="
        payload_json = json.loads(base64.urlsafe_b64decode(payload_b64.encode()))
        return payload_json.get("email") or payload_json.get("preferred_username") or payload_json.get("upn")
    except Exception:
        return None


def load_documents() -> list[dict[str, object]]:
    if not DOCUMENTS_PATH.exists():
        return []
    try:
        data = json.loads(DOCUMENTS_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise HTTPException(status_code=500, detail=f"Could not load knowledge file: {error}") from error
    if not isinstance(data, list):
        raise HTTPException(status_code=500, detail="Knowledge file must contain a JSON array.")
    return data


def serialize_field(f: FormField) -> dict[str, Any]:
    serialized_options = []
    for opt in f.options:
        if isinstance(opt, SelectOption):
            serialized_options.append({"value": opt.value, "label": opt.label})
        elif isinstance(opt, dict):
            serialized_options.append(opt)
        else:
            serialized_options.append({"value": str(opt), "label": str(opt)})
    return {
        "id": f.id,
        "label": f.label,
        "type": f.type,
        "required": f.required,
        "options": serialized_options,
    }


def llm_suggest_fields(
    fields: list[FormField],
    documents: list[dict[str, object]],
    api_key: str,
) -> FillResponse:
    doc_context = []
    for doc in documents:
        doc_id = doc.get("id", "doc-0")
        title = doc.get("title", "Document")
        content = doc.get("content", "")
        doc_context.append(f"--- Document ID: {doc_id} | Title: {title} ---\n{content}\n")
    knowledge_str = "\n".join(doc_context)

    fields_json = json.dumps([serialize_field(f) for f in fields], indent=2)

    prompt = f"""You are an autonomous AI web form assistant.
You inspect unknown web forms from any website and accurately map facts from background documents into the exact value each website control expects.

### CRITICAL RULES FOR GENERAL WEBSITES:
1. Strict Grounding & Zero Cross-Field Inference:
   - Every field must be independently verified by direct evidence in the source documents.
   - Do NOT extrapolate, borrow, or generalize evidence across logically distinct questions or topics. A negative, positive, or neutral statement about one attribute or declaration never implies anything about another distinct attribute or question.
   - If a specific question, declaration, or form field is not directly addressed by clear statements in the documents:
     - Set proposed_value to ""
     - Set confidence to 0.0
     - Set source to null
     - Set needs_review to true
     - Set reason to an explicit statement that no direct evidence exists in the documents for this specific field.
   - Never assume defaults or guess answers for legal, governmental, compliance, or personal history questions.
2. Form Control Value Mapping:
   - For 'select' or 'radio' inputs with options:
     Look at the `options` array. Each option has a `value` (what the HTML code expects) and a `label` (what human eyes see on the webpage).
     Determine the semantically matching option based on its label/meaning, BUT return the exact `value` attribute string as `proposed_value` so the browser's DOM can select it without guessing!
   - For 'checkbox': return 'yes' if affirmed in the context, otherwise 'no'.
   - For 'date': return ISO format YYYY-MM-DD.
   - For text/number/textarea: return the direct extracted string or calculated number.
3. Citations:
   - Include the document_id, title, and a short excerpt (under 300 chars) as evidence.
   - If no information exists to answer a field, set proposed_value to "", confidence to 0, source to null, and explain in reason.
4. Confidence: Return a float between 0.0 and 1.0 (0.90 to 0.99 for clear facts).

### Knowledge Documents:
{knowledge_str}

### Target Web Form Fields:
{fields_json}

Return your answer as a JSON object with this exact schema:
{{
  "suggestions": [
    {{
      "field_id": "field id matching input",
      "proposed_value": "exact value attribute required by DOM",
      "confidence": 0.95,
      "source": {{
        "document_id": "...",
        "title": "...",
        "excerpt": "..."
      }} or null,
      "needs_review": false,
      "reason": "short explanation"
    }}
  ]
}}
"""

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{PRIMARY_MODEL}:generateContent?key={api_key}"
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.1,
        },
    }

    logger.info("Calling Gemini RAG with model %s...", PRIMARY_MODEL)
    resp = requests.post(url, json=body, timeout=25)
    if resp.status_code != 200:
        logger.error("Model %s returned HTTP %s: %s", PRIMARY_MODEL, resp.status_code, resp.text)
        raise RuntimeError(f"Gemini API returned {resp.status_code}: {resp.text[:200]}")

    resp_json = resp.json()
    candidates = resp_json.get("candidates", [])
    if not candidates:
        raise RuntimeError("No candidates returned from Gemini.")

    parts = candidates[0].get("content", {}).get("parts", [])
    if not parts or "text" not in parts[0]:
        raise RuntimeError("No text part in Gemini response.")

    response_text = parts[0]["text"]
    result_json = json.loads(response_text)
    suggestions_map = {
        item["field_id"]: item
        for item in result_json.get("suggestions", [])
        if "field_id" in item
    }

    results: list[FillSuggestion] = []
    for f in fields:
        s = suggestions_map.get(f.id)
        if s:
            source_data = s.get("source")
            citation = None
            if isinstance(source_data, dict) and source_data.get("document_id"):
                citation = SourceCitation(
                    document_id=str(source_data.get("document_id", "")),
                    title=str(source_data.get("title", "")),
                    excerpt=str(source_data.get("excerpt", ""))[:500],
                )
            results.append(
                FillSuggestion(
                    field_id=f.id,
                    proposed_value=str(s.get("proposed_value", "")),
                    confidence=float(s.get("confidence", 0.8)),
                    source=citation,
                    needs_review=bool(s.get("needs_review", False)),
                    reason=str(s.get("reason", "Inferred by Gemini")),
                )
            )
        else:
            results.append(fallback_suggest_field(f, documents))

    return FillResponse(suggestions=results)


def fallback_suggest_field(field: FormField, documents: list[dict[str, object]]) -> FillSuggestion:
    normalized_label = normalize(field.label)
    for document in documents:
        answers = document.get("answers")
        if not isinstance(answers, dict):
            continue
        for label, value in answers.items():
            if not isinstance(label, str) or not isinstance(value, str):
                continue
            if normalize(label) == normalized_label and value.strip():
                citation = SourceCitation(
                    document_id=str(document.get("id", "unknown")),
                    title=str(document.get("title", "Untitled source")),
                    excerpt=str(document.get("content", ""))[:500],
                )
                return FillSuggestion(
                    field_id=field.id,
                    proposed_value=value,
                    confidence=0.9,
                    source=citation,
                    needs_review=False,
                    reason="Exact approved answer-key match; verify the value before filling.",
                )

    return FillSuggestion(
        field_id=field.id,
        proposed_value="",
        confidence=0,
        source=None,
        needs_review=True,
        reason="No match found. Please verify or configure Gemini API for automated RAG reasoning.",
    )


def normalize(value: str) -> str:
    return " ".join(TOKEN_PATTERN.findall(value.casefold()))
