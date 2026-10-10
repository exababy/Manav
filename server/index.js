'use strict';
const config = require('./config');
const path = require('path');
const fs = require('fs');
const express = require('express');
const { createDb } = require('./db');
const { seed } = require('./db/seed');
const api = require('./routes/api');

async function createApp() {
  const db = await createDb();
  const { secret } = await seed(db);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(express.json({ limit: '6mb' }));

  app.use('/api', api(db, secret));

  fs.mkdirSync(config.uploadsDir, { recursive: true });
  app.use('/uploads', express.static(config.uploadsDir, { maxAge: '30d' }));
  app.use(express.static(config.publicDir, {
    setHeaders(res, file) {
      // Uygulama dosyaları her açılışta güncel gelsin (service worker önbelleği yönetir)
      if (/\.(html|js|css|webmanifest)$/.test(file)) res.set('Cache-Control', 'no-cache');
    },
  }));
  app.get(/^\/(?!api|uploads).*/, (req, res) => res.sendFile(path.join(config.publicDir, 'index.html')));

  // Hata yakalayıcı
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 && !err.status ? 'Sunucu hatası' : err.message });
  });

  return { app, db };
}

if (require.main === module) {
  createApp()
    .then(({ app }) => {
      app.listen(config.port, () => {
        console.log(`YNS TARIM çalışıyor: http://localhost:${config.port}  (veritabanı: ${config.dbClient})`);
      });
    })
    .catch((e) => {
      console.error('Başlatılamadı:', e);
      process.exit(1);
    });
}

module.exports = { createApp };
