# Video İndirici

Localhost'ta çalışan, reklamsız video indirme + viral keşif paneli.
Link yapıştır → indir. YouTube, TikTok, X (Twitter), Instagram, Facebook, Reddit.

> **Yalnızca kendi içeriğini ya da indirme ve yeniden kullanım izni olan içeriği indir.**
> Başkasının videosunu izinsiz yeniden yüklemek telif ihlalidir; kanalın kapatılabilir.
> Keşfet sekmesindeki liste başkalarının videolarını gösterir: indirmeden önce izni kontrol et.

## Hangi kopya?

**Kanonik kopya bu klasördür** (`otopilot/video-indirici/`). Otopilot panelinin
indirici düğmesi bunu başlatır; hata düzeltmeleri ve güvenlik yamaları yalnızca burada yapılır.
Bu depo dışında duran eski bir `video-indirici` klasörü (kendi `ayarlar.json` ve
`indirilenler/` klasörleriyle) **eski ve güncellenmeyen** bir nüshadır; kullanma.
Orada indirdiğin dosyalar varsa `indirilenler/` içindekileri buraya taşıyıp eski klasörü silebilirsin.

Eski kopya **güvenlik denetimlerinin hiçbirini içermez** (host/Origin/jeton, klasör kısıtı, satır içi `onclick` temizliği)
ve bununla **aynı portu (4190) kullanır**. Bu yüzden eski klasörü hiç açma; dosyalarını taşıdıktan sonra silmek en güvenlisi.
Yanlışlıkla eski kopya açıksa iki yerde tanınır ve kullanılmaz:

- Bu klasörün `BASLAT.bat` dosyasını açarsan indirici portta eski kopyayı tanıyıp
  "ESKİ, güvenlik denetimi olmayan bir indirici çalışıyor" uyarısını verir ve kendisi açılmaz.
- Otomasyon panelindeki "Video indirici" düğmesi portun yalnızca açık olmasına değil **kimin dinlediğine** bakar
  (jetonsuz `/api/durum`: bu kopya 403 verir, eski kopya 200 ile liste döner). Eski kopya bulunursa panel onu açmaz,
  "ESKİ ... indirici çalışıyor" hatasını gösterir; port başka bir programdaysa o da ayrı bir hatayla bildirilir.

## Kurulum

Gerekenler (hepsi ücretsiz):

| Araç    | Kurulum |
|---------|---------|
| Node.js (22 ve üstü) | https://nodejs.org |
| yt-dlp  | `pip install -U --pre yt-dlp` (**--pre önemli**: TikTok, nightly sürüm ister) |
| ffmpeg  | `winget install ffmpeg` (1080p birleştirme + MP3 için) |

npm install **gerekmez** — sıfır bağımlılık.
yt-dlp kurulu değilse sayfadaki "yt-dlp yok — kurmak için tıkla" rozeti `pip install -U --pre yt-dlp` komutunu çalıştırır
(Python kurulu olmalı).

## Çalıştırma

