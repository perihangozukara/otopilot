@echo off
chcp 65001 >nul
title Ai Infapp
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [HATA] Node.js bulunamadi.
  echo  https://nodejs.org adresinden Node.js 22 veya ustunu kurun, sonra bu dosyayi tekrar calistirin.
  echo.
  pause
  exit /b 1
)

rem Port: AI_INFAPP_PORT, yoksa AIINFAPP_PORT (otopilot paneliyle ayni ad), yoksa 4200.
rem Her durumda AI_INFAPP_PORT olarak verilir: sunucu da tarayici da ayni portu kullanir (eski PORT degiskeni karismaz).
if not defined AI_INFAPP_PORT set "AI_INFAPP_PORT=%AIINFAPP_PORT%"
if not defined AI_INFAPP_PORT set "AI_INFAPP_PORT=4200"

echo.
echo  ================================================
echo   AI INFAPP - AI influencer karakter otomasyonu
echo  ================================================
echo.
echo  Panel aciliyor: http://localhost:%AI_INFAPP_PORT%
echo  Kapatmak icin bu pencerede Ctrl+C yapin.
echo.

start "" http://localhost:%AI_INFAPP_PORT%
node server.js
pause
