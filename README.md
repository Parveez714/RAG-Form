# Embassy Form Assistant

A Chrome/Edge Manifest V3 starter with a WXT + React extension and a local FastAPI suggestion service. The extension scans only user-approved origins, sends field metadata (not page text or existing field values) to the backend, and requires a separate user action to fill each suggestion. It never submits forms.

## Local development

1. Install Node.js 22+ and Python 3.11+.
2. Install extension dependencies and build:

   ```powershell
   npm install
   npm run build
   ```

3. Start the local API from the `backend` directory:

   ```powershell
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
   ```

4. Open `chrome://extensions` or `edge://extensions`, enable Developer mode, and load `.output/chrome-mv3` as an unpacked extension.
5. Open extension Options. Add the exact HTTPS origin of a test form site (localhost HTTP is allowed for development), save, and approve the API host permission when prompted. Open a form tab, click the extension toolbar button, then scan.

`npm run dev` starts WXT's development workflow. Use `npm run zip` to package a production build.

## Local answer-key demo

The backend is intentionally not presented as a production RAG/LLM service. Until an approved retrieval provider is configured, it performs exact label matches against `backend/app/knowledge.json`; unmatched fields receive an empty value, zero confidence, and no citation. Add only verified, access-controlled facts in this format:

```json
[
  {
    "id": "profile-document-1",
    "title": "Verified profile",
    "content": "Evidence excerpt supporting the answer.",
    "answers": {
      "Full legal name": "A verified value"
    }
  }
]
```

The demo answer file is local application data and must not be committed with real personal data. Use a secured document store, per-user retrieval authorization, and a grounded LLM mapping provider before production use.

## Authentication and security boundaries

- Entra sign-in is optional. Register the extension's `chrome.identity.getRedirectURL("entra")` value as a **Single-page application (SPA)** redirect URI and configure the tenant, public client ID, and API scope in Options. The extension uses authorization code + PKCE and keeps only the short-lived access token in `chrome.storage.session`.
- This starter backend does **not** validate JWTs. `AUTH_REQUIRED=true` deliberately fails closed with HTTP 503 rather than pretending to validate a token. Do not expose it to a network or use it with real user data until real issuer, audience, signature, and tenant/authorization checks are implemented.
- The local API allows CORS from any origin by default for local development. Set `CORS_ORIGINS` to explicit extension origins before deployment.
- Configure HTTPS for non-local backend URLs. The extension requests optional host permission only for the configured API origin. Approved form sites are not permanent host permissions; inspection uses `activeTab` + `scripting` after the user opens the extension on that tab.
- Collected field data is limited to label, type, required state, and select/radio options. Password, hidden, file, and submit controls are excluded. Avoid including sensitive values in document citations or backend logs.
- Configure and deploy a production backend with JWT validation, rate limits, PII-safe audit events, retrieval ACLs, data retention controls, and operational monitoring. Confirm target-site terms and internal policy before deployment.

## Tests

```powershell
npm test
npm run typecheck
pytest backend/tests
```

## Current limitations

- The local service is a contract/demo implementation, not Azure AI Search, vector retrieval, or an LLM. It does not create audit events.
- Entra auth in the extension is a client flow; production authorization and token verification must be implemented at the backend before use.
- Form controls inside cross-origin frames and shadow roots are not scanned.
- Review and fill each field individually; no automatic fill or form submission exists.


    # 1. Activate the virtual environment                                                                                         
    Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned                                                              
    .\.venv\Scripts\Activate.ps1                                                                                                  
                                                                                                                                  
    # 2. (Optional, if not installed yet) Install backend dependencies                                                            
    pip install -r backend\requirements.txt                                                                                       
                                                                                                                                  
    # 3. Start the FastAPI server                                                                                                 
    uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000 