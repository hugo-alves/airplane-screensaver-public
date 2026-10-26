const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'airplane-install-test-'));
 const stage=path.join(root,'payload'), work=path.join(root,'work'), target=path.join(root,'tvweb/screensaver/qml');
 fs.mkdirSync(stage,{recursive:true});fs.mkdirSync(target,{recursive:true});fs.mkdirSync(path.join(root,'mount'),{recursive:true});fs.mkdirSync(path.join(root,'init'),{recursive:true});
 const original='original starfield';fs.writeFileSync(path.join(target,'main.qml'),original);fs.writeFileSync(path.join(root,'tvweb/screensaver/.tvweb-screensaver'),'starfield');fs.writeFileSync(path.join(root,'mount/.tvweb-screensaver'),'starfield');
 function rewrite(s){return s.replaceAll('/var/lib/tvweb/screensaver/qml',target).replaceAll('/var/lib/tvweb/screensaver/.tvweb-screensaver',path.join(root,'tvweb/screensaver/.tvweb-screensaver')).replaceAll('/usr/palm/applications/com.webos.app.screensaver/.tvweb-screensaver',path.join(root,'mount/.tvweb-screensaver')).replaceAll('/var/lib/webosbrew/init.d/55-airplane-screensaver',path.join(root,'init/55-airplane-screensaver')).replaceAll('/var/lib/airplane-screensaver',work).replaceAll('/media/developer/apps/usr/palm/applications/org.webosbrew.lounge.launcher/assets/glasshouse-compat/install.js',path.join(root,'legacy/install.js')).replaceAll('/var/lib/tvweb/radar-compat/boot-enabled',path.join(root,'legacy/boot-enabled'));}
 for(const name of ['install.js','boot.js','assets.js','legacy-guard.js'])fs.writeFileSync(path.join(stage,name),rewrite(fs.readFileSync(path.join('native',name),'utf8')));
 for(const name of ['backend.js','map.json','map-native.json','config.json','core.js','map-render.js'])fs.writeFileSync(path.join(stage,name),'{}');
 fs.writeFileSync(path.join(stage,'radar.qml'),'// AIRPLANE_SCREENSAVER_NATIVE');fs.mkdirSync(path.join(stage,'assets'));
 for(const name of ['aircraft.png','BarlowCondensed-Bold.ttf','BarlowCondensed-SemiBold.ttf','IBMPlexMono-Regular.ttf'])fs.writeFileSync(path.join(stage,'assets',name),'asset');
 const preload=path.join(root,'preload.cjs');fs.writeFileSync(preload,`
 const cp=require('node:child_process'),http=require('node:http'),{EventEmitter}=require('node:events');
 cp.spawn=()=>({pid:999999,unref(){},on(){},kill(){}});
 cp.execFile=(a,b,c,d)=>{let cb=typeof c==='function'?c:d; if(cb)cb(null,'');};
 http.get=(options,cb)=>{const req=new EventEmitter();req.abort=()=>{};process.nextTick(()=>{const res=new EventEmitter();res.statusCode=200;cb(res);process.nextTick(()=>{res.emit('data',JSON.stringify({ok:true,service:'airplane-screensaver',pid:process.env.FAKE_WRONG_PID?999998:999999}));res.emit('end');});});return req;};`);
 function run(action,extra={}){return cp.spawnSync(process.execPath,['--require',preload,path.join(stage,'install.js'),action],{encoding:'utf8',env:{...process.env,...extra}});}
 function runBoot(){return cp.spawnSync(process.execPath,['--require',preload,path.join(work,'boot.js'),'boot'],{encoding:'utf8'});}
 return {root,stage,work,target,original,run,runBoot};
}
test('install and restore retain original and expose only public display assets',()=>{
 const f=fixture();try{
  let result=f.run('install');assert.equal(result.status,0,result.stderr);assert.equal(fs.readFileSync(path.join(f.work,'previous-main.qml'),'utf8'),f.original);assert.match(fs.readFileSync(path.join(f.target,'main.qml'),'utf8'),/AIRPLANE_SCREENSAVER_NATIVE/);assert.ok(fs.existsSync(path.join(f.root,'init/55-airplane-screensaver')));
  const asset=path.join(f.target,'airplane-assets/aircraft.png');assert.ok(fs.existsSync(asset));assert.equal(fs.statSync(asset).mode & 0o777,0o644);assert.equal(fs.existsSync(path.join(f.target,'airplane-assets/config.json')),false);
  assert.ok(fs.existsSync(path.join(f.work,'install.js')));
  // Simulate Glasshouse restaging Starfield and removing copied assets on restart.
  fs.writeFileSync(path.join(f.target,'main.qml'),f.original);fs.rmSync(path.join(f.target,'airplane-assets'),{recursive:true});
  result=f.runBoot();assert.equal(result.status,0,result.stderr);assert.match(fs.readFileSync(path.join(f.target,'main.qml'),'utf8'),/AIRPLANE_SCREENSAVER_NATIVE/);assert.ok(fs.existsSync(path.join(f.target,'airplane-assets/aircraft.png')));
  result=f.run('restore');assert.equal(result.status,0,result.stderr);assert.equal(fs.readFileSync(path.join(f.target,'main.qml'),'utf8'),f.original);assert.equal(fs.existsSync(path.join(f.root,'init/55-airplane-screensaver')),false);
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('refuses to activate if the helper is not the process just started',()=>{
 const f=fixture();try{
  const result=f.run('install',{FAKE_WRONG_PID:'1'});assert.notEqual(result.status,0);assert.match(result.stderr,/did not become ready/);assert.equal(fs.readFileSync(path.join(f.target,'main.qml'),'utf8'),f.original);assert.equal(fs.existsSync(path.join(f.root,'init/55-airplane-screensaver')),false);
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('does not overwrite another installation assets',()=>{
 const f=fixture();try{fs.mkdirSync(path.join(f.target,'airplane-assets'));const result=f.run('install');assert.notEqual(result.status,0);assert.match(result.stderr,/belongs to another installation/);assert.equal(fs.readFileSync(path.join(f.target,'main.qml'),'utf8'),f.original);}finally{fs.rmSync(f.root,{recursive:true,force:true});}
});

test('legacy launcher cannot reclaim the independent screensaver and its script is restored',()=>{
 const f=fixture();try{
  const legacy=path.join(f.root,'legacy');fs.mkdirSync(legacy);
  const file=path.join(legacy,'install.js');
  const original="var fs=require('fs');\nvar action=process.argv[2],source=__dirname;\ntry{\n if(['prepare','persist','restore'].indexOf(action)<0)throw new Error('Unsupported');\n fs.writeFileSync(source+'/last-action',action);\n}catch(e){console.error(e.message);process.exitCode=1;}\n";
  fs.writeFileSync(file,original);
  let result=f.run('install');assert.equal(result.status,0,result.stderr);
  result=cp.spawnSync(process.execPath,[file,'persist'],{encoding:'utf8'});assert.notEqual(result.status,0);assert.match(result.stderr,/Independent airplane screensaver is active/);assert.equal(fs.existsSync(path.join(legacy,'last-action')),false);
  // Even if Glasshouse has restaged Starfield, the old launch action cannot seize it.
  fs.writeFileSync(path.join(f.target,'main.qml'),f.original);
  result=cp.spawnSync(process.execPath,[file,'persist'],{encoding:'utf8'});assert.notEqual(result.status,0);assert.equal(fs.readFileSync(path.join(f.target,'main.qml'),'utf8'),f.original);
  result=f.runBoot();assert.equal(result.status,0,result.stderr);assert.match(fs.readFileSync(path.join(f.target,'main.qml'),'utf8'),/AIRPLANE_SCREENSAVER_NATIVE/);
  result=f.run('restore');assert.equal(result.status,0,result.stderr);assert.equal(fs.readFileSync(file,'utf8'),original);
  result=cp.spawnSync(process.execPath,[file,'persist'],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.equal(fs.readFileSync(path.join(legacy,'last-action'),'utf8'),'persist');
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('refuses unknown legacy installer without changing it',()=>{
 const f=fixture();try{const legacy=path.join(f.root,'legacy');fs.mkdirSync(legacy);const file=path.join(legacy,'install.js');fs.writeFileSync(file,'other installer');const result=f.run('install');assert.notEqual(result.status,0);assert.match(result.stderr,/Unrecognised older radar installer/);assert.equal(fs.readFileSync(file,'utf8'),'other installer');assert.equal(fs.readFileSync(path.join(f.target,'main.qml'),'utf8'),f.original);}finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
