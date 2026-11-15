"""
Autonomous Browser Form-Filling Agent using browser-use.

Controls Chrome visually on the screen, navigates to any URL,
uses the user's logged-in session / Chrome profile, and fills
form inputs based on verified profile dossier data.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any, Dict, Optional

# Ensure browser-harness uses a dedicated local folder to avoid Windows permission issues
BH_DIR = Path(__file__).resolve().parent.parent.parent / ".browser_harness"
BH_DIR.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("BH_HOME", str(BH_DIR))

# Ensure Proactor loop policy on Windows for subprocess support
if sys.platform == "win32":
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    except Exception:
        pass

from dotenv import load_dotenv

# Load .env from backend directory or project root
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent.parent / ".env")
load_dotenv()

from browser_use import Agent, Browser, ChatGoogle, ChatOpenAI, ChatAnthropic

logger = logging.getLogger("agent_runner")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

KNOWLEDGE_PATH = Path(__file__).resolve().parent / "knowledge.json"


def get_available_profiles() -> list[dict[str, Any]]:
    """Return all verified profiles available in knowledge.json."""
    if not KNOWLEDGE_PATH.exists():
        return []
    try:
        with open(KNOWLEDGE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            return [
                {
                    "id": p.get("id"),
                    "title": p.get("title"),
                    "email": p.get("email"),
                    "sample_name": p.get("answers", {}).get("Full Name", ""),
                }
                for p in data
            ]
    except Exception as e:
        logger.error("Failed to load knowledge profiles: %s", e)
        return []


def load_profile_data(profile_id: Optional[str] = None, email: Optional[str] = None) -> tuple[dict[str, Any], str]:
    """Retrieve answers dict and content dossier for a specific profile."""
    if not KNOWLEDGE_PATH.exists():
        raise FileNotFoundError(f"Knowledge base not found at {KNOWLEDGE_PATH}")

    with open(KNOWLEDGE_PATH, "r", encoding="utf-8") as f:
        profiles = json.load(f)

    selected = None
    if profile_id:
        selected = next((p for p in profiles if p.get("id") == profile_id), None)
    elif email:
        selected = next((p for p in profiles if p.get("email") == email), None)

    if not selected and profiles:
        selected = profiles[0]

    if not selected:
        raise ValueError("No profile dossier found in knowledge base.")

    answers = selected.get("answers", {})
    content = selected.get("content", "")
    return answers, content


def get_llm(model_name: Optional[str] = None):
    """Instantiate the best available LLM based on environment variables."""
    gemini_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    openai_key = os.getenv("OPENAI_API_KEY")
    anthropic_key = os.getenv("ANTHROPIC_API_KEY")

    if gemini_key:
        model = model_name or os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
        logger.info("Using Gemini LLM: %s", model)
        return ChatGoogle(model=model, api_key=gemini_key)
    elif openai_key:
        model = model_name or "gpt-4o"
        logger.info("Using OpenAI LLM: %s", model)
        return ChatOpenAI(model=model, api_key=openai_key)
    elif anthropic_key:
        model = model_name or "claude-3-5-sonnet-20241022"
        logger.info("Using Anthropic LLM: %s", model)
        return ChatAnthropic(model=model, api_key=anthropic_key)
    else:
        raise ValueError(
            "No LLM API key detected. Please set GEMINI_API_KEY (or OPENAI_API_KEY / ANTHROPIC_API_KEY) in .env"
        )


def create_browser(
    browser_mode: str = "chromium",
    chrome_profile: Optional[str] = None,
    cdp_url: Optional[str] = None,
    keep_open: bool = True,
) -> Browser:
    """
    Configure and create the Browser instance.
    
    Modes:
      - 'chromium': Launches a dedicated local visible browser (isolated and clean).
      - 'chrome': Attaches to the user's currently open Chrome browser.
      - 'chrome_profile': Launches Chrome using a working copy of the user's real profile (e.g. 'Default').
    """
    if cdp_url:
        logger.info("Attaching to existing browser via CDP: %s", cdp_url)
        return Browser(cdp_url=cdp_url, keep_alive=keep_open)

    if browser_mode == "chrome_open":
        logger.info("Attaching to active open Chrome browser...")
        return Browser("chrome", keep_alive=keep_open)

    if browser_mode == "chrome_profile":
        profile_name = chrome_profile or "Default"
        logger.info("Launching Chrome with cloned profile: %s (includes logged-in sessions)", profile_name)
        return Browser("chrome", profile=profile_name, headless=False, keep_alive=keep_open)

    # Default: fresh visible Chromium browser
    logger.info("Launching visible local Chromium browser...")
    return Browser("chromium", headless=False, keep_alive=keep_open)


async def run_form_agent(
    target_url: str,
    profile_id: Optional[str] = None,
    email: Optional[str] = None,
    browser_mode: str = "chromium",
    chrome_profile: Optional[str] = None,
    cdp_url: Optional[str] = None,
    custom_instructions: Optional[str] = None,
) -> dict[str, Any]:
    """
    Main entry point: Navigates to any target URL, inspects inputs visually,
    and fills the form fields with profile data.
    """
    answers, content = load_profile_data(profile_id=profile_id, email=email)
    llm = get_llm()
    browser = create_browser(browser_mode=browser_mode, chrome_profile=chrome_profile, cdp_url=cdp_url)

    formatted_answers = json.dumps(answers, indent=2)

    task_instructions = f"""
