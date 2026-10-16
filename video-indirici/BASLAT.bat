@echo off
chcp 65001 >nul
title Video İndirici
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Node.js bulunamadı. https://nodejs.org adresinden kurup tekrar dene.
  echo.
  pause
  exit /b 1
)

rem Tarayıcıyı sunucu hazır olunca server.js açar (--ac); çökünce yeniden başlayışta tekrar açılmaz.
set "AC=--ac"
if defined INDIRICI_PORT (set "PORT=%INDIRICI_PORT%") else (set "PORT=4190")

rem Çökme sınırı: 30 sn dolmadan kapanan sunucu "hızlı çökme" sayılır; üst üste 5 hızlı çökmede
rem (port Windows'a ayrılmışsa, bozuk dosya vb. her açılışta aynı hata) döngü durur, sonsuza dek yeniden denemez.
set "HIZLI=0"

:dongu
call :saniye BASLA
node server.js %AC%
set "KOD=%errorlevel%"
if "%KOD%"=="0" goto bitis
if "%KOD%"=="98" goto dolu
call :saniye BITIS
set /a SURE=BITIS-BASLA
if %SURE% lss 0 set /a SURE+=86400
if %SURE% lss 30 (set /a HIZLI+=1) else (set "HIZLI=0")
if %HIZLI% geq 5 goto cokme
set "AC="
echo.
echo   İndirici beklenmedik kapandı (çıkış kodu %KOD%), 3 sn sonra yeniden başlıyor...
rem (timeout.exe girdi yönlendirilince çalışmaz; ping her ortamda 3 sn bekletir)
ping -n 4 127.0.0.1 >nul
goto dongu

:dolu
echo.
echo   Port %PORT% dolu; ayrıntı yukarıda.
echo   İndirici zaten açıksa http://localhost:%PORT% adresini tarayıcıda aç; değilse portu kullanan programı kapat.
echo.
pause
exit /b 98

:cokme
echo.
echo   ✗ İndirici üst üste %HIZLI% kez açılır açılmaz kapandı (son çıkış kodu %KOD%); yeniden denemeyi bıraktım.
echo     ↳ Yukarıdaki hata satırlarına bak. Ayrıntı: uretim\_log klasöründeki indirici-*.log dosyası.
echo       Port ayrılmışsa (EACCES) başka port dene:  set INDIRICI_PORT=4195  sonra bu dosyayı yeniden aç.
echo.
pause
exit /b 1

:bitis
echo.
echo   İndirici durdu.
pause
exit /b 0

rem Saat sayacı: ilk argümanın adını taşıyan değişkene günün kaçıncı saniyesi olduğunu (0-86399) yazar.
rem Başına 1 koyup 100 çıkarmak, 08 ve 09 değerlerinin sekizli sayı sanılmasını önler.
:saniye
set "ZAMAN_=%time: =0%"
set /a "%~1=(1%ZAMAN_:~0,2%-100)*3600+(1%ZAMAN_:~3,2%-100)*60+(1%ZAMAN_:~6,2%-100)"
exit /b 0
