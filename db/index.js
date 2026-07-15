const fs = require('fs');
const path = require('path');
const DIR = __dirname;

function get(name) {
  const file = path.join(DIR, `${name}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    const seedFile = path.join(DIR, 'seed', `${name}.json`);
    try {
      const seeded = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
      fs.writeFileSync(file, JSON.stringify(seeded, null, 2));
      return seeded;
    } catch {
      return [];
    }
  }
}

function set(name, data) {
  fs.writeFileSync(path.join(DIR, `${name}.json`), JSON.stringify(data, null, 2));
}

function uid(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

module.exports = { get, set, uid };