You are an autonomous form-filling assistant.

Your task:
1. Navigate directly to the web link: {target_url}
2. Wait for the page and form elements to load completely.
3. Review the available fields on the screen (text inputs, selects, radio buttons, checkboxes, textareas).
4. Fill each field with accuracy using the verified dossier details below:

--- VERIFIED PROFILE KEY-VALUE ANSWERS ---
{formatted_answers}

--- FULL BACKGROUND DOSSIER (Use for any fields not in the key-value list) ---
{content}

5. Important navigation rules:
   - Match dropdown options to the closest semantic option (e.g., 'India' for Nationality, 'Male' for Sex/Gender).
   - For dates, use standard formats required by the input (e.g., YYYY-MM-DD or DD/MM/YYYY).
   - If there are multi-step sections ('Next', 'Continue'), proceed through them until you reach the final review or summary.
   - MISSING INFORMATION & STRICT GROUNDING:
     * If a field asks for details NOT found in the verified dossier (e.g., unknown tax/social security IDs, previous visa references, specific questions):
     * DO NOT guess, fabricate, or hallucinate any personal data under any circumstance.
     * Leave the field blank or unselected.
     * Highlight or note which fields require user attention.
   - FINAL AUDIT REPORT:
     * In your final summary, provide a clear structured report:
       1. FILLED: All fields successfully populated with values.
       2. SKIPPED / MISSING: Every field that could not be filled due to lack of info, and the exact detail the user needs to manually provide.
   - SAFETY RULE: STOP immediately before the final 'Submit' / 'Confirm Application' button. DO NOT click the final submit button.
"""
    if custom_instructions:
        task_instructions += f"\n--- ADDITIONAL USER INSTRUCTIONS ---\n{custom_instructions}\n"

    logger.info("Starting Autonomous Agent for URL: %s", target_url)

    agent = Agent(
        task=task_instructions,
        llm=llm,
        browser=browser,
        highlight_actions=True,  # Shows mouse cursor / visual action indicators
    )

    history = await agent.run()
    logger.info("Agent task completed.")
    final_summary = history.final_result() if hasattr(history, "final_result") else "Form filling completed."
    return {
        "status": "success",
        "target_url": target_url,
        "summary": final_summary,
        "steps_taken": len(history.history) if hasattr(history, "history") else 0,
    }


def run_form_agent_sync(
    target_url: str,
    profile_id: Optional[str] = None,
    email: Optional[str] = None,
    browser_mode: str = "chromium",
    chrome_profile: Optional[str] = None,
    cdp_url: Optional[str] = None,
    custom_instructions: Optional[str] = None,
) -> dict[str, Any]:
    """
    Executes run_form_agent inside an isolated worker thread with a ProactorEventLoop.
    This completely solves the Windows SelectorEventLoop conflict when called from Uvicorn.
    """
    import concurrent.futures

    def thread_worker():
        if sys.platform == "win32":
            loop = asyncio.ProactorEventLoop()
            asyncio.set_event_loop(loop)
        else:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)

        try:
            return loop.run_until_complete(
                run_form_agent(
                    target_url=target_url,
                    profile_id=profile_id,
                    email=email,
                    browser_mode=browser_mode,
                    chrome_profile=chrome_profile,
                    cdp_url=cdp_url,
                    custom_instructions=custom_instructions,
                )
            )
        finally:
            loop.close()

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(thread_worker).result()


def main():
    parser = argparse.ArgumentParser(description="Autonomous Browser Form-Filling Agent")
    parser.add_argument("--url", default="http://127.0.0.1:8000/test-form", help="Any web link or form URL")
    parser.add_argument("--profile", default=None, help="Profile ID from knowledge.json")
    parser.add_argument("--email", default=None, help="User email from knowledge.json")
    parser.add_argument(
        "--mode",
        choices=["chromium", "chrome_open", "chrome_profile"],
        default="chromium",
        help="Browser mode: 'chromium' (fresh), 'chrome_open' (current open Chrome), 'chrome_profile' (logged-in profile)",
    )
    parser.add_argument("--cdp", default=None, help="CDP URL e.g. http://localhost:9222")
    parser.add_argument("--instructions", default=None, help="Additional custom instructions")

    args = parser.parse_args()

    try:
        result = asyncio.run(
            run_form_agent(
                target_url=args.url,
                profile_id=args.profile,
                email=args.email,
                browser_mode=args.mode,
                cdp_url=args.cdp,
                custom_instructions=args.instructions,
            )
        )
        print(json.dumps(result, indent=2))
    except Exception as e:
        logger.exception("Error executing form agent: %s", e)
        sys.exit(1)


if __name__ == "__main__":
    main()
