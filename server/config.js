'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Basit .env okuyucu (ek bağımlılık gerektirmez)
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
}

if (!process.env.TZ) process.env.TZ = 'Europe/Istanbul';

module.exports = {
  ROOT,
  port: Number(process.env.PORT) || 3000,
  dbClient: (process.env.DB_CLIENT || 'sqlite').toLowerCase(),
  sqliteFile: path.resolve(ROOT, process.env.SQLITE_FILE || './data/manav.db'),
  mysql: {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'yns_tarim',
  },
  appSecret: process.env.APP_SECRET || '',
  uploadsDir: path.join(ROOT, 'uploads'),
  publicDir: path.join(ROOT, 'public'),
  fontsDir: path.join(ROOT, 'fonts'),
};
