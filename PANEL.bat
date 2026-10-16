@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Otopilot
setlocal enabledelayedexpansion

echo.
echo   ============================================
echo    OTOPILOT
echo   ============================================
echo.

REM ===========================================================
REM  Bu dosya eksik olan her seyi kurar (Node.js, ffmpeg, paketler)
REM  ama SISTEM YAZILIMI KURMADAN ONCE SORAR.
REM  Dosya bilerek ASCII: Turkce karakterli satirlar eski
REM  Windows surumlerinde goto/etiketleri bozabiliyor.
REM ===========================================================

if "%PANEL_PORT%"=="" set PANEL_PORT=4173

REM --- winget var mi (Windows 10 1809+ ve Windows 11'de hazir gelir) ---
set OTOKUR=1
where winget >nul 2>nul
if errorlevel 1 set OTOKUR=0

REM --- 1) NODE.JS (en az 22) ---
where node >nul 2>nul
if errorlevel 1 goto nodeyok
node -e "process.exit(+process.versions.node.split('.')[0]>=22?0:1)" >nul 2>nul
if errorlevel 1 goto nodeeski
goto nodetamam

:nodeyok
echo   Node.js bulunamadi.
goto nodekur

:nodeeski
echo   Kurulu Node.js surumu eski; en az 22 gerekiyor.

:nodekur
if "!OTOKUR!"=="0" goto nodeelle
echo.
echo   Node.js ^(LTS^) bilgisayarina KURULACAK ^(winget ile, birkac dakika surer^).
choice /c EH /m "  Devam edilsin mi? (E = evet, H = hayir)"
if errorlevel 2 goto iptal
echo.
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
echo.
REM winget kurdu ama bu pencerenin PATH'i eski. Bilinen yeri ekliyoruz.
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;!PATH!"
if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "PATH=%ProgramFiles(x86)%\nodejs;!PATH!"
where node >nul 2>nul
if errorlevel 1 goto nodegormuyor
node -e "process.exit(+process.versions.node.split('.')[0]>=22?0:1)" >nul 2>nul
if errorlevel 1 goto nodegormuyor
echo   Node.js hazir.
echo.
goto nodetamam

:nodegormuyor
echo   [UYARI] Node.js kuruldu ama bu pencere goremiyor ya da surum hala eski.
echo       Bu pencereyi KAPAT, dosyaya tekrar cift tikla. Hepsi bu.
echo.
pause
exit /b 0

:nodeelle
echo   [X] Otomatik kurulum yapilamiyor ^(winget yok^).
echo       Elle kur:  https://nodejs.org   ^(LTS, en az 22^)
echo.
pause
exit /b 1

:nodetamam

REM --- 2) FFMPEG ---
REM ff-yol.js yaygin kurulum yerlerine bakar; bulursa 0 ile cikar.
node ff-yol.js >nul 2>nul
if errorlevel 1 goto ffyok
goto fftamam

:ffyok
echo   ffmpeg bulunamadi.
if "!OTOKUR!"=="0" goto ffelle
echo.
echo   ffmpeg bilgisayarina KURULACAK ^(winget ile, birkac dakika surer^).
choice /c EH /m "  Devam edilsin mi? (E = evet, H = hayir)"
if errorlevel 2 goto iptal
echo.
winget install -e --id Gyan.FFmpeg --accept-source-agreements --accept-package-agreements
echo.
node ff-yol.js >nul 2>nul
if errorlevel 1 goto ffgormuyor
echo   ffmpeg hazir.
echo.
goto fftamam

:ffgormuyor
echo   [UYARI] ffmpeg kuruldu ama henuz gorunmuyor.
echo       Bu pencereyi KAPAT, dosyaya tekrar cift tikla.
echo.
pause
exit /b 0

:ffelle
echo   [X] Otomatik kurulum yapilamiyor ^(winget yok^).
echo       Elle kur:  https://www.gyan.dev/ffmpeg/builds/
echo.
pause
exit /b 1

:fftamam

