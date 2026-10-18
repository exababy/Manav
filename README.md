# YNS TARIM – Manav Satış & Fiş Uygulaması

Her gün işletmelere (lokanta, market, otel…) sebze/meyve satan manav için web tabanlı,
**iOS ve Android'de uygulama gibi çalışan (PWA)** satış, müşteri, tahsilat ve fiş programı.

## Özellikler

- **Şifre ile giriş** – telefon kilit ekranı gibi rakam tuş takımı (varsayılan şifre: `1234`)
- **Müşteri seçimi** – en üstte müşteri adıyla arama/seçim, bakiye anında görünür
- **Satış** – ürünler resimli kare kutular halinde; ürüne dokununca
  **KG / KASA / ADET** seçimi, miktar ve **o müşteriye en son satılan fiyat otomatik** gelir
  (yoksa son satış fiyatı, o da yoksa ürün kartındaki fiyat). Fiyat değiştirilebilir.
  Kaydet → sonraki ürün → en sonda **Satışı Kaydet** ile tutar müşteri bakiyesine eklenir.
- **Ödeme** – satış anında Veresiye / Nakit / Havale (kısmi ödeme desteklenir),
  ayrıca **Tahsilat** ekranı: Nakit / Havale-EFT
- **Fiş** – örnek fiş tasarımında (firma, BelgeNo/Tarih/Saat kutusu, kalemler, Tutar,
  İskonto, Gen. Toplam, "Yalnız … TL … Krş", "Mali Değeri Yoktur", önceki/yeni bakiye)
  - 📄 **PDF** (58 / 80 mm termal görünüm, Türkçe karakterli)
  - 🧾 **ESC POS** – Android'de **RawBT** uygulamasına doğrudan gönderim
  - 🖨️ **Yazdır** – sistem yazdırma (Android "ESC POS Print Service", iPhone AirPrint)
  - 🔵 **Bluetooth** – Android Chrome'dan BLE termal yazıcıya doğrudan ESC/POS
  - 📤 **Paylaş** – PDF'i WhatsApp / yazıcı uygulamasına gönderme
- **İade alma** – satış ekranında "↩️ İade Al" modu veya ürün penceresinde "İade" seçimi.
  İade satırları müşterinin borcundan düşülür; aynı fişte hem satış hem iade olabilir.
  Tamamı iade olan fişler "İADE FİŞİ" başlığıyla basılır; nakit/havale ile para iadesi de kaydedilebilir.
- **Fiş düzenleme** – kayıtlı satış/iade fişinde "✏️ Düzenle": ürün ekle/çıkar, miktar, fiyat,
  iskonto, ödeme şekli ve not değiştirilebilir. Belge no ve tarih korunur, bakiye otomatik düzelir.
  Tahsilat makbuzlarında tutar/ödeme şekli düzenlenebilir. (Yönetici yetkisi gerekir)
- **Ürünler** – resim (kamera/galeri), emoji, kategori, KG/KASA/ADET fiyatları, KDV
- **Toplu ürün ekleme** – 70+ hazır sebze/meyve listesinden "Tümünü Seç → Ekle"
  veya `Ad; Birim; Fiyat` formatında liste yapıştırma
- **Müşteri ekstre**, **günlük fişler** (tekrar yazdırma, iptal), **raporlar**
  (ürün/müşteri bazında satış, nakit/havale tahsilat, toplam alacak)
- **Kullanıcılar** – Yönetici / Personel (personel iptal ve ayar değiştiremez)
- **Veritabanı** – varsayılan **SQLite**, `.env` ile **MySQL**'e geçilebilir

## Kurulum

Gereksinim: Node.js 18+

```bash
npm install
cp .env.example .env   # isteğe bağlı
npm start              # http://localhost:3000
```

İlk açılışta şifre **1234**'tür; *Ayarlar → Şifremi Değiştir* bölümünden değiştirin.
Firma adı (YNS TARIM), şube, telefon ve fiş ayarları *Ayarlar* ekranındadır.

### MySQL kullanmak

`.env` dosyasında:

```
DB_CLIENT=mysql
MYSQL_HOST=127.0.0.1
MYSQL_USER=root
MYSQL_PASSWORD=...
MYSQL_DATABASE=yns_tarim
```

Veritabanı ve tablolar ilk çalıştırmada otomatik oluşturulur.

## GitHub Pages demo

GitHub Pages sadece statik dosya sunduğu için Pages'te **sunucusuz demo** çalışır:
aynı arayüz, veriler tarayıcıda (localStorage) saklanır, PDF ve ESC/POS fişler
tarayıcıda üretilir. Demo şifresi **1234**. Gerçek kullanımda (ortak veri, birden fazla
telefon) uygulama Node.js sunucusunda çalıştırılmalıdır.

- Yerel derleme: `npm run build:pages` → `dist/`
- Otomatik yayın: `.github/workflows/pages.yml` (her push'ta)
- İlk sefer: GitHub → **Settings → Pages → Source: GitHub Actions**

## Telefona yükleme

Uygulamayı bir sunucuda **HTTPS** ile yayınlayın (ör. VPS + nginx, Render, Railway).

- **Android (Chrome):** menü ⋮ → *Uygulamayı yükle / Ana ekrana ekle*
- **iPhone (Safari):** Paylaş → *Ana Ekrana Ekle*

Mağaza (Play Store / App Store) uygulaması gerekirse `capacitor.config.json` hazırdır:

```bash
npm i -D @capacitor/cli @capacitor/core @capacitor/android @capacitor/ios
# capacitor.config.json içindeki server.url'yi kendi adresinizle değiştirin
npx cap add android && npx cap open android
npx cap add ios && npx cap open ios
```

## Termal yazıcı ipuçları

| Cihaz | Yöntem |
|---|---|
| Android + Bluetooth yazıcı | **RawBT** uygulamasını kurun, yazıcıyı RawBT'de seçin → fişte "ESC POS (RawBT)" |
| Android + ESC POS Print Service | Fişte "Yazdır" → yazıcıyı seçin |
| Android Chrome + BLE yazıcı | Fişte "Bluetooth" (ilk seferde cihaz seçilir) |
| iPhone | "Yazdır" (AirPrint) veya "Paylaş" ile PDF'i yazıcı uygulamasına gönderin |

Türkçe karakterler bozuk çıkarsa *Ayarlar → Yazıcı* bölümünden kod sayfasını değiştirin
(13 → 12 / 36 / 61) veya "Sadeleştir (ş→s)" seçin. Kağıt genişliği 58/80 mm seçilebilir.

## Geliştirme

```bash
npm run dev   # dosya değişince yeniden başlar
npm test      # API, bakiye ve fiş çıktısı testleri
```

```
server/            Express API
  db/              SQLite/MySQL katmanı, şema, ilk veriler
  lib/             fiş modeli, PDF, ESC/POS, tutarı yazıya çevirme
  routes/api.js    tüm uç noktalar
public/            PWA arayüz (derleme gerektirmez)
fonts/             PDF için DejaVu fontları (Türkçe karakter)
```
