# Chromotion — Master Build Prompt

Bu dosyayı Chromotion üzerinde çalışacak bir coding agent'a ilk mesaj olarak ver.

---

Sen Chromotion'ın geliştiricisisin: Chrome sekmelerini AI destekli, kalıcı ve hızlı geçiş yapılabilen **Canvas**
çalışma alanlarına ayıran bir Manifest V3 eklentisi.

## Önce oku (sırayla)

1. `docs/BUILD_KIT.md` — **proje sözleşmesi.** Bölüm 13'teki MVP kriterleri pazarlık konusu değildir.
2. `docs/ARCHITECTURE.md` — mevcut mimari, veri akışı, crash-safety tasarımı.
3. `docs/AI_PROVIDER_POLICY.md` — ücretsiz AI politikası ve veri minimizasyonu.
4. `design-system/chromotion/MASTER.md` — tasarım sistemi; en alttaki **Chromotion Project Refinements** bölümü üretilen tablolara göre önceliklidir.

## Zorunlu adımlar

- **UI'ya dokunmadan önce:** UI/UX Pro Max'i kontrol et (<https://github.com/nextlevelbuilder/ui-ux-pro-max-skill>).
  Skill `.claude/skills/ui-ux-pro-max` altında kurulu. Yeni bir sayfa/ekran için:
  `python .claude/skills/ui-ux-pro-max/scripts/search.py "<sorgu>" --design-system --persist -p "Chromotion" --page "<sayfa>"`
  ve `design-system/chromotion/pages/<sayfa>.md` varsa onu MASTER'a tercih et.
- **AI:** Chromotion ücretsiz ve açık kaynaktır (MIT): API anahtarı, hesap ve bulut **yok** (bkz. `docs/AI_PROVIDER_POLICY.md`).
  Yalnızca cihaz üzerindeki heuristic ve kullanıcının bağladığı localhost açık kaynak modeller. Model adı sabit kodlama.

## Değişmez kurallar

- Chrome API çağrıları yalnızca `src/chrome/ChromeTabsAdapter.ts` ve `src/background/engine.ts` içinde. React bileşenleri `send()` ile komut yollar.
- Kalıcı durumun tek yazarı service worker'dır; her mutasyon `PersistenceService.dispatch` ile bir journal event'idir.
  Yeni bir değişiklik türü = `types/index.ts`'e event + `storage/reducer.ts`'e saf işleyici + test.
- Reducer saf kalır (içinde `Date.now()`/random yok); replay deterministik olmalı.
- Chrome `tabId` kalıcı kimlik değildir; `StoredTab.id` (UUID) kullanılır.
- AI asla sessizce sekme dağıtmaz; her öneri onaylanır ve Undo'ludur. Ana UI'da chat kutusu yok.
- AI kapalı/başarısızken ürün tam çalışır (yerel heuristic).
- Veri cihazdan çıkmaz; yerel modele yalnızca başlık, hostname, temizlenmiş yol ve Canvas adları gider. Cookie/form/sayfa gövdesi asla.
- API anahtarı alanı veya bulut sağlayıcısı ekleme.
- `chrome.tabs.discard` kullanma (yeni sekmede Chromium/Edge'i çökertti); tembel yükleme `sleep/` sayfasıyla yapılır.
- Uzak script yok, CSP `script-src 'self'`.
- Arayüz buzlu camdır (`.glass` + `.backdrop`); metin kontrastı 4.5:1, `prefers-reduced-transparency` desteklenir.

## Doğrulama (bitti demeden önce)

```bash
npm run typecheck
npm test
npm run build
npm run e2e
```

`npm run e2e` uzantıyı gerçek Chromium'a (yoksa Edge'e) yükler ve docs/BUILD_KIT.md §13'ü uçtan uca dener; 39/39 geçmeli.
`test-results/` altındaki ekran görüntülerine light ve dark için bak. Yeni bir özellik eklediysen e2e'ye de kontrol ekle.

## Teslim

Ne değiştiğini, hangi kontrollerin geçtiğini (çıktısıyla) ve doğrulanamayanları açıkça yaz.

---
Chromotion · by Burhan Celebi · drburhancelebi@icloud.com · MIT
