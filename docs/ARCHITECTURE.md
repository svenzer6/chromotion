# Chromotion — Mimari

> Ücretsiz ve açık kaynak (MIT) · Burhan Celebi · drburhancelebi@icloud.com

> Proje sözleşmesi: [`BUILD_KIT.md`](BUILD_KIT.md). Tasarım sistemi: [`design-system/chromotion/MASTER.md`](../design-system/chromotion/MASTER.md).

## 1. Genel bakış

```text
┌──────────────── Chrome ────────────────┐
│  Side panel (React)   Options (React)  │   UI sayfaları chrome.tabs'a dokunmaz;
│        │  port "tc-ui" ▲  │ messages   │   komut gönderir, durum dinler.
│        ▼               │  ▼            │
│  ┌──────── Background service worker ─────────┐
│  │ Engine  ─ SerialQueue (tek yazar, sıralı)  │
│  │   ├─ PersistenceService  (journal+snapshot)│
│  │   ├─ RecoveryService     (replay, backups) │
│  │   ├─ AiGroupingService   (provider zinciri)│
│  │   └─ ChromeTabsAdapter   (tabs/tabGroups)  │
│  └────────────────────────────────────────────┘
│        │ chrome.storage.local (asıl kaynak)    │
└────────────────────────────────────────────────┘
```

- **Tek yazar:** Kalıcı durumu yalnızca service worker değiştirir. Her mutasyon ve her Chrome olayı
  `SerialQueue` üzerinden sırayla çalışır; yarış koşulu yoktur.
- **Bellek otorite değildir:** Durum her zaman `snapshot + journal` ile yeniden kurulabilir.
- **AI kuyruğu bloklamaz:** Ağ çağrıları kuyruğun dışında çalışır; sekme olayları beklemez.

## 2. Modüller

