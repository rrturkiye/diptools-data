const fs = require('fs');
const https = require('https');

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

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function slugify(text) {
  if (!text) return 'unnamed';
  return text.toString().toLowerCase()
    .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's')
    .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function run() {
  fs.mkdirSync('data', { recursive: true });
  fs.mkdirSync('data/countries_detailed', { recursive: true });

  console.log('🚀 Diplomacia Kapsamlı Veri Taraması Başlatılıyor...');

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

  // 4. 🌐 76 Ülkenin Tüm Vatandaşlarını Topla
  console.log('🌐 Ülke Vatandaşları Taranıyor...');
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
    await sleep(80);
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

  // 5. 🏛️ 181 Eyaleti Sırayla Tara (Partiler, Fabrikalar, Vergiler)
  console.log('🏛️ Eyaletler Taranıyor...');
  const allPartiesMap = new Map();
  let allProvinceFactories = {};
  let allProvinceTaxes = {};

  if (fs.existsSync('data/all_province_factories.json')) {
    try { allProvinceFactories = JSON.parse(fs.readFileSync('data/all_province_factories.json', 'utf8')) || {}; } catch(e) {}
  }
  if (fs.existsSync('data/all_province_taxes.json')) {
    try { allProvinceTaxes = JSON.parse(fs.readFileSync('data/all_province_taxes.json', 'utf8')) || {}; } catch(e) {}
  }

  for (let i = 0; i < provincesList.length; i++) {
    const prov = provincesList[i];
    const pName = encodeURIComponent(prov.name);

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
    await sleep(70);

    const factoriesRes = await politeFetch(`https://diplomacia.com.tr/api/provinces/factories?provinceName=${pName}`);
    if (factoriesRes && !factoriesRes.error) {
      allProvinceFactories[prov.name] = factoriesRes;
    }
    await sleep(70);

    const taxRes = await politeFetch(`https://diplomacia.com.tr/api/provinces/tax-revenue?province_name=${pName}`);
    if (taxRes && !taxRes.error) {
      allProvinceTaxes[prov.name] = taxRes;
    }
    await sleep(70);
  }

  // 6. 🌟 YENİ: 3 APİ'Yİ BİRLEŞTİREN DETAYLI ÜLKE VE ŞEHİR VERİTABANI
  console.log('🧩 3 API Birleştiriliyor (Ülkeler + Eyaletler + Kaynak Bonusları)...');
  const bonusMap = new Map();
  const bonusList = (resourceBonusesData && resourceBonusesData.provinces) 
    ? resourceBonusesData.provinces 
    : (Array.isArray(resourceBonusesData) ? resourceBonusesData : []);

  bonusList.forEach(b => {
    if (b && b.name) bonusMap.set(b.name.trim().toLowerCase(), b);
  });

  const countryProvincesMap = new Map();
  const independentProvinces = [];

  provincesList.forEach(p => {
    const bInfo = bonusMap.get((p.name || '').trim().toLowerCase()) || {};
    const enrichedProvince = {
      name: p.name,
      icon: p.icon || null,
      coat_url: bInfo.coat_url || p.coat_url || null,
      region: p.region || null,
      is_capital: Boolean(p.is_capital),
      is_independent: Boolean(p.is_independent),
      independence_date: p.independence_date || null,
      player_count: p.player_count || 0,
      scores: {
        education: p.education_score || 0,
        military: p.military_score || 0,
        development: p.development_score || 0,
        health: p.health_score || 0,
        health_world_first: Boolean(p.health_world_first)
      },
      resource_bonuses: bInfo.bonuses || { deri: 0, altin: 0, petrol: 0, nte: 0, elmas: 0 }
    };

    if (p.country_id) {
      if (!countryProvincesMap.has(p.country_id)) countryProvincesMap.set(p.country_id, []);
      countryProvincesMap.get(p.country_id).push(enrichedProvince);
    } else {
      independentProvinces.push(enrichedProvince);
    }
  });

  const detailedCountries = countriesList.map(c => {
    const cProvinces = countryProvincesMap.get(c.id) || [];
    const capital = cProvinces.find(p => p.is_capital) || null;

    const totalBonuses = { deri: 0, altin: 0, petrol: 0, nte: 0, elmas: 0 };
    let sumEdu = 0, sumMil = 0, sumDev = 0, sumHealth = 0;

    cProvinces.forEach(p => {
      const b = p.resource_bonuses || {};
      totalBonuses.deri += (b.deri || 0);
      totalBonuses.altin += (b.altin || 0);
      totalBonuses.petrol += (b.petrol || 0);
      totalBonuses.nte += (b.nte || 0);
      totalBonuses.elmas += (b.elmas || 0);

      sumEdu += p.scores.education;
      sumMil += p.scores.military;
      sumDev += p.scores.development;
      sumHealth += p.scores.health;
    });

    const pCount = cProvinces.length;

    const countryObj = {
      id: c.id,
      name: c.name,
      flag_url: c.flag_url,
      treasury: c.treasury || 0,
      country_number: c.country_number,
      player_count: c.player_count || 0,
      provinces_count: pCount,
      capital: capital ? { name: capital.name, icon: capital.icon, coat_url: capital.coat_url } : null,
      total_resource_bonuses: totalBonuses,
      average_scores: pCount > 0 ? {
        education: Number((sumEdu / pCount).toFixed(1)),
        military: Number((sumMil / pCount).toFixed(1)),
        development: Number((sumDev / pCount).toFixed(1)),
        health: Number((sumHealth / pCount).toFixed(1))
      } : { education: 0, military: 0, development: 0, health: 0 },
      provinces: cProvinces
    };

    // Ayrı klasöre her ülkeyi tek tek kaydet
    const slug = slugify(c.name);
    fs.writeFileSync(`data/countries_detailed/${slug}.json`, JSON.stringify(countryObj, null, 2), 'utf8');

    return countryObj;
  });

  // Bağımsız eyaletleri de ayrı dosyaya kaydet
  fs.writeFileSync('data/countries_detailed/bagimsiz_eyaletler.json', JSON.stringify({
    title: "Bağımsız / Sahipsiz Eyaletler",
    provinces_count: independentProvinces.length,
    provinces: independentProvinces
  }, null, 2), 'utf8');

  // Birleşik ana dosyayı kaydet
  const masterCountriesDetailed = {
    updated_at: new Date().toISOString(),
    total_countries: detailedCountries.length,
    total_provinces: provincesList.length,
    countries: detailedCountries,
    independent_provinces: independentProvinces
  };
  fs.writeFileSync('data/countries_detailed.json', JSON.stringify(masterCountriesDetailed, null, 2), 'utf8');

  // 7. ORİJİNAL 3 DOSYA (OLDUĞU GİBİ KORUNUYOR)
  if (countriesList.length > 0) fs.writeFileSync('data/countries.json', JSON.stringify(countriesList, null, 2), 'utf8');
  if (provincesList.length > 0) fs.writeFileSync('data/provinces.json', JSON.stringify(provincesList, null, 2), 'utf8');
  if (resourceBonusesData && !resourceBonusesData.error) fs.writeFileSync('data/province_resource_bonuses.json', JSON.stringify(resourceBonusesData, null, 2), 'utf8');

  // 8. Diğer Genel Dosyalar
  const allPlayersList = Array.from(allPlayersMap.values()).sort((a, b) => (b.xp || 0) - (a.xp || 0));
  fs.writeFileSync('data/all_players.json', JSON.stringify(allPlayersList, null, 2), 'utf8');
  fs.writeFileSync('data/seen_online_players.json', JSON.stringify(Array.from(seenOnlineMap.values()).sort((a, b) => (b.xp || 0) - (a.xp || 0)), null, 2), 'utf8');
  fs.writeFileSync('data/name_changes.json', JSON.stringify(Array.from(nameChangesMap.values()), null, 2), 'utf8');

  fs.writeFileSync('data/all_parties.json', JSON.stringify(Array.from(allPartiesMap.values()), null, 2), 'utf8');
  fs.writeFileSync('data/all_province_factories.json', JSON.stringify(allProvinceFactories, null, 2), 'utf8');
  fs.writeFileSync('data/all_province_taxes.json', JSON.stringify(allProvinceTaxes, null, 2), 'utf8');

  if (mapColorsData && !mapColorsData.error) fs.writeFileSync('data/country_map_colors.json', JSON.stringify(mapColorsData, null, 2), 'utf8');
  if (mapScoresData && !mapScoresData.error) fs.writeFileSync('data/country_map_scores.json', JSON.stringify(mapScoresData, null, 2), 'utf8');
  if (geoBlocsColorsData && !geoBlocsColorsData.error) fs.writeFileSync('data/geo_blocs_map_colors.json', JSON.stringify(geoBlocsColorsData, null, 2), 'utf8');
  if (wealthLeaderboardData && !wealthLeaderboardData.error) fs.writeFileSync('data/countries_wealth_leaderboard.json', JSON.stringify(wealthLeaderboardData, null, 2), 'utf8');

  console.log(`🎉 TÜM İŞLEMLER BAŞARIYLA TAMAMLANDI!`);
  console.log(`- data/countries.json, data/provinces.json, data/province_resource_bonuses.json aynen korundu.`);
  console.log(`- data/countries_detailed.json ve data/countries_detailed/ klasörü eksiksiz oluşturuldu!`);
}

run();
