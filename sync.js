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

async function fetchInBatches(items, batchSize, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
    await new Promise(r => setTimeout(r, 60));
  }
  return results;
}

async function run() {
  fs.mkdirSync('data', { recursive: true });
  console.log('🚀 Diplomacia Kapsamlı Veri Taraması Başlatılıyor...');

  // 1. Ana Listeleri Çek
  const [
    liveProvincesData,
    liveCountriesData,
    liveOnlinePlayersData,
    mapColorsData,
    mapScoresData,
    resourceBonusesData,
    geoBlocsColorsData,
    wealthLeaderboardData
  ] = await Promise.all([
    fetchJson('https://diplomacia.com.tr/api/provinces/all'),
    fetchJson('https://diplomacia.com.tr/api/countries'),
    fetchJson('https://diplomacia.com.tr/api/online/players'),
    fetchJson('https://diplomacia.com.tr/api/countries/map/colors'),
    fetchJson('https://diplomacia.com.tr/api/countries/map/scores'),
    fetchJson('https://diplomacia.com.tr/api/provinces/resource-bonuses'),
    fetchJson('https://diplomacia.com.tr/api/geo-blocs/map-colors'),
    fetchJson('https://diplomacia.com.tr/api/countries/leaderboard/wealth?page=1&limit=50&status=active')
  ]);

  const countriesList = Array.isArray(liveCountriesData) ? liveCountriesData : (liveCountriesData?.countries || []);
  const provincesList = liveProvincesData?.provinces || [];

  console.log(`📍 ${countriesList.length} Ülke ve ${provincesList.length} Eyalet Tespit Edildi.`);

  // 2. Mevcut Dosyaları Oku
  let allPlayersMap = new Map();
  if (fs.existsSync('data/all_players.json')) {
    try {
      const existing = JSON.parse(fs.readFileSync('data/all_players.json', 'utf8'));
      if (Array.isArray(existing)) {
        existing.forEach(p => {
          const key = p.id || ('num_' + p.player_number) || p.username;
          allPlayersMap.set(key, p);
        });
      }
    } catch (e) {}
  }

  let seenOnlineMap = new Map();
  if (fs.existsSync('data/seen_online_players.json')) {
    try {
      const existingOnlineHistory = JSON.parse(fs.readFileSync('data/seen_online_players.json', 'utf8'));
      if (Array.isArray(existingOnlineHistory)) {
        existingOnlineHistory.forEach(p => {
          const key = p.id || ('num_' + p.player_number) || p.username;
          seenOnlineMap.set(key, p);
        });
      }
    } catch (e) {}
  }

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

  // 3. 🕒 BİR ZAMANLAR ONLİNE GÖRÜNMÜŞ OYUNCULARI GÜNCELLE
  if (liveOnlinePlayersData && Array.isArray(liveOnlinePlayersData.players)) {
    const instantOnline = liveOnlinePlayersData.players;

    instantOnline.forEach(p => {
      const key = p.id || ('num_' + p.player_number) || p.username;
      seenOnlineMap.set(key, { ...p });
    });

    fs.writeFileSync('data/online_players.json', JSON.stringify(instantOnline, null, 2), 'utf8');
  }

  // 4. 🌐 76 ÜLKENİN TÜM VATANDAŞLARINI DERİNLEMESİNE TOPLA
  console.log('🌐 76 Ülkenin Tüm Vatandaşları Çekiliyor...');
  const allCitizens = [];

  if (liveOnlinePlayersData && Array.isArray(liveOnlinePlayersData.players)) {
    allCitizens.push(...liveOnlinePlayersData.players);
  }

  await fetchInBatches(countriesList, 8, async (c) => {
    if (!c.id) return;
    const res = await fetchJson(`https://diplomacia.com.tr/api/countries/${c.id}/players`);
    const pList = Array.isArray(res) ? res : (res?.players || []);
    pList.forEach(p => {
      if (!p.country_name) p.country_name = c.name;
      if (!p.country_flag) p.country_flag = c.flag_url || c.flag;
      allCitizens.push(p);
    });
  });

  // all_players.json ve name_changes.json Güncelleme
  allCitizens.forEach(freshPlayer => {
    if (!freshPlayer.username) return;
    const primaryKey = freshPlayer.id || ('num_' + freshPlayer.player_number) || freshPlayer.username;
    let existingPlayer = allPlayersMap.get(primaryKey);

    if (!existingPlayer && freshPlayer.player_number) {
      for (const [k, p] of allPlayersMap.entries()) {
        if (p.player_number && p.player_number === freshPlayer.player_number) {
          existingPlayer = p;
          break;
        }
      }
    }

    if (existingPlayer) {
      // İsim Değişikliği Kontrolü -> Sadece name_changes.json içine yaz
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
        }
        changeRecord.current_username = freshPlayer.username;
        changeRecord.level = freshPlayer.level;
        changeRecord.xp = freshPlayer.xp;
      }

      // all_players.json güncelle (Tamamen Sade)
      existingPlayer.id = freshPlayer.id || existingPlayer.id;
      existingPlayer.player_number = freshPlayer.player_number || existingPlayer.player_number;
      existingPlayer.username = freshPlayer.username;
      existingPlayer.avatar_url = freshPlayer.avatar_url || existingPlayer.avatar_url;
      existingPlayer.xp = Math.max(freshPlayer.xp || 0, existingPlayer.xp || 0);
      existingPlayer.cabinet_role = freshPlayer.cabinet_role !== undefined ? freshPlayer.cabinet_role : existingPlayer.cabinet_role;
      existingPlayer.last_active = freshPlayer.last_active || existingPlayer.last_active;
      existingPlayer.country_name = freshPlayer.country_name || existingPlayer.country_name;
      existingPlayer.country_flag = freshPlayer.country_flag || existingPlayer.country_flag;
      existingPlayer.level = Math.max(freshPlayer.level || 1, existingPlayer.level || 1);

      allPlayersMap.set(primaryKey, existingPlayer);
    } else {
      allPlayersMap.set(primaryKey, {
        id: freshPlayer.id,
        player_number: freshPlayer.player_number,
        username: freshPlayer.username,
        avatar_url: freshPlayer.avatar_url,
        xp: freshPlayer.xp || 0,
        cabinet_role: freshPlayer.cabinet_role || null,
        last_active: freshPlayer.last_active,
        country_name: freshPlayer.country_name,
        country_flag: freshPlayer.country_flag,
        level: freshPlayer.level || 1
      });
    }
  });

  // 5. 🏛️ 181 EYALETİ ŞEHİR ŞEHİR GEZ (Partiler, Fabrikalar, Vergiler)
  console.log('🏛️ 181 Eyalet Taranıyor...');
  const allParties = [];
  const allProvinceFactories = {};
  const allProvinceTaxes = {};

  await fetchInBatches(provincesList, 10, async (prov) => {
    const pName = encodeURIComponent(prov.name);

    const partiesRes = await fetchJson(`https://diplomacia.com.tr/api/parties/province/${pName}`);
    if (partiesRes) {
      const pArr = Array.isArray(partiesRes) ? partiesRes : (partiesRes.parties || []);
      pArr.forEach(party => {
        party.province_name = prov.name;
        party.country_name = prov.country_name;
        allParties.push(party);
      });
    }

    const factoriesRes = await fetchJson(`https://diplomacia.com.tr/api/provinces/factories?provinceName=${pName}`);
    if (factoriesRes) allProvinceFactories[prov.name] = factoriesRes;

    const taxRes = await fetchJson(`https://diplomacia.com.tr/api/provinces/tax-revenue?province_name=${pName}`);
    if (taxRes) allProvinceTaxes[prov.name] = taxRes;
  });

  // 6. DOSYALARI KAYDET
  // A) Tüm Oyuncular (76 Ülkenin Tüm Vatandaşları)
  const allPlayersList = Array.from(allPlayersMap.values()).sort((a, b) => (b.xp || 0) - (a.xp || 0));
  fs.writeFileSync('data/all_players.json', JSON.stringify(allPlayersList, null, 2), 'utf8');

  // B) Bir Zamanlar Online Görünmüş Oyuncular
  const seenOnlineList = Array.from(seenOnlineMap.values()).sort((a, b) => (b.xp || 0) - (a.xp || 0));
  fs.writeFileSync('data/seen_online_players.json', JSON.stringify(seenOnlineList, null, 2), 'utf8');

  // C) İsim Değiştirenler
  fs.writeFileSync('data/name_changes.json', JSON.stringify(Array.from(nameChangesMap.values()), null, 2), 'utf8');

  // D) Eyalet ve Parti Dosyaları
  fs.writeFileSync('data/all_parties.json', JSON.stringify(allParties, null, 2), 'utf8');
  fs.writeFileSync('data/all_province_factories.json', JSON.stringify(allProvinceFactories, null, 2), 'utf8');
  fs.writeFileSync('data/all_province_taxes.json', JSON.stringify(allProvinceTaxes, null, 2), 'utf8');

  // E) Genel Eyalet, Ülke ve Harita Dosyaları
  if (provincesList.length > 0) fs.writeFileSync('data/provinces.json', JSON.stringify(provincesList, null, 2), 'utf8');
  if (countriesList.length > 0) fs.writeFileSync('data/countries.json', JSON.stringify(countriesList, null, 2), 'utf8');
  if (mapColorsData) fs.writeFileSync('data/country_map_colors.json', JSON.stringify(mapColorsData, null, 2), 'utf8');
  if (mapScoresData) fs.writeFileSync('data/country_map_scores.json', JSON.stringify(mapScoresData, null, 2), 'utf8');
  if (resourceBonusesData) fs.writeFileSync('data/province_resource_bonuses.json', JSON.stringify(resourceBonusesData, null, 2), 'utf8');
  if (geoBlocsColorsData) fs.writeFileSync('data/geo_blocs_map_colors.json', JSON.stringify(geoBlocsColorsData, null, 2), 'utf8');
  if (wealthLeaderboardData) fs.writeFileSync('data/countries_wealth_leaderboard.json', JSON.stringify(wealthLeaderboardData, null, 2), 'utf8');

  console.log(`🎉 TÜM İŞLEMLER BAŞARIYLA TAMAMLANDI!`);
  console.log(`- TÜM OYUNCULAR (76 Ülke): ${allPlayersList.length}`);
  console.log(`- BİR ZAMANLAR ONLİNE GÖRÜNMÜŞ OYUNCULAR: ${seenOnlineList.length}`);
  console.log(`- İSİM DEĞİŞTİRENLER: ${nameChangesMap.size}`);
  console.log(`- TOPLAM PARTİ: ${allParties.length}`);
}

run();
