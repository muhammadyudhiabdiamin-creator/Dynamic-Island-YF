# Dynamic Island PC

Widget *notch* melayang di tepi atas layar untuk Windows yang dibangun dengan Electron. Tetap ringkas saat *idle* dan melebar mulus untuk kontrol Spotify, lirik tersinkronisasi, timer Pomodoro, file drop shelf, riwayat clipboard, monitor sistem, hingga *Live Activity*.

<!-- Tambahkan GIF demo atau screenshot di bawah ini -->
<!-- ![Demo Dynamic Island PC](demo.gif) -->

## Fitur Utama

- **Desain Notch Menyatu**: Menempel rapat di tepi atas layar dengan gaya *dark frosted glass*, warna aksen adaptif yang mengikuti cover album, serta slot GIF/avatar kustom saat *idle*.
- **Spotify & Lirik Real-Time**: Kontrol pemutaran (Play/Pause, Next, Previous, Seek), piringan vinyl berputar dengan cover album, lirik tersinkronisasi via LRCLIB (otomatis beralih ke visualizer audio jika lirik tidak tersedia), dan tampilan lirik langsung di mode *compact*.
- **HUD Kustom**: *Scroll* di atas notch untuk mengatur volume Spotify, atau tahan `Shift + Scroll` untuk mengatur kecerahan layar.
- **Alat Produktivitas**:
  - **Timer Pomodoro**: Preset cepat 25m, 15m, dan 5m lengkap dengan hitung mundur di mode *compact* dan bel notifikasi saat selesai.
  - **Quick Notes & Agenda**: Daftar tugas (*to-do*) lokal dan hitung mundur jadwal harian.
  - **File Drop Shelf**: Seret file ke atas notch untuk menitipkannya sementara, lalu seret keluar ke aplikasi lain kapan saja.
  - **Riwayat Clipboard**: Menyimpan 5 teks terakhir yang di-copy agar bisa disalin ulang dalam sekali klik.
  - **Download Watcher**: Notifikasi otomatis setiap kali file baru selesai diunduh, lengkap dengan tombol cepat **Open** dan **Folder**.
- **Hardware & Info Langsung**:
  - **System Stats**: Pantau penggunaan CPU, RAM, dan kecepatan internet (Download/Upload) secara *real-time*.
  - **Webcam Mirror**: Cermin kamera instan dengan tombol *flip* (hanya pratinjau tanpa merekam, otomatis mati saat ditutup).
  - **Cuaca & Baterai**: Suhu terkini via Open-Meteo (tanpa API key) serta indikator baterai dan notifikasi saat charger dicolok/dicabut.
  - **Live Activity API**: Endpoint HTTP lokal (`http://127.0.0.1:8889/activity`) agar skrip, proses build, atau AI agent bisa mengirim progress bar langsung ke notch.
- **System Tray & Shortcut Global**: Berjalan diam-diam tanpa jendela terminal lewat `start-silent.vbs`, dilengkapi menu tray, dan bisa disembunyikan/dimunculkan kapan saja dengan `Ctrl + Alt + H`.

## Instalasi

### Prasyarat
- Windows 10 atau Windows 11
- [Node.js](https://nodejs.org/) (v18 atau lebih baru)

### Langkah Setup
```bash
git clone https://github.com/muhammadyudhiabdiamin-creator/Dynamic-Island-YF.git
cd Dynamic-Island-YF
npm install
```

### Cara Menjalankan
- **Mode senyap (tanpa jendela CMD):** Klik dua kali `start-silent.vbs`
- **Mode standar:** Jalankan `npm start` atau klik dua kali `start.bat`

## Menghubungkan Spotify

1. Buka [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) lalu klik **Create app**.
2. Tambahkan **Redirect URI** berikut:
```text
http://127.0.0.1:8888/callback
```
3. Centang **Web API** lalu klik **Save**.
4. Masuk ke **Settings** aplikasi, lalu salin **Client ID** dan **Client Secret**.
5. Klik notch untuk memperluasnya, tempel kedua kredensial di formulir **Connect Spotify**, lalu klik **Save & Connect**.

> Catatan: Kredensial dan token disimpan secara lokal di `spotify-config.json` dan `spotify-tokens.json` (otomatis diabaikan Git melalui `.gitignore`).

## Shortcut & Kontrol

| Aksi | Kontrol |
| :--- | :--- |
| Buka / Tutup notch | Klik notch |
| Tutup dari keyboard | `Esc` |
| Sembunyikan / Munculkan notch | `Ctrl + Alt + H` |
| Atur volume Spotify | `Scroll` di atas notch |
| Atur kecerahan layar | `Shift + Scroll` di atas notch |
| Geser posisi notch | Seret bagian tepi atas (reset lewat menu Tray) |

## Live Activity API

Kirim progres tugas secara langsung dari skrip, terminal, atau alur kerja AI ke `http://127.0.0.1:8889/activity`:

**Contoh PowerShell:**
```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8889/activity" -Method Post -ContentType "application/json" -Body '{"title":"Rendering video","progress":65,"status":"running"}'
```

**Contoh curl:**
```bash
curl -X POST http://127.0.0.1:8889/activity \
  -H "Content-Type: application/json" \
  -d '{"title":"Build selesai","progress":100,"status":"done"}'
```

## Lisensi

Lisensi MIT. Lihat file [LICENSE](LICENSE) untuk detail selengkapnya.


