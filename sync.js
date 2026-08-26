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

  console.log('Tüm Diplomacia API Verileri Çekiliyor...');

  // 1. Temel API İstekleri
  const [
    livePlayersData,
    liveProvincesData,
    liveCountriesData,
    mapColorsData,
    mapScoresData,
    resourceBonusesData,
    geoBlocsColorsData,
    wealthLeaderboardData
  ] = await Promise.all([
    fetchJson('https://diplomacia.com.tr/api/online/players'),
    fetchJson('https://diplomacia.com.tr/api/provinces/all'),
    fetchJson('https://diplomacia.com.tr/api/countries'),
    fetchJson('https://diplomacia.com.tr/api/countries/map/colors'),
    fetchJson('https://diplomacia.com.tr/api/countries/map/scores'),
    fetchJson('https://diplomacia.com.tr/api/provinces/resource-bonuses'),
    fetchJson('https://diplomacia.com.tr/api/geo-blocs/map-colors'),
    fetchJson('https://diplomacia.com.tr/api/countries/leaderboard/wealth?page=1&limit=50&status=active')
  ]);

  // 2. Fabrika Sıralamaları (6 Kaynak Türü)
  const factoryTypes = ['deri', 'petrol', 'nte', 'altin', 'elmas', 'silah'];
  const factoryPromises = factoryTypes.map(type => 
    fetchJson(`https://diplomacia.com.tr/api/factories/world?page=1&limit=50&type=${type}`)
  );
  const factoryResults = await Promise.all(factoryPromises);

  // 3. Bina Sıralamaları (4 Altyapı Türü)
  const buildingTypes = ['okul', 'hastane', 'yol', 'askeri_us'];
  const buildingPromises = buildingTypes.map(type => 
    fetchJson(`https://diplomacia.com.tr/api/provinces/buildings/world-ranking?buildingType=${type}`)
  );
  const buildingResults = await Promise.all(buildingPromises);

  // 4. Mevcut all_players.json Arşivini Oku (Tamamen Sade)
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

  // 5. Mevcut name_changes.json Dosyasını Oku (Ayrı Takip Havuzu)
  let nameChangesMap = new Map();
  if (fs.existsSync('data/name_changes.json')) {
    try {
      const existingChanges = JSON.parse(fs.readFileSync('data/name_changes.json', 'utf8'));
      if (Array.isArray(existingChanges)) {
        existingChanges.forEach(entry => {
          const key = entry.id || ('num_' + entry.player_number);
          nameChangesMap.set(key, entry);
        });
      }
    } catch (e) {}
  }

  // 6. Online Oyuncuları Eşle, Güncelle ve İsim Değişikliğini Ayrı Dosyada Kaydet
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

      if (existingPlayer) {
        // İsim Değişmişse -> Sadece name_changes.json içine yaz
        if (existingPlayer.username && freshPlayer.username && existingPlayer.username !== freshPlayer.username) {
          let changeRecord = nameChangesMap.get(primaryKey);
          if (!changeRecord) {
            changeRecord = {
              id: freshPlayer.id,
              player_number: freshPlayer.player_number,
              current_username: freshPlayer.username,
              previous_usernames: [],
              avatar_url: freshPlayer.avatar_url,
              level: freshPlayer.level,
              xp: freshPlayer.xp,
              country_name: freshPlayer.country_name,
              country_flag: freshPlayer.country_flag
            };
            nameChangesMap.set(primaryKey, changeRecord);
          }

          const alreadyLogged = changeRecord.previous_usernames.some(h => (typeof h === 'string' ? h : h.name) === existingPlayer.username);
          if (!alreadyLogged) {
            changeRecord.previous_usernames.push({
              name: existingPlayer.username,
              changed_at: new Date().toISOString()
            });
            console.log(`🔍 İsim Değişikliği: "${existingPlayer.username}" ➔ "${freshPlayer.username}"`);
          }

          changeRecord.current_username = freshPlayer.username;
          changeRecord.level = freshPlayer.level;
          changeRecord.xp = freshPlayer.xp;
          changeRecord.avatar_url = freshPlayer.avatar_url;
          changeRecord.country_name = freshPlayer.country_name;
          changeRecord.country_flag = freshPlayer.country_flag;
        }

        // all_players.json için GÜNCELLEME (Tamamen Sade)
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

    fs.writeFileSync('data/online_players.json', JSON.stringify(onlinePlayers, null, 2), 'utf8');
  }

  // 7. all_players.json ve name_changes.json Kaydet
  const allPlayersList = Array.from(masterPlayersMap.values());
  allPlayersList.sort((a, b) => (b.xp || 0) - (a.xp || 0));
  fs.writeFileSync('data/all_players.json', JSON.stringify(allPlayersList, null, 2), 'utf8');
  fs.writeFileSync('data/name_changes.json', JSON.stringify(Array.from(nameChangesMap.values()), null, 2), 'utf8');

  // 8. Eyalet, Ülke ve Harita Dosyaları
  if (liveProvincesData && liveProvincesData.provinces) fs.writeFileSync('data/provinces.json', JSON.stringify(liveProvincesData.provinces, null, 2), 'utf8');
  if (liveCountriesData) fs.writeFileSync('data/countries.json', JSON.stringify(Array.isArray(liveCountriesData) ? liveCountriesData : (liveCountriesData.countries || []), null, 2), 'utf8');
  if (mapColorsData) fs.writeFileSync('data/country_map_colors.json', JSON.stringify(mapColorsData, null, 2), 'utf8');
  if (mapScoresData) fs.writeFileSync('data/country_map_scores.json', JSON.stringify(mapScoresData, null, 2), 'utf8');
  if (resourceBonusesData) fs.writeFileSync('data/province_resource_bonuses.json', JSON.stringify(resourceBonusesData, null, 2), 'utf8');
  if (geoBlocsColorsData) fs.writeFileSync('data/geo_blocs_map_colors.json', JSON.stringify(geoBlocsColorsData, null, 2), 'utf8');

  // 9. En Zengin Ülkeler Liderlik Tablosu
  if (wealthLeaderboardData) {
    fs.writeFileSync('data/countries_wealth_leaderboard.json', JSON.stringify(wealthLeaderboardData, null, 2), 'utf8');
  }

  // 10. Fabrika Dosyalarını Kaydet (6 Tür)
  factoryTypes.forEach((type, index) => {
    const data = factoryResults[index];
    if (data) {
      fs.writeFileSync(`data/factories_${type}.json`, JSON.stringify(data, null, 2), 'utf8');
    }
  });

  // 11. Bina Sıralaması Dosyalarını Kaydet (4 Tür)
  buildingTypes.forEach((type, index) => {
    const data = buildingResults[index];
    if (data) {
      fs.writeFileSync(`data/buildings_${type}.json`, JSON.stringify(data, null, 2), 'utf8');
    }
  });

  console.log(`✅ Tüm Eşitlemeler Başarıyla Tamamlandı!`);
  console.log(`- Oyuncular: ${allPlayersList.length}`);
  console.log(`- Fabrikalar (6 Tür), Binalar (4 Tür) ve Zengin Ülkeler Tablosu Kaydedildi.`);
}

run();
