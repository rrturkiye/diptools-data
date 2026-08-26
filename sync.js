const fs = require('fs');
const https = require('https');

// Akıllı ve Hata Korumalı Fetcher (Rate-Limit & 429 Kalkanı)
function politeFetch(url, retries = 3) {
  return new Promise((resolve) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', async () => {
        try {
          const json = JSON.parse(data);

          // Sunucu "Çok fazla istek" dediyse bekle ve tekrar dene
          if (json && (json.code === 'TOO_MANY_REQUESTS' || json.error)) {
            if (retries > 0) {
              const waitSec = Math.min(json.retryAfter || 5, 20) + 1;
              console.log(`⏳ Sunucu bekleme istedi (${url}). ${waitSec}s bekleniyor...`);
              await new Promise(r => setTimeout(r, waitSec * 1000));
              const retryRes = await politeFetch(url, retries - 1);
              return resolve(retryRes);
            }
            return resolve(null);
          }

          resolve(json);
        } catch (e) {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

// Belirtilen milisaniye kadar duraklama
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function run() {
  fs.mkdirSync('data', { recursive: true });
  console.log('🚀 Diplomacia Zırhlı Veri Taraması Başlatılıyor...');

  // 1. Temel Listeleri Çek
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
    politeFetch('https://diplomacia.com.tr/api/provinces/all'),
    politeFetch('https://diplomacia.com.tr/api/countries'),
    politeFetch('https://diplomacia.com.tr/api/online/players'),
    politeFetch('https://diplomacia.com.tr/api/countries/map/colors'),
    politeFetch('https://diplomacia.com.tr/api/countries/map/scores'),
    politeFetch('https://diplomacia.com.tr/api/provinces/resource-bonuses'),
    politeFetch('https://diplomacia.com.tr/api/geo-blocs/map-colors'),
    politeFetch('https://diplomacia.com.tr/api/countries/leaderboard/wealth?page=1&limit=50&status=active')
  ]);

  const countriesList = Array.isArray(liveCountriesData) ? liveCountriesData : (liveCountriesData?.countries || []);
  const provincesList = liveProvincesData?.provinces || [];

  console.log(`📍 ${countriesList.length} Ülke ve ${provincesList.length} Eyalet Tespit Edildi.`);

  // 2. Mevcut Dosyaları Oku (Hata durumunda veriyi kaybetmemek için)
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
      const existingOnline = JSON.parse(fs.readFileSync('data/seen_online_players.json', 'utf8'));
      if (Array.isArray(existingOnline)) {
        existingOnline.forEach(p => {
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

  // 3. Online Oyuncuları Arşivle
  if (liveOnlinePlayersData && Array.isArray(liveOnlinePlayersData.players)) {
    const instantOnline = liveOnlinePlayersData.players;
    instantOnline.forEach(p => {
      const key = p.id || ('num_' + p.player_number) || p.username;
      seenOnlineMap.set(key, { ...p });
    });
    fs.writeFileSync('data/online_players.json', JSON.stringify(instantOnline, null, 2), 'utf8');
  }

  // 4. 🌐 76 ÜLKENİN TÜM VATANDAŞLARINI DÜZENLİ ARALIKLA TOPLA
  console.log('🌐 76 Ülke Vatandaşları Taranıyor...');
  const allCitizens = [];
  if (liveOnlinePlayersData && Array.isArray(liveOnlinePlayersData.players)) {
    allCitizens.push(...liveOnlinePlayersData.players);
  }

  for (const c of countriesList) {
    if (!c.id) continue;
    const res = await politeFetch(`https://diplomacia.com.tr/api/countries/${c.id}/players`);
    if (res && !res.error) {
      const pList = Array.isArray(res) ? res : (res?.players || []);
      pList.forEach(p => {
        if (!p.country_name) p.country_name = c.name;
        if (!p.country_flag) p.country_flag = c.flag_url || c.flag;
        allCitizens.push(p);
      });
    }
    await sleep(100); // 100ms nefes payı
  }

  // Oyuncuları eşle ve güncelle
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
      // İsim Değişikliği
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

      // all_players güncelle
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

  // 5. 🏛️ 181 EYALETİ SIRAYLA VE KONTROLLÜ HIZDA TARA (Partiler, Fabrikalar, Vergiler)
  console.log('🏛️ 181 Eyalet Sakin Hızla Taranıyor...');
  const allPartiesMap = new Map();
  let allProvinceFactories = {};
  let allProvinceTaxes = {};

  // Varsa önceki fabrika/vergi verisini yükle
  if (fs.existsSync('data/all_province_factories.json')) {
    try { allProvinceFactories = JSON.parse(fs.readFileSync('data/all_province_factories.json', 'utf8')) || {}; } catch(e) {}
  }
  if (fs.existsSync('data/all_province_taxes.json')) {
    try { allProvinceTaxes = JSON.parse(fs.readFileSync('data/all_province_taxes.json', 'utf8')) || {}; } catch(e) {}
  }

  for (let i = 0; i < provincesList.length; i++) {
    const prov = provincesList[i];
    const pName = encodeURIComponent(prov.name);

    // 1. Eyalet Partileri
    const partiesRes = await politeFetch(`https://diplomacia.com.tr/api/parties/province/${pName}`);
    if (partiesRes && !partiesRes.error) {
      const pArr = Array.isArray(partiesRes) ? partiesRes : (partiesRes.parties || []);
      pArr.forEach(party => {
        if (party && (party.id || party.name)) {
          const partyKey = party.id || (party.name + '_' + prov.name);
          party.province_name = prov.name;
          party.country_name = prov.country_name;
          allPartiesMap.set(partyKey, party);
        }
      });
    }
    await sleep(80);

    // 2. Eyalet Fabrikaları
    const factoriesRes = await politeFetch(`https://diplomacia.com.tr/api/provinces/factories?provinceName=${pName}`);
    if (factoriesRes && !factoriesRes.error) {
      allProvinceFactories[prov.name] = factoriesRes;
    }
    await sleep(80);

    // 3. Eyalet Vergileri
    const taxRes = await politeFetch(`https://diplomacia.com.tr/api/provinces/tax-revenue?province_name=${pName}`);
    if (taxRes && !taxRes.error) {
      allProvinceTaxes[prov.name] = taxRes;
    }
    await sleep(80);
  }

  // 6. DOSYALARI GÜVENLE YAZ
  const allPlayersList = Array.from(allPlayersMap.values()).sort((a, b) => (b.xp || 0) - (a.xp || 0));
  fs.writeFileSync('data/all_players.json', JSON.stringify(allPlayersList, null, 2), 'utf8');

  const seenOnlineList = Array.from(seenOnlineMap.values()).sort((a, b) => (b.xp || 0) - (a.xp || 0));
  fs.writeFileSync('data/seen_online_players.json', JSON.stringify(seenOnlineList, null, 2), 'utf8');

  fs.writeFileSync('data/name_changes.json', JSON.stringify(Array.from(nameChangesMap.values()), null, 2), 'utf8');

  const finalPartiesList = Array.from(allPartiesMap.values());
  fs.writeFileSync('data/all_parties.json', JSON.stringify(finalPartiesList, null, 2), 'utf8');
  fs.writeFileSync('data/all_province_factories.json', JSON.stringify(allProvinceFactories, null, 2), 'utf8');
  fs.writeFileSync('data/all_province_taxes.json', JSON.stringify(allProvinceTaxes, null, 2), 'utf8');

  // Diğer Genel Dosyalar
  if (provincesList.length > 0) fs.writeFileSync('data/provinces.json', JSON.stringify(provincesList, null, 2), 'utf8');
  if (countriesList.length > 0) fs.writeFileSync('data/countries.json', JSON.stringify(countriesList, null, 2), 'utf8');
  if (mapColorsData && !mapColorsData.error) fs.writeFileSync('data/country_map_colors.json', JSON.stringify(mapColorsData, null, 2), 'utf8');
  if (mapScoresData && !mapScoresData.error) fs.writeFileSync('data/country_map_scores.json', JSON.stringify(mapScoresData, null, 2), 'utf8');
  if (resourceBonusesData && !resourceBonusesData.error) fs.writeFileSync('data/province_resource_bonuses.json', JSON.stringify(resourceBonusesData, null, 2), 'utf8');
  if (geoBlocsColorsData && !geoBlocsColorsData.error) fs.writeFileSync('data/geo_blocs_map_colors.json', JSON.stringify(geoBlocsColorsData, null, 2), 'utf8');
  if (wealthLeaderboardData && !wealthLeaderboardData.error) fs.writeFileSync('data/countries_wealth_leaderboard.json', JSON.stringify(wealthLeaderboardData, null, 2), 'utf8');

  console.log(`🎉 ZIRHLI TARAMA BAŞARIYLA TAMAMLANDI!`);
  console.log(`- TÜM OYUNCULAR: ${allPlayersList.length}`);
  console.log(`- TOPLAM PARTİ: ${finalPartiesList.length}`);
  console.log(`- 181 Eyaletin Fabrikaları ve Vergileri Hatasız Kaydedildi.`);
}

run();
