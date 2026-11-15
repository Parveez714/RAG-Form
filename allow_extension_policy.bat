@echo off
:: Batch helper that self-elevates to Administrator and applies policy
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting Administrator privileges...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0allow_extension_policy.ps1"
echo.
pause