| Klasör | Sorumluluk |
|---|---|
| `src/background/` | `index.ts` (dinleyiciler, senkron kayıt), `engine.ts` (komutlar, Chrome↔durum senkronu, undo) |
| `src/chrome/` | `ChromeTabsAdapter` (Chrome API'lerinin tek kapısı, sürükleme sırasında tekrar dener), `messaging.ts` (tipli komut sözleşmesi) |
| `src/storage/` | `schema.ts` (varsayılanlar, doğrulama/migrasyon), `reducer.ts` (saf event reducer), `persistence.ts` (write-ahead journal) |
| `src/features/recovery/` | Açılışta kurtarma: snapshot → journal replay → yerel yedek → temiz durum |
| `src/features/backup/` | JSON (kayıpsız) ve CSV (taşınabilir) dışa/içe aktarma |
| `src/features/ai/` | Provider arayüzü, katalog, yerel heuristic, OpenAI uyumlu bulut sağlayıcı, servis zinciri |
| `src/features/search/` | Yerel bulanık arama (asla AI çağırmaz) |
| `src/features/canvases/` | UI seçicileri |
| `src/sidepanel/` | Ana yüzey: başlık, sanal sekme listesi, Canvas listesi, komut paleti, öneri sayfası |
| `src/options/` | Ayarlar: görünüm, davranış, AI sağlayıcıları, gizlilik önizlemesi, yedekleme |
| `src/sleep/` | Uyuyan sekme sayfası (aşağıya bakın) |
| `src/components`, `src/hooks`, `src/lib` | Paylaşılan UI, store (zustand), yardımcılar |

Popup bilinçli olarak yok: araç çubuğu ikonu `openPanelOnActionClick` ile side panel'i açar; popup bu davranışı engellerdi.

## 3. Veri modeli

`src/types/index.ts` README §5'teki `Canvas`, `StoredTab` ve `PersistedState` tiplerini birebir uygular,
ek olarak `lastSeq` (snapshot'a katlanmış son journal sırası) taşır.

- `StoredTab.id` kalıcı UUID'dir. `chromeTabId` yalnızca **o tarayıcı oturumunda** güvenilir.
- `chromeTabId === undefined` ⇒ sekme Canvas'ta kayıtlı ama Chrome'da açık değil ("sleeping/stored").
- Canvas renkleri Chrome tab group renkleriyle birebir aynıdır (`grey, blue, red, yellow, green, pink, purple, cyan, orange`).

## 4. Crash-safe persistence

1. Her değişiklik bir **event**'tir (`CANVAS_CREATED`, `TAB_ASSIGNED`, `TAB_CLOSED`, `TABS_SYNCED` …).
2. Event bellekte uygulanır ve `tc:journal` anahtarına yazılır (25 ms'lik birleştirme ile).
3. Kullanıcı komutlarında yanıt **journal diske yazıldıktan sonra** döner (write-ahead).
4. 400 ms (en geç 2 sn) sonra snapshot `tc:state` yazılır ve journal kısaltılır.
5. Açılışta `RecoveryService`: snapshot'ı doğrular/migrate eder, `seq > lastSeq` olan event'leri yeniden oynatır.
   Snapshot bozuksa en yeni yerel yedeğe, o da yoksa temiz duruma döner ve UI'da bildirir.
6. Her 30 dakikada (değişiklik varsa) ve her içe aktarma/geri yüklemeden önce yerel snapshot alınır (son 8; API anahtarları hariç).

Tarayıcı yeniden başlatma tespiti: `chrome.storage.session` tarayıcı kapanınca silinir. Anahtar yoksa eski
`chromeTabId`'ler yalnızca URL de eşleşirse kabul edilir; sonra URL ile eşleştirme yapılır, eşleşmeyenler "stored" olur.

Pencere kapatmak (veya Chrome'dan çıkmak) sekmeleri Canvas'tan **silmez**, "stored" yapar. Tek bir sekmeyi kapatmak siler (Undo ile geri gelir).

## 5. Chrome ile eşleme

- Her Canvas, bulunduğu her pencerede adlandırılmış ve renklendirilmiş bir **tab group** olarak yansıtılır.
  `reconcile()` grupları çoğunluk sahipliğine göre belirler, eksikleri gruplar, başlık/rengi düzeltir. Kullanıcı
  Chrome'da grubu yeniden adlandırırsa Canvas da yeniden adlandırılır; sekmeyi başka gruba sürüklerse sekme o Canvas'a geçer.
- **Geçiş modları:** *Collapse others* (varsayılan; diğer Canvas grupları katlanır, yüklü kalır) veya
  *Unload others* (diğer Canvas'ların sekmeleri kapatılıp "stored" olur, dönünce açılır).
- **Uyuyan sekmeler:** Bir Canvas açılırken kayıtlı sekmeler `sleep/index.html#u=…&t=…` sayfasıyla açılır;
  sekme aktif olduğu anda gerçek URL'ye gider. Motor bu URL'leri gerçek URL'ye çevirerek izler; kayıtlı URL hiç değişmez.
  `chrome.tabs.discard` kullanılmaz: e2e testinde yeni açılmış sekmeyi discard etmek Edge 154'ü ve Chromium 153'ü kapattı.
- Yeni sekme: tab group'una → opener'ının Canvas'ına → aktif Canvas'a atanır.

## 6. AI katmanı

`AiGroupingProvider` (README §3) arayüzü; zincir: kullanıcının bağladığı yerel açık kaynak modeller (yalnızca localhost, anahtarsız) → cihaz üzerindeki heuristic.
Ayrıntı: [`AI_PROVIDER_POLICY.md`](AI_PROVIDER_POLICY.md).

- Model çıktısı güvenilmez veri sayılır: kısa kimlikler (`t1…`) geri eşlenir, uydurma kimlikler atılır,
  bir sekme yalnızca bir gruba girer, en az 2 sekme kuralı uygulanır.
- AI hiçbir zaman sekmeleri kendi başına taşımaz: öneriler banner/inceleme sayfasında onaylanır, her uygulama Undo'ludur.
- Yeni sekme önerileri yalnızca cihaz üzerinde çalışır (hızlı, gizli, rate-limit yok).

## 7. UI

- Durum, uzun ömürlü port ile itilir; zustand seçicileri yalnızca değişen parçayı render eder.
  Port koparsa (worker durdu) UI yeniden bağlanır ve bu worker'ı uyandırır; worker durumu diskten kurar.
- Sekme listesi `@tanstack/react-virtual` ile sanallaştırılır (118 sekmede DOM'da ~21 satır).
- Klavye: `Ctrl/⌘+K` veya `/` palet, `Alt+1…9` Canvas, `Ctrl/⌘+Z` geri al, `F2` yeniden adlandır, `Alt+↑/↓` Canvas sırası,
  listede `↑/↓/Home/End/Enter/Space/Delete`, `Shift+↑/↓` seçim genişletme. Modallar odak tuzağı kurar ve odağı geri verir.
- Tema: System/Light/Dark; JS yüklenmeden önce de OS'u izleyen CSS (karanlık modda beyaz flaş yok).

## 8. Güvenlik

- CSP: `script-src 'self'`; uzak kod yok; Inter fontu paket içinde (Google Fonts isteği yok).
- Hesap, API anahtarı, sunucu, analitik yok. Tek isteğe bağlı ağ erişimi kullanıcının eklediği `localhost` modelidir;
  host izni (`http://localhost/*`, `http://127.0.0.1/*`) ancak o zaman istenir.
- CSV dışa aktarımı formül enjeksiyonuna karşı korunur; içe aktarmada `javascript:` vb. URL'ler reddedilir.
- Uyku sayfası yalnızca `http(s)` hedeflere yönlenir.

## 9. Test

| Komut | Kapsam |
|---|---|
| `npm test` | Reducer, journal replay / crash kurtarma, yedekten dönüş, eski bulut ayarlarının temizlenmesi, CSV/JSON gidiş-dönüş, URL temizleme, heuristic, yerel model (sahte fetch, meşgul → heuristic) |
| `npm run build && npm run e2e` | Uzantıyı gerçek Chromium'a yükler; README §13 kontrol listesini uçtan uca dener (39 kontrol), ekran görüntülerini `test-results/` altına yazar |

E2E notları: Markalı Chrome 137+ `--load-extension`'ı yok sayar. Betik Playwright Chromium'u kullanır, yoksa Edge'e
düşer (`E2E_BROWSER=yol` ile değiştirilebilir). Web sayfaları istek yakalama ile sahte verilir; ağ kullanılmaz.

## 10. Arayüz (v0.2)

Buzlu cam tasarım: arkada aktif Canvas renginden beslenen statik bir renk zemini (`.backdrop`), üstünde `backdrop-filter`
ile bulanıklaştırılmış yarı saydam yüzeyler (`.glass`). Zemin bilinçli olarak animasyonsuzdur; animasyonlu zemin her karede
tüm blur katmanlarını yeniden çizdirirdi. Canvas değiştiğinde renk `@property --orb-a` ile yumuşakça geçer.
`prefers-reduced-transparency` ve `backdrop-filter` desteklenmeyen ortamlarda yüzeyler opak olur.

Sağlamlık: `init()` asla reddedilmez; hatalar kaydedilir (Ayarlar → About & diagnostics). Arka plan 6 sn içinde yanıt
vermezse panel "Reload extension" ekranı gösterir. HTML dosyaları eklenti dışında (`file://`) açılırsa script gerektirmeyen
bir kurulum açıklaması görünür.

Bilinen test kısıtı: Headless Microsoft Edge otomasyon altında yeni sekme sayfasını (`edge://newtab`) açınca kapanıyor
(uzantıdan bağımsız, ham `chrome.tabs.create` ile doğrulandı). E2E bu yüzden Inbox'ı boş bırakmaz.
