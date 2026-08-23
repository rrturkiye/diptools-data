const fs = require('fs');
const https = require('https');

function fetchJson(url) {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

async function run() {
  fs.mkdirSync('data', { recursive: true });

  // 1. Canlı Verileri Çek
  const livePlayersData = await fetchJson('https://diplomacia.com.tr/api/online/players');
  const liveProvincesData = await fetchJson('https://diplomacia.com.tr/api/provinces/all');
  const liveCountriesData = await fetchJson('https://diplomacia.com.tr/api/countries');

  // 2. Mevcut Arşivi Oku (Offline oyuncuları korumak için)
  let masterPlayersMap = new Map();
  if (fs.existsSync('data/all_players.json')) {
    try {
      const existing = JSON.parse(fs.readFileSync('data/all_players.json', 'utf8'));
      if (Array.isArray(existing)) {
        existing.forEach(p => masterPlayersMap.set(p.username, p));
      }
    } catch (e) {}
  }

  // 3. Online Oyuncuları Arşive Ekle / Güncelle (Offline olanlar ASLA SİLİNMEZ)
  if (livePlayersData && livePlayersData.players && Array.isArray(livePlayersData.players)) {
    livePlayersData.players.forEach(p => {
      masterPlayersMap.set(p.username, p); // Varsa günceller, yoksa yeni ekler
    });

    // Anlık sadece online olanları kaydet
    fs.writeFileSync('data/online_players.json', JSON.stringify(livePlayersData.players, null, 2), 'utf8');
  }

  // 4. Gelmiş Geçmiş Tüm Oyuncuları (Master DB) Kaydet
  const allPlayersList = Array.from(masterPlayersMap.values());
  fs.writeFileSync('data/all_players.json', JSON.stringify(allPlayersList, null, 2), 'utf8');

  // 5. Eyaletleri ve Ülkeleri Kaydet
  if (liveProvincesData && liveProvincesData.provinces) {
    fs.writeFileSync('data/provinces.json', JSON.stringify(liveProvincesData.provinces, null, 2), 'utf8');
  }
  if (liveCountriesData) {
    const cList = Array.isArray(liveCountriesData) ? liveCountriesData : (liveCountriesData.countries || []);
    fs.writeFileSync('data/countries.json', JSON.stringify(cList, null, 2), 'utf8');
  }

  console.log(`Eşitleme Tamamlandı! Toplam Arşivlenen Oyuncu: ${allPlayersList.length}`);
}

run();
