'use strict';

// Encrypt/decrypt sensitive values using Electron safeStorage (Windows DPAPI).
// Values are stored as "enc:<base64>" in the database.
// Falls back to plaintext if safeStorage is unavailable (dev/non-Electron context).

function getSafeStorage() {
  try {
    const { safeStorage } = require('electron');
    return safeStorage;
  } catch {
    return null;
  }
}

function encryptValue(plaintext) {
  if (!plaintext) return '';
  const ss = getSafeStorage();
  if (!ss || !ss.isEncryptionAvailable()) return plaintext;
  return 'enc:' + ss.encryptString(plaintext).toString('base64');
}

function decryptValue(stored) {
  if (!stored) return '';
  if (!stored.startsWith('enc:')) return stored; // old plaintext value — return as-is
  const ss = getSafeStorage();
  if (!ss || !ss.isEncryptionAvailable()) return '';
  try {
    return ss.decryptString(Buffer.from(stored.slice(4), 'base64'));
  } catch {
    return ''; // key mismatch or corrupted — treat as unset
  }
}

module.exports = { encryptValue, decryptValue };
