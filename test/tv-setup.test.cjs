const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');

function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'airplane-tv-setup-'));
 const app=path.join(root,'app'),home=path.join(root,'setup'),work=path.join(root,'work'),staged=path.join(root,'staged'),mounted=path.join(root,'mounted'),live=path.join(root,'main.qml');
 fs.mkdirSync(app);fs.mkdirSync(work);fs.mkdirSync(path.join(app,'assets'));
 fs.writeFileSync(staged,'starfield');fs.writeFileSync(mounted,'starfield');fs.writeFileSync(live,'original starfield');
 let source=fs.readFileSync('native/setup.js','utf8').replaceAll('/var/lib/airplane-screensaver-setup',home).replaceAll('/var/lib/airplane-screensaver',work).replaceAll('/var/lib/tvweb/screensaver/.tvweb-screensaver',staged).replaceAll('/usr/palm/applications/com.webos.app.screensaver/.tvweb-screensaver',mounted).replaceAll('/var/lib/tvweb/screensaver/qml/main.qml',live).replaceAll('/var/lib/tvweb/radar-compat/boot-enabled',path.join(root,'legacy-enabled')).replaceAll('/usr/bin/node',process.execPath);
 fs.writeFileSync(path.join(app,'setup.js'),source);
 for(const name of ['backend.js','map-render.js','radar.qml','boot.js','assets.js','legacy-guard.js','core.js'])fs.writeFileSync(path.join(app,name),'fixture');
 fs.writeFileSync(path.join(app,'assets','aircraft.png'),'fixture');
 fs.writeFileSync(path.join(app,'map-create.js'),`var fs=require('fs'),path=require('path');exports.create=function(c,d,p,done){p(1,1);fs.writeFileSync(path.join(d,'map.json'),'{}');fs.writeFileSync(path.join(d,'map-native.json'),'{}');done(null);};`);
 fs.writeFileSync(path.join(app,'install.js'),`var fs=require('fs'),path=require('path');fs.writeFileSync(${JSON.stringify(path.join(work,'config.json'))},fs.readFileSync(path.join(__dirname,'config.json')));console.log(JSON.stringify({ok:true}));`);
 function call(action,arg){const args=[path.join(app,'setup.js'),action];if(arg!==undefined)args.push(Buffer.from(JSON.stringify(arg)).toString('base64'));const r=cp.spawnSync(process.execPath,args,{encoding:'utf8',timeout:5000});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout.trim());}
 return {root,home,work,live,staged,call};
}
function waitForCompletion(f){return new Promise((resolve,reject)=>{const end=Date.now()+5000;(function poll(){const s=f.call('status');if(!s.running)return s.ok?resolve(s):reject(new Error(s.error));if(Date.now()>end)return reject(new Error('Setup timed out'));setTimeout(poll,30);})();});}

test('TV settings build a map and activate with the chosen city',async()=>{
 const f=fixture();try{
  const settings={location:{name:'Tokyo',latitude:35.6895,longitude:139.6917},radiusKm:7,language:'en',units:'aviation',theme:'noir'};
  assert.deepEqual(f.call('start',settings),{ok:true});
  assert.equal((await waitForCompletion(f)).phase,'complete');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.work,'config.json'),'utf8')),settings);
  assert.equal(f.call('info').config.location.name,'Tokyo');
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('TV setup rejects invalid coordinates and an unselected Glasshouse screensaver before building',()=>{
 const f=fixture();try{
  const settings={location:{name:'City',latitude:null,longitude:0},radiusKm:5,language:'en',units:'metric'};
  assert.match(f.call('start',settings).error,/Invalid location/);
  settings.location.latitude=0;settings.theme='unknown';assert.match(f.call('start',settings).error,/Invalid theme/);delete settings.theme;fs.writeFileSync(f.staged,'clock');
  assert.match(f.call('start',settings).error,/Select Glasshouse Starfield/);
  assert.equal(fs.existsSync(path.join(f.work,'config.json')),false);
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});


test('TV setup accepts older settings without a theme and stores the classic fallback',async()=>{
 const f=fixture();try{
  const old={location:{name:'Tokyo',latitude:35.6895,longitude:139.6917},radiusKm:5,language:'en',units:'metric'};
  assert.deepEqual(f.call('start',old),{ok:true});
  await waitForCompletion(f);
  assert.equal(f.call('info').config.theme,'classic');
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