REM --- 3) BAGIMLILIKLAR ---
REM Tum paketlere bakilir (eskiden yalniz msedge-tts'ye bakiliyordu).
REM package-lock.json varsa "npm ci": herkes ayni surumleri kurar.
REM --ignore-scripts: bagimliliklarin kurulum betikleri calistirilmaz (msedge-tts'in "npx only-allow pnpm" onkurulumu internetten paket indirir).
node -e "require.resolve('@anthropic-ai/sdk');require.resolve('msedge-tts')" >nul 2>nul
if not errorlevel 1 goto paketlertamam
echo   Gerekli paketler kuruluyor...
echo.
if exist "package-lock.json" (
  call npm ci --no-fund --ignore-scripts
) else (
  call npm install --no-fund --ignore-scripts
)
if errorlevel 1 goto paketyok
echo   Kurulum tamam.
echo.
goto paketlertamam

:paketyok
echo.
echo   [X] Paket kurulumu basarisiz. Internet baglantini kontrol et.
echo.
pause
exit /b 1

:paketlertamam

REM --- 4) AYAR DOSYASI ---
REM .env yoksa ornekten olustur. Anahtarlar zorunlu degil; panelin
REM "Kaynaklar" sekmesinden de girilebiliyor.
if not exist ".env" (
  if exist ".env.ornek" copy /y ".env.ornek" ".env" >nul
)

REM --- 5) BASLAT ---
REM Panel bu pencerede calisir. Beklenmedik kapanirsa 3 sn sonra kendini
REM yeniden baslatir; normal kapanista (kod 0) ya da port doluysa (kod 98) biter.
REM Tarayici, sunucu gercekten cevap verince BIR KEZ acilir.
REM Sonsuz dongu YOK: panel acilir acilmaz (60 sn icinde) ARKA ARKAYA 5 kez cokerse (EACCES, bozuk dosya, eksik modul...)
REM yeniden denemeyi birakir ve nedenini soyler. 60 sn'den uzun yasayan bir calisma sayaci sifirlar.
set ACILDI=0
set COKME=0
set BAS=0
set SON=0

:dongu
if "!ACILDI!"=="0" (
  set ACILDI=1
  start "" /b node lib\panel-tarayici-ac.js %PANEL_PORT%
)
echo   Panel baslatiliyor...  ^(http://localhost:%PANEL_PORT%^)
echo.
for /f %%t in ('node -p "Date.now()/1000|0"') do set BAS=%%t
node panel.js
set KOD=!errorlevel!
for /f %%t in ('node -p "Date.now()/1000|0"') do set SON=%%t
if "!KOD!"=="0" goto cikis
if "!KOD!"=="98" goto portdolu
set /a SURE=SON-BAS
if !SURE! LSS 60 ( set /a COKME+=1 ) else ( set COKME=1 )
if !COKME! GEQ 5 goto cokuyor
echo.
echo   [UYARI] Panel beklenmedik kapandi ^(kod !KOD!^). 3 sn sonra yeniden basliyor...
echo       ^(Ayrinti: uretim\_log\panel-*.log^)
timeout /t 3 /nobreak >nul
goto dongu

:cokuyor
echo.
echo   [X] Panel art arda !COKME! kez ilk dakikasinda coktu ^(son cikis kodu !KOD!^); yeniden denemeyi biraktim.
echo       Nedeni: uretim\_log\panel-*.log dosyasinin son satirlarina bak.
echo       Yaygin nedenler: baska bir program klasore kilitli, bozuk dosya, eksik paket ^(npm ci calistir^).
echo.
pause
exit /b 1

:portdolu
echo.
echo   Panel zaten acik gorunuyor: http://localhost:%PANEL_PORT%
echo   Tarayicida o adresi ac. Bu pencere kapanacak.
timeout /t 6 >nul
exit /b 0

:iptal
echo.
echo   Kurulum iptal edildi. Panel Node.js ve ffmpeg olmadan calismaz.
echo.
pause
exit /b 1

:cikis
echo.
echo   Panel kapatildi.
exit /b 0
