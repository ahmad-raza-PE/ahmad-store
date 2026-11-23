'use strict';
/* Consistent backup of the database + private files + images into ./backups/<timestamp>/.
   Safe to run while the shop is running.   Usage: npm run backup */
const fs = require('fs');
const path = require('path');
const cfg = require('../lib/config');
const { DatabaseSync } = require('node:sqlite');

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = path.join(cfg.ROOT, 'backups', stamp);
fs.mkdirSync(out, { recursive: true });
const db = new DatabaseSync(path.join(cfg.DATA_DIR, 'store.sqlite'));
db.exec(`VACUUM INTO '${path.join(out, 'store.sqlite').replace(/'/g, "''")}'`);
db.close();
for (const d of ['private', 'uploads']) fs.cpSync(path.join(cfg.DATA_DIR, d), path.join(out, d), { recursive: true });
console.log(`Backup written to ${out}\nCopy this folder somewhere safe (another machine or cloud storage).`);
