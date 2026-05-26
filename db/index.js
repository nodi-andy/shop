const fs = require('fs');
const path = require('path');
const DIR = __dirname;

function get(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DIR, `${name}.json`), 'utf8'));
  } catch {
    return [];
  }
}

function set(name, data) {
  fs.writeFileSync(path.join(DIR, `${name}.json`), JSON.stringify(data, null, 2));
}

function uid(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

module.exports = { get, set, uid };
