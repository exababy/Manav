'use strict';
const crypto = require('crypto');
const { hashPin } = require('../lib/auth');
const { nowStr } = require('../lib/util');
const settings = require('../lib/settings');
const config = require('../config');

/** İlk çalıştırmada varsayılan kullanıcı, PEŞİN carisi ve oturum anahtarı oluşturur. */
async function seed(db) {
  const u = await db.get('SELECT COUNT(*) AS c FROM users');
  if (!Number(u.c)) {
    await db.run('INSERT INTO users (name, pin_hash, role, active, created_at) VALUES (?, ?, ?, 1, ?)', [
      'Yönetici', hashPin('1234'), 'admin', nowStr(),
    ]);
    console.log('» Varsayılan kullanıcı oluşturuldu. Giriş şifresi: 1234 (Ayarlar > Kullanıcılar bölümünden değiştirin)');
  }

  const c = await db.get('SELECT COUNT(*) AS c FROM customers');
  if (!Number(c.c)) {
    await db.run('INSERT INTO customers (name, opening_balance, active, created_at) VALUES (?, 0, 1, ?)', ['PEŞİN', nowStr()]);
  }

  let secret = config.appSecret;
  if (!secret) {
    const row = await db.get("SELECT svalue FROM settings WHERE skey = 'app_secret'");
    secret = row && row.svalue;
    if (!secret) {
      secret = crypto.randomBytes(32).toString('hex');
      await settings.set(db, 'app_secret', secret);
    }
  }
  return { secret };
}

module.exports = { seed };
