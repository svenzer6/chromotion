# Chromotion — AI Politikası

> Karar (2026-10-07, Burhan Celebi): Chromotion **ücretsiz dağıtılır ve tamamen açık kaynaktır (MIT)**.
> Hiçbir hesap, API anahtarı veya bulut servisi gerekmez ya da kullanılmaz.
> Kod: `src/features/ai/catalog.ts`.

## 1. Kurallar

1. **Varsayılan: cihaz üzerinde.** Gruplama, Canvas adı önerisi, yeni sekme önerisi ve arama
   yerel heuristic ile tarayıcının içinde çalışır. Ağ isteği yoktur.
2. **İsteğe bağlı: kullanıcının kendi bilgisayarındaki açık kaynak model.** OpenAI uyumlu yerel
   bir sunucu (`/v1/chat/completions` + `/v1/models`) bağlanabilir. Yalnızca `localhost` / `127.0.0.1` adreslerine izin verilir;
   uzak adresler hem arayüzde hem kayıtlı durumun doğrulamasında reddedilir.
3. **API anahtarı yok.** Hiçbir yerde anahtar alanı, depolaması ya da `Authorization` başlığı yoktur.
   Eski sürümlerden kalan bulut ayarları (ve anahtarları) migration sırasında silinir.
4. **Model adı sabit kodlanmaz.** Model alanı boşsa sunucunun canlı `/models` listesinden bir sohbet modeli seçilir.
5. **Hata ürünü bozmaz.** Yerel sunucu kapalı, izin verilmemiş veya meşgulse kısa bir bekleme süresi uygulanır
   ve cihaz üzerindeki heuristic kullanılır.
6. AI asla sekmeleri kendi başına taşımaz; her öneri onaylanır ve geri alınabilir.

## 2. Yerel sunucu hazır ayarları

| Ad | Varsayılan adres | Not |
|---|---|---|
| Ollama | `http://localhost:11434/v1` | `OLLAMA_ORIGINS=chrome-extension://*` ile başlatılmalı |
| LM Studio | `http://localhost:1234/v1` | Developer sekmesinde "Start server" |
| Diğer yerel sunucu | `http://localhost:8080/v1` | llama.cpp, Jan, vLLM, LocalAI… |

## 3. Veri

| Veri | Nereye gider |
|---|---|
| Canvas'lar, sekmeler, ayarlar, yedekler | Yalnızca tarayıcının yerel eklenti depolaması |
| Gruplama / adlandırma / arama | Cihaz üzerinde hesaplanır |
| Sekme başlığı, hostname, URL yolu (sorgu dizesi yok) | Yalnızca kullanıcının bağladığı localhost modele |
| Cookie, form, şifre, sayfa içeriği, geçmiş | Hiç okunmaz |

Yerel modele istekler `credentials: 'omit'` ve `no-referrer` ile gider. Host izni (`http://localhost/*`, `http://127.0.0.1/*`)
yalnızca kullanıcı bir yerel model eklediğinde istenir.

## 4. Neden bulut yok?

Ücretsiz bulut katmanları (bkz. <https://github.com/OuterSpacee/free-ai-apis>) kişisel API anahtarı ister, koşulları habersiz
değişir ve bazıları istemleri eğitimde kullanır. Herkese ücretsiz dağıtılan açık kaynak bir eklentide bu, kullanıcıya hesap
açtırmak ve sekme başlıklarını üçüncü taraflara göndermek demekti. Cihaz üzerindeki gruplama tüm MVP kriterlerini karşılıyor;
daha akıllı öneri isteyenler kendi bilgisayarlarında açık kaynak bir model çalıştırabilir.
