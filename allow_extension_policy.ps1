# Run this script in PowerShell as Administrator

Write-Host "Configuring Chrome and Edge Extension Install Policies..." -ForegroundColor Cyan

# 1. Google Chrome Configuration
$chromeAllow = [Microsoft.Win32.Registry]::LocalMachine.CreateSubKey("SOFTWARE\Policies\Google\Chrome\ExtensionInstallAllowlist")
$chromeAllow.SetValue("1", "bgfdnejoikgcokmeckobicceagpplgca")
$chromeAllow.Close()

$chromeForce = [Microsoft.Win32.Registry]::LocalMachine.CreateSubKey("SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist")
$chromeForce.SetValue("1", "bgfdnejoikgcokmeckobicceagpplgca;https://rag-form-hids.onrender.com/static/updates.xml")
$chromeForce.Close()

$chromeSources = [Microsoft.Win32.Registry]::LocalMachine.CreateSubKey("SOFTWARE\Policies\Google\Chrome\ExtensionInstallSources")
$chromeSources.SetValue("1", "https://rag-form-hids.onrender.com/*")
$chromeSources.SetValue("2", "http://127.0.0.1:8000/*")
$chromeSources.Close()
Write-Host "[OK] Google Chrome policies configured (Allowlist, Sources, Forcelist)" -ForegroundColor Green

# 2. Microsoft Edge Configuration
$edgeAllow = [Microsoft.Win32.Registry]::LocalMachine.CreateSubKey("SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallAllowlist")
$edgeAllow.SetValue("1", "bgfdnejoikgcokmeckobicceagpplgca")
$edgeAllow.Close()

$edgeForce = [Microsoft.Win32.Registry]::LocalMachine.CreateSubKey("SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist")
$edgeForce.SetValue("1", "bgfdnejoikgcokmeckobicceagpplgca;https://rag-form-hids.onrender.com/static/updates.xml")
$edgeForce.Close()

$edgeSources = [Microsoft.Win32.Registry]::LocalMachine.CreateSubKey("SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallSources")
$edgeSources.SetValue("1", "https://rag-form-hids.onrender.com/*")
$edgeSources.SetValue("2", "http://127.0.0.1:8000/*")
$edgeSources.Close()
Write-Host "[OK] Microsoft Edge policies configured (Allowlist, Sources, Forcelist)" -ForegroundColor Green

Write-Host "`nConfiguration complete! Restart your browser to apply." -ForegroundColor Yellow
