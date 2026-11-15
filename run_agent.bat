@echo off
setlocal

cd /d "%~dp0backend"

:: Activate virtual environment
if exist ".venv\Scripts\activate.bat" (
    call .venv\Scripts\activate.bat
) else (
    echo [ERROR] Virtual environment not found in %~dp0backend\.venv
    pause
    exit /b 1
)

:: If arguments are provided, run CLI agent directly
if not "%~1"=="" (
    python app\agent_runner.py %*
    pause
    exit /b %errorlevel%
)

:: Otherwise, start the backend server and open the Agent Control Center UI
echo ====================================================================
echo  Starting Autonomous AI Form Filler Server
echo  Control Center: http://127.0.0.1:8000/agent
echo  Sample Test Form: http://127.0.0.1:8000/test-form
echo ====================================================================
echo.

:: Open the browser UI
start "" "http://127.0.0.1:8000/agent"

:: Start Uvicorn
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
