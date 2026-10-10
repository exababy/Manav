'use strict';
/**
 * Küçük veritabanı katmanı: SQLite (better-sqlite3) veya MySQL (mysql2).
 * Tüm sorgular "?" yer tutucusu kullanır, iki motorda da aynı SQL çalışır.
 *
 *   db.all(sql, params)  -> satır dizisi
 *   db.get(sql, params)  -> tek satır | undefined
 *   db.run(sql, params)  -> { id, changes }
 *   db.tx(async (t) => { ... })  -> işlem (transaction); t aynı API'ye sahip
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { schema } = require('./schema');

function createSqlite() {
  const Database = require('better-sqlite3');
  fs.mkdirSync(path.dirname(config.sqliteFile), { recursive: true });
  const conn = new Database(config.sqliteFile);
  conn.pragma('journal_mode = WAL');
  conn.pragma('foreign_keys = ON');

  const api = {
    dialect: 'sqlite',
    async all(sql, params = []) { return conn.prepare(sql).all(...params); },
    async get(sql, params = []) { return conn.prepare(sql).get(...params); },
    async run(sql, params = []) {
      const r = conn.prepare(sql).run(...params);
      return { id: Number(r.lastInsertRowid), changes: r.changes };
    },
    async exec(sql) { conn.exec(sql); },
  };

  // better-sqlite3 eşzamanlı çalışır; işlemleri sıraya alarak iç içe geçmeyi önleriz.
  let queue = Promise.resolve();
  api.tx = (fn) => {
    const job = queue.then(async () => {
      conn.exec('BEGIN IMMEDIATE');
      try {
        const out = await fn(api);
        conn.exec('COMMIT');
        return out;
      } catch (e) {
        conn.exec('ROLLBACK');
        throw e;
      }
    });
    queue = job.catch(() => {});
    return job;
  };
  api.close = async () => conn.close();
  return api;
}

function createMysql() {
  const mysql = require('mysql2/promise');
  const pool = mysql.createPool({
    ...config.mysql,
    waitForConnections: true,
    connectionLimit: 10,
    decimalNumbers: true,
    dateStrings: true,
    charset: 'utf8mb4',
    multipleStatements: true,
  });

  const wrap = (q) => ({
    dialect: 'mysql',
    async all(sql, params = []) { const [rows] = await q.query(sql, params); return rows; },
    async get(sql, params = []) { const [rows] = await q.query(sql, params); return rows[0]; },
    async run(sql, params = []) {
      const [r] = await q.query(sql, params);
      return { id: r.insertId, changes: r.affectedRows };
    },
    async exec(sql) { await q.query(sql); },
  });

  const api = wrap(pool);
  api.tx = async (fn) => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const out = await fn(wrap(conn));
      await conn.commit();
      return out;
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  };
  api.close = async () => pool.end();
  return api;
}

async function createDb() {
  if (config.dbClient === 'mysql') {
    // Veritabanı yoksa oluştur
    const mysql = require('mysql2/promise');
    const { database, ...rest } = config.mysql;
    const c = await mysql.createConnection(rest);
    await c.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_turkish_ci`);
    await c.end();
  }
  const db = config.dbClient === 'mysql' ? createMysql() : createSqlite();
  for (const stmt of schema(db.dialect)) await db.exec(stmt);
  return db;
}

module.exports = { createDb };