`BASLAT.bat` çift tık → sunucu hazır olunca tarayıcıda `http://localhost:4190` açılır.
Beklenmedik bir çökmede pencere 3 sn sonra sunucuyu kendiliğinden yeniden başlatır.
Sunucu 30 sn dolmadan üst üste 5 kez kapanırsa (ör. port Windows'a ayrılmışsa: `listen EACCES`) yeniden denemeyi bırakır,
hata özetini ve çözümü gösterip bekler; başka bir port için `set INDIRICI_PORT=4195` yazıp dosyayı yeniden aç.
Port doluysa (indirici zaten açıktır) Türkçe uyarı verip durur.

Otomasyon paneli bu aracı kendiliğinden **başlatmaz**; panelden indirici düğmesine basınca ya da
`BASLAT.bat` ile elle açarsın.

Mac/Linux'ta: `node server.js --ac` (deneysel; dosya açma/klasörde gösterme `open` / `xdg-open` ile yapılır).

## Özellikler

**İndir sekmesi**
- Tek veya çoklu link (alt alta yapıştır), kuyruk 2'şerli indirir. Kuyrukta en çok 500 bitmemiş iş durur;
  oynatma listeleri açıldıktan sonraki iş sayısı da sayılır, sığmazsa **hiçbiri eklenmez** (409 `kuyruk_dolu`)
- Kalite: En iyi / 4K / 1440p / 1080p / 720p / 480p / MP3 (ses çıkarma)
  — "En iyi" ve 4K/1440p çözünürlük öncelikli; 1080p ve altı H.264 öncelikli (her cihazda açılır)
- Canlı ilerleme (%, hız, kalan süre), kapak görseli, anlaşılır Türkçe hata mesajları
  (internet yok, özel video, yaş sınırı, disk dolu, yt-dlp eski...)
- Oynatma listesi desteği · Chrome çerezleriyle gizli/yaş sınırlı içerik
- İndirme 15 dakika hiç ilerlemezse otomatik durdurulur; boş disk 1 GB'ın altındaysa başlamaz
- Bitince: Oynat / Klasörde göster / Sil

**Keşfet sekmesi**
- Viral akış: haftanın patlayan videoları (YouTube Shorts + TikTok + Instagram Reels,
  izlenme ve "patlama" katsayılarıyla) — platform ve izlenme barajı (1M/5M/10M/30M+)
  filtreleri, karttan tek tıkla indirme
- **"vidIQ'dan tazele"**: `.env`'deki `VIDIQ_KEY` ile (panel > Anahtarlar) listeyi canlı günceller —
  50 YT Shorts + 25 TikTok + 25 Reels, **~10 vidIQ kredisi harcar**. Her seferinde onay penceresi çıkar
  (API'de `onay: true` şarttır); aynı anda ikinci yenileme engellenir.
  Anahtar yoksa liste boş kalır (depoda hazır liste YOKTUR: vidIQ verisi paylaşılamaz); indirme ve canlı arama yine çalışır.
- Canlı arama: YouTube'da dönem (bugün/hafta/ay) + süre (Shorts/uzun) filtreli, izlenmeye göre sıralı arama — yt-dlp ile, ücretsiz ve sınırsız
- "Görünenlerin ilk 10'unu indir" düğmesi indirmeden önce telif uyarısıyla onay ister

## Güvenlik

Araç yalnızca senin bilgisayarında çalışır ve internetteki başka sitelerin onu kullanmasına karşı korunur:

- Yalnızca `127.0.0.1` dinler (ağdaki başka cihazlar erişemez).
- **Host denetimi** (DNS rebinding): yalnızca `localhost:PORT`, `127.0.0.1:PORT`, `[::1]:PORT` kabul edilir (403 `host`).
- **Origin + içerik türü** (CSRF): POST'lar `Content-Type: application/json` ister (415), `Origin` varsa kendi adresimiz olmalı (403 `origin`).
- **Jeton:** her başlatmada rastgele jeton üretilir; tüm `/api` çağrıları `X-Panel-Token` başlığı ister (403 `token`).
  Sayfa jetonu `<meta name="panel-token">` ve `HttpOnly; SameSite=Strict` çerezi (`indirici_oturum`) ile alır.
  Başlık gönderemeyen canlı akış ve medya GET'leri çerezle de çalışır; değiştiren (POST) çağrılar çerezle çalışmaz.
  İndirici yeniden başlayınca sayfada "Oturum süresi doldu, sayfayı yenile" uyarısı çıkar.
- **İndirme klasörü** yalnızca `indirilenler/`, `~/Videos`, `~/Downloads`, `~/Movies` altına çevrilebilir
  (`..`, UNC, junction/symlink kaçışları reddedilir; `ayarlar.json` içindeki değer de açılışta aynı denetimden geçer).
- **Sil / oynat / klasörde göster / dosya sunma** yalnızca klasördeki, uzantısı video/ses olan düz dosya adlarına çalışır
  (yol parçası, `.env`, `.js`, `.exe`, symlink reddedilir). Kabul edilen uzantılar: `.mp4 .mkv .webm .mov .avi .m4v .flv .3gp .ts .ogv`
  (video) ve `.mp3 .m4a .opus .wav .ogg .aac .flac` (ses); yt-dlp birleştirme gerektirmeyen tek dosyalı formatlarda mp4 dışında da
  uzantı yazabildiği için hepsi listede. `.ts` ayrıca içerikten doğrulanır (MPEG-TS paket başı 0x47): aynı uzantılı bir TypeScript
  kaynağı (Downloads klasöründe olabilir) listelenmez, silinemez. Dosyalar `cmd.exe` üzerinden değil doğrudan
  `explorer.exe` / `open` / `xdg-open` ile açılır.
- **İptal** bayraklıdır: İptal'e basılan indirmenin süreci ölürken (Windows'ta `taskkill` asenkron) son basılan ilerleme ya da
  birleştirme satırları durumu "iptal"in üstüne yazamaz; kart "hata" ile bitmez. Süreç başlatılamazsa iş yalnızca bir kez biter
  (aynı anda 2 indirme sınırı aşılmaz).
- Linkler denetlenir: yalnızca `http(s)`, boşluk/kimlik bilgisi yok; `localhost`, `localhost.` (sondaki nokta), tek etiketli adlar (`http://router/`),
  `.local`/`.internal`/`.lan` adları, özel/ayrılmış IPv4 aralıkları (10/8, 100.64/10, 169.254/16, 172.16/12, 192.168/16 ...) ve **IPv6'nın IPv4'ü taşıyan biçimleri**
  (`[::ffff:127.0.0.1]`, `[::7f00:1]`, NAT64, 6to4) reddedilir. Alan adı yerel bir adrese çözülüyorsa (`localtest.me`, `127.0.0.1.nip.io`) o da reddedilir
  (DNS sorgusu; çözülemezse engellenmez). Sınır: ad sonradan başka adrese çözülürse (DNS rebinding) yakalanmaz — yt-dlp kendi çözümlemesini yapar.
  **VPN uyumu:** Clash / sing-box TUN gibi "fake-ip" kipindeki VPN'ler her alan adını `198.18.0.0/15`'e çözer; DNS cevabındaki bu blok
  yerel sayılmaz (yoksa her link reddedilirdi). `http://198.18.0.1/` gibi **doğrudan IP** girişi yine reddedilir. Pi-hole'un `0.0.0.0` cevabı bilinçli olarak engellenir
  (reklam/izleyici adı engellendiği için indirme zaten çalışmaz).
  yt-dlp'ye `--` ile verilir. İstek gövdesi en çok 1 MB; alanlar düz değer olmalı (nesne/liste 400 `govde_tipi`).
- Arayüz kodu `innerHTML`/satır içi olay kullanmaz; başlık ya da dosya adı ne içerirse içersin sayfaya kod giremez.
  Sayfa `script-src 'self'` CSP'si ve `X-Frame-Options`, `nosniff`, `no-referrer` başlıklarıyla gelir.
- Çocuk süreçlere (yt-dlp) API anahtarı içeren ortam değişkenleri (`*KEY*`, `*TOKEN*`...) geçirilmez.
- İşleyici hataları sunucuyu düşürmez: istemciye genel Türkçe mesaj gider, ayrıntı günlüğe (`uretim/_log/indirici-<tarih>.log`) yazılır.

## Ortam değişkenleri (hepsi isteğe bağlı)

| Değişken | Anlamı |
|----------|--------|
| `INDIRICI_PORT` | Port (varsayılan 4190) |
| `INDIRICI_KLASOR` | Varsayılan indirme klasörü (güvenilir kök sayılır) |
| `INDIRICI_AYAR_DOSYASI` / `INDIRICI_KESFET_DOSYASI` | `ayarlar.json` / `kesfet-veri.json` yolu |
| `YTDLP_YOL` | yt-dlp yerine kullanılacak komut ya da `.js/.cjs` betiği (test için) |
| `OTOMASYON_ENV_DOSYASI` | `VIDIQ_KEY`'in okunacağı `.env` dosyası. Varsayılan: projenin kökündeki `.env` (yani bu klasörün bir üstündeki `../.env`; `video-indirici/.env` aranmaz). Anahtar dosyada yoksa aynı adlı süreç ortam değişkeni denenir |
| `OTOMASYON_URETIM` | Günlük klasörünün tabanı (varsayılan `../uretim`) |

## Testler

```
npm test
```

Sahte yt-dlp ve sahte vidIQ kullanır; gerçek bir siteye, anahtara ya da `ayarlar.json` / `indirilenler/` klasörüne dokunmaz.

## Notlar

- İndirilenler `indirilenler/` klasörüne düşer (depoya girmez).
- Viral akış verisi bir JSON'dur (`kesfet-veri.json`; depoda yoktur, `.gitignore`'dadır, «vidIQ'dan tazele» ile oluşur); `arac/kesfet-derle.cjs` ile vidIQ
  çıktılarından yeniden derlenebilir (dosyanın başındaki kullanım notuna bak; argümansız çalışırsa mevcut listeyi ezmez).
- TikTok indirme bozulursa ilk çare: `pip install -U --pre yt-dlp`.
- vidIQ istemcisi ve `.env` okuyucusu projenin ortak kütüphaneleridir (`../lib/vidiq.js`, `../lib/ortak.js`: tek kopya).
  İndirici otomasyon klasörünün dışına tek başına kopyalanırsa yalnızca "vidIQ'dan tazele" çalışmaz
  (Türkçe hata verir); indirme ve arama aynen çalışır.
