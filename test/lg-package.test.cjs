const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('LG package includes the upstream MIT notice and map attribution',()=>{
  assert.equal(fs.readFileSync('build/lg-app/LICENSE','utf8'),fs.readFileSync('LICENSE','utf8'));
  const qml=fs.readFileSync('build/lg-app/payload/radar.qml','utf8');
  assert.match(qml,/© OpenMapTiles/);
  assert.match(qml,/© OpenStreetMap contributors/);
  assert.deepEqual(fs.readFileSync('build/lg-app/payload/assets/NotoSansJP-Header.ttf'),fs.readFileSync('assets/flights/NotoSansJP-Header.ttf'));
  assert.match(qml,/くたばれ、クソ野郎/);
  const app=JSON.parse(fs.readFileSync('build/lg-app/appinfo.json','utf8'));
  assert.equal(app.version,require('../package.json').version);
});
