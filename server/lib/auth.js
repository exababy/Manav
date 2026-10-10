'use strict';
const crypto = require('crypto');
const { HttpError } = require('./util');

function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPin(pin, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(String(pin), salt, 32);
  const ref = Buffer.from(hash, 'hex');
  return ref.length === test.length && crypto.timingSafeEqual(ref, test);
}

const b64u = (buf) => Buffer.from(buf).toString('base64url');

function signToken(payload, secret, ttlHours = 24 * 30) {
  const body = b64u(JSON.stringify({ ...payload, exp: Date.now() + ttlHours * 3600e3 }));
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token, secret) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const expect = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch {
    return null;
  }
}

/** Kaba kuvvet koruması: IP başına 5 hatalı denemede 30 sn kilit */
const attempts = new Map();
function checkLock(ip) {
  const a = attempts.get(ip);
  if (a && a.until > Date.now()) {
    throw new HttpError(429, `Çok fazla hatalı deneme. ${Math.ceil((a.until - Date.now()) / 1000)} sn bekleyin.`);
  }
}
function registerFail(ip) {
  const a = attempts.get(ip) || { count: 0, until: 0 };
  a.count++;
  if (a.count >= 5) {
    a.until = Date.now() + 30e3;
    a.count = 0;
  }
  attempts.set(ip, a);
}
function clearFails(ip) { attempts.delete(ip); }

module.exports = { hashPin, verifyPin, signToken, verifyToken, checkLock, registerFail, clearFails };
