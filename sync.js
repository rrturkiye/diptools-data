const fs = require('fs');
const https = require('https');

function fetchJson(url) {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
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

  console.log('API Verileri Çekiliyor...');

  // 1. Tüm Canlı API İsteklerini Paralel Olarak Çek
  const [
    livePlayersData,
    liveProvincesData,
    liveCountriesData,
    mapColorsData,
    mapScoresData,
    resourceBonusesData,
    geoBlocsColorsData
  ] = await Promise.all([
    fetchJson('https://diplomacia.com.tr/api/online/players'),
    fetchJson('https://diplomacia.com.tr/api/provinces/all'),
    fetchJson('https://diplomacia.com.tr/api/countries'),
    fetchJson('https://diplomacia.com.tr/api/countries/map/colors'),
    fetchJson('https://diplomacia.com.tr/api/countries/map/scores'),
    fetchJson('https://diplomacia.com.tr/api/provinces/resource-bonuses'),
    fetchJson('https://diplomacia.com.tr/api/geo-blocs/map-colors')
  ]);

  // 2. Mevcut all_players.json Arşivini Oku
  let masterPlayersMap = new Map();
  if (fs.existsSync('data/all_players.json')) {
    try {
      const existing = JSON.parse(fs.readFileSync('data/all_players.json', 'utf8'));
      if (Array.isArray(existing)) {
        existing.forEach(p => {
          const key = p.id || ('num_' + p.player_number) || p.username;
          masterPlayersMap.set(key, p);
        });
      }
    } catch (e) {}
  }

  // 3. Online Oyuncuları ID ve Player Number ile Doğrulayıp Güncelle
  let updatedCount = 0;
  let newCount = 0;

  if (livePlayersData && livePlayersData.players && Array.isArray(livePlayersData.players)) {
    const onlinePlayers = livePlayersData.players;

    onlinePlayers.forEach(freshPlayer => {
      const primaryKey = freshPlayer.id || ('num_' + freshPlayer.player_number) || freshPlayer.username;
      let existingPlayer = masterPlayersMap.get(primaryKey);

      if (!existingPlayer && freshPlayer.player_number) {
        for (const [k, p] of masterPlayersMap.entries()) {
          if (p.player_number && p.player_number === freshPlayer.player_number) {
            existingPlayer = p;
            break;
          }
        }
      }

      if (!existingPlayer && freshPlayer.username) {
        for (const [k, p] of masterPlayersMap.entries()) {
          if (p.username && p.username.toLowerCase() === freshPlayer.username.toLowerCase()) {
            existingPlayer = p;
            break;
          }
        }
      }

      if (existingPlayer) {
        // Tüm 8 veriyi en güncel haliyle değiştir
        existingPlayer.id = freshPlayer.id || existingPlayer.id;
        existingPlayer.player_number = freshPlayer.player_number || existingPlayer.player_number;
        existingPlayer.username = freshPlayer.username;
        existingPlayer.avatar_url = freshPlayer.avatar_url;
        existingPlayer.xp = freshPlayer.xp;
        existingPlayer.cabinet_role = freshPlayer.cabinet_role;
        existingPlayer.last_active = freshPlayer.last_active;
        existingPlayer.country_name = freshPlayer.country_name;
        existingPlayer.country_flag = freshPlayer.country_flag;
        existingPlayer.level = freshPlayer.level;

        masterPlayersMap.set(primaryKey, existingPlayer);
        updatedCount++;
      } else {
        masterPlayersMap.set(primaryKey, {
          id: freshPlayer.id,
          player_number: freshPlayer.player_number,
          username: freshPlayer.username,
          avatar_url: freshPlayer.avatar_url,
          xp: freshPlayer.xp,
          cabinet_role: freshPlayer.cabinet_role,
          last_active: freshPlayer.last_active,
          country_name: freshPlayer.country_name,
          country_flag: freshPlayer.country_flag,
          level: freshPlayer.level
        });
        newCount++;
      }
    });

    // Anlık online oyuncular
    fs.writeFileSync('data/online_players.json', JSON.stringify(onlinePlayers, null, 2), 'utf8');
  }

  // 4. Tüm Zamanların Oyuncularını XP'ye Göre Sırala ve Kaydet
  const allPlayersList = Array.from(masterPlayersMap.values());
  allPlayersList.sort((a, b) => (b.xp || 0) - (a.xp || 0));
  fs.writeFileSync('data/all_players.json', JSON.stringify(allPlayersList, null, 2), 'utf8');

  // 5. Eyalet ve Ülke Verileri
  if (liveProvincesData && liveProvincesData.provinces) {
    fs.writeFileSync('data/provinces.json', JSON.stringify(liveProvincesData.provinces, null, 2), 'utf8');
  }
  if (liveCountriesData) {
    const cList = Array.isArray(liveCountriesData) ? liveCountriesData : (liveCountriesData.countries || []);
    fs.writeFileSync('data/countries.json', JSON.stringify(cList, null, 2), 'utf8');
  }

  // 6. YENİ EKLENEN 4 APİ YEDEĞİ
  if (mapColorsData) {
    fs.writeFileSync('data/country_map_colors.json', JSON.stringify(mapColorsData, null, 2), 'utf8');
  }
  if (mapScoresData) {
    fs.writeFileSync('data/country_map_scores.json', JSON.stringify(mapScoresData, null, 2), 'utf8');
  }
  if (resourceBonusesData) {
    fs.writeFileSync('data/province_resource_bonuses.json', JSON.stringify(resourceBonusesData, null, 2), 'utf8');
  }
  if (geoBlocsColorsData) {
    fs.writeFileSync('data/geo_blocs_map_colors.json', JSON.stringify(geoBlocsColorsData, null, 2), 'utf8');
  }

  console.log(`✅ Eşitleme Başarıyla Tamamlandı!`);
  console.log(`- Güncellenen Oyuncular: ${updatedCount}`);
  console.log(`- Yeni Eklenenler: ${newCount}`);
  console.log(`- Toplam Arşiv: ${allPlayersList.length}`);
  console.log(`- Yeni 4 Harita/Kaynak/Pakt API'si Başarıyla Kaydedildi.`);
}

run();
