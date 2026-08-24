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

  // 1. Canlı API Verilerini İndir
  const livePlayersData = await fetchJson('https://diplomacia.com.tr/api/online/players');
  const liveProvincesData = await fetchJson('https://diplomacia.com.tr/api/provinces/all');
  const liveCountriesData = await fetchJson('https://diplomacia.com.tr/api/countries');

  if (!livePlayersData || !livePlayersData.players || !Array.isArray(livePlayersData.players)) {
    console.error('HATA: Canlı oyuncu API verisi alınamadı!');
    return;
  }

  const onlinePlayers = livePlayersData.players;

  // 2. Mevcut all_players.json Arşivini Oku
  let masterPlayersMap = new Map();
  if (fs.existsSync('data/all_players.json')) {
    try {
      const existing = JSON.parse(fs.readFileSync('data/all_players.json', 'utf8'));
      if (Array.isArray(existing)) {
        existing.forEach(p => {
          // Benzersiz anahtar (Öncelik: ID -> player_number -> username)
          const key = p.id || ('num_' + p.player_number) || p.username;
          masterPlayersMap.set(key, p);
        });
      }
    } catch (e) {
      console.warn('Mevcut all_players.json okunamadı, yeni oluşturulacak.');
    }
  }

  // 3. Online Oyuncuları ID ve Player Number ile Doğrulayıp Güncelle
  let updatedCount = 0;
  let newCount = 0;

  onlinePlayers.forEach(freshPlayer => {
    const primaryKey = freshPlayer.id || ('num_' + freshPlayer.player_number) || freshPlayer.username;

    // ID ile eşleşme var mı kontrol et
    let existingPlayer = masterPlayersMap.get(primaryKey);

    // ID yoksa Player Number ile kontrol et
    if (!existingPlayer && freshPlayer.player_number) {
      for (const [k, p] of masterPlayersMap.entries()) {
        if (p.player_number && p.player_number === freshPlayer.player_number) {
          existingPlayer = p;
          break;
        }
      }
    }

    // Player Number da yoksa Kullanıcı Adı ile kontrol et
    if (!existingPlayer && freshPlayer.username) {
      for (const [k, p] of masterPlayersMap.entries()) {
        if (p.username && p.username.toLowerCase() === freshPlayer.username.toLowerCase()) {
          existingPlayer = p;
          break;
        }
      }
    }

    if (existingPlayer) {
      // ✅ OYUNCU ZATEN VAR: Tüm değişen verilerini (XP, Level, Rol, Ülke, Avatar, Son Aktiflik) YENİSİYLE DEĞİŞTİR
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
      // ➕ YENİ OYUNCU: Listeye ekle
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

  // 4. Tüm Oyuncuları En Yüksek XP'ye Göre Sırala ve Kaydet
  const allPlayersList = Array.from(masterPlayersMap.values());
  allPlayersList.sort((a, b) => (b.xp || 0) - (a.xp || 0));

  fs.writeFileSync('data/all_players.json', JSON.stringify(allPlayersList, null, 2), 'utf8');
  fs.writeFileSync('data/online_players.json', JSON.stringify(onlinePlayers, null, 2), 'utf8');

  // 5. Eyalet ve Ülkeleri Kaydet
  if (liveProvincesData && liveProvincesData.provinces) {
    fs.writeFileSync('data/provinces.json', JSON.stringify(liveProvincesData.provinces, null, 2), 'utf8');
  }
  if (liveCountriesData) {
    const cList = Array.isArray(liveCountriesData) ? liveCountriesData : (liveCountriesData.countries || []);
    fs.writeFileSync('data/countries.json', JSON.stringify(cList, null, 2), 'utf8');
  }

  console.log(`Eşitleme Tamamlandı!`);
  console.log(`- Güncellenen Oyuncu Sayısı: ${updatedCount}`);
  console.log(`- Yeni Eklenen Oyuncu Sayısı: ${newCount}`);
  console.log(`- Toplam Oyuncu Havuzu: ${allPlayersList.length}`);
}

run();
