#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "[HATA] Node.js bulunamadi. https://nodejs.org adresinden Node.js 22+ kurun."
  exit 1
fi

# Port: AI_INFAPP_PORT, yoksa AIINFAPP_PORT (youtube-otomasyon paneliyle ayni ad), yoksa 4200.
# Her durumda AI_INFAPP_PORT olarak verilir: sunucu da tarayici da ayni portu kullanir (eski PORT degiskeni karismaz).
AI_INFAPP_PORT="${AI_INFAPP_PORT:-${AIINFAPP_PORT:-4200}}"
export AI_INFAPP_PORT

echo ""
echo "================================================"
echo "  AI INFAPP - AI influencer karakter otomasyonu"
echo "================================================"
echo ""
echo "  Panel: http://localhost:${AI_INFAPP_PORT}"
echo "  Kapatmak icin Ctrl+C."
echo ""

if command -v open >/dev/null 2>&1; then
  (sleep 1 && open "http://localhost:${AI_INFAPP_PORT}") &
elif command -v xdg-open >/dev/null 2>&1; then
  (sleep 1 && xdg-open "http://localhost:${AI_INFAPP_PORT}") &
fi

node server.js
