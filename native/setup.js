// Invoked only by the TV app through Homebrew Channel's root service.
// The long-running map build is detached so the app can show progress.
var fs=require('fs'),path=require('path'),cp=require('child_process');
var home='/var/lib/airplane-screensaver-setup',work='/var/lib/airplane-screensaver';
var statusFile=path.join(home,'status.json'),action=process.argv[2];
function read(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){return fallback;}}
function output(value){console.log(JSON.stringify(value));}
function mkdir(dir){if(!fs.existsSync(dir))fs.mkdirSync(dir,parseInt('700',8));}
function atomic(file,data){var tmp=file+'.new';fs.writeFileSync(tmp,JSON.stringify(data),{mode:parseInt('600',8)});fs.renameSync(tmp,file);}
function status(value){value.updated=Date.now();if(value.running)value.pid=process.pid;atomic(statusFile,value);}
function alive(pid){try{process.kill(pid,0);return true;}catch(e){return false;}}
function decode(value){return JSON.parse(new Buffer(String(value||''),'base64').toString('utf8'));}
function validate(input){
 var p=input&&input.location||{},lat=Number(p.latitude),lon=Number(p.longitude),radius=Number(input&&input.radiusKm);
 if(typeof p.name!=='string'||!p.name.trim()||p.name.length>100||typeof p.latitude!=='number'||typeof p.longitude!=='number'||!isFinite(lat)||Math.abs(lat)>85||!isFinite(lon)||Math.abs(lon)>180||!isFinite(radius)||radius<1||radius>50)throw new Error('Invalid location or radius');
 if(input.language!=='pt'&&input.language!=='en')throw new Error('Invalid language');
 if(input.units!=='metric'&&input.units!=='aviation')throw new Error('Invalid units');
 var theme=input.theme===undefined?'classic':input.theme;
 if(['classic','coast','lavender','sage','evangelion','noir'].indexOf(theme)<0)throw new Error('Invalid theme');
 return {location:{name:p.name.trim().slice(0,40),latitude:lat,longitude:lon},radiusKm:radius,language:input.language,units:input.units,theme:theme};
}
function preflight(){
 var staged='/var/lib/tvweb/screensaver/.tvweb-screensaver',mounted='/usr/palm/applications/com.webos.app.screensaver/.tvweb-screensaver';
 var live='/var/lib/tvweb/screensaver/qml/main.qml';
 if(!fs.existsSync(staged)||fs.readFileSync(staged,'utf8').trim()!=='starfield'||!fs.existsSync(mounted)||fs.readFileSync(mounted,'utf8').trim()!=='starfield'||!fs.existsSync(live))throw new Error('Select Glasshouse Starfield first');
 if(fs.readFileSync(live,'utf8').indexOf('TV_CLEAN_RADAR_PROTOTYPE')>=0||fs.existsSync('/var/lib/tvweb/radar-compat/boot-enabled'))throw new Error('Restore the older radar before activating this screensaver');
}
function removeTree(dir){
 if(!fs.existsSync(dir))return;
 fs.readdirSync(dir).forEach(function(n){var p=path.join(dir,n);if(fs.statSync(p).isDirectory())removeTree(p);else fs.unlinkSync(p);});fs.rmdirSync(dir);
}
function copy(src,dst){fs.writeFileSync(dst,fs.readFileSync(src),{mode:parseInt('600',8)});}
function search(input,done){
 var name=String(input.name||'').trim(),language=input.language==='pt'?'pt':'en';
 if(name.length<2||name.length>100)return done(new Error('Enter at least two characters'));
 var url='https://geocoding-api.open-meteo.com/v1/search?name='+encodeURIComponent(name)+'&count=10&language='+language+'&format=json';
 var args=['-4','--fail','--silent','--show-error','--location','--max-redirs','3','--proto','=https','--proto-redir','=https','--connect-timeout','5','--max-time','15','--max-filesize','200000',url];
 function run(family){args[0]=family;cp.execFile('curl',args,{timeout:18000,maxBuffer:250000},function(err,body){
  if(err&&family==='-4'&&!err.killed&&(err.code===6||err.code===7||err.code===28))return run('-6');
  if(err)return done(new Error('City search is unavailable'));
  try{
   var results=(JSON.parse(body).results||[]).filter(function(r){return r&&typeof r.name==='string'&&typeof r.latitude==='number'&&isFinite(r.latitude)&&Math.abs(r.latitude)<=85&&typeof r.longitude==='number'&&isFinite(r.longitude)&&Math.abs(r.longitude)<=180;}).map(function(r){
    return {name:r.name.slice(0,40),region:String(r.admin1||'').slice(0,60),country:String(r.country||'').slice(0,60),latitude:r.latitude,longitude:r.longitude};
   });done(null,results);
  }catch(e){done(new Error('Invalid city search response'));}
 });}
 run('-4');
}
function apply(config){
 var stage=path.join(home,'stage-'+process.pid);
 function fail(e){try{status({ok:false,running:false,error:String(e.message||e)});}catch(ignore){}try{removeTree(stage);}catch(ignore2){}}
 try{
  mkdir(home);mkdir(stage);mkdir(path.join(stage,'assets'));
  ['backend.js','map-render.js','radar.qml','install.js','boot.js','assets.js','legacy-guard.js','core.js'].forEach(function(n){copy(path.join(__dirname,n),path.join(stage,n));});
  fs.readdirSync(path.join(__dirname,'assets')).forEach(function(n){var f=path.join(__dirname,'assets',n);if(fs.statSync(f).isFile())copy(f,path.join(stage,'assets',n));});
  atomic(path.join(stage,'config.json'),config);
  status({ok:true,running:true,phase:'map',completed:0,total:0});
  require('./map-create.js').create(config,stage,function(completed,total){status({ok:true,running:true,phase:'map',completed:completed,total:total});},function(err){
   if(err)return fail(err);
   status({ok:true,running:true,phase:'install'});
   cp.execFile('/usr/bin/node',[path.join(stage,'install.js'),'install'],{timeout:45000,maxBuffer:500000},function(error,stdout,stderr){
    if(error)return fail(new Error(String(stderr||error.message).trim().slice(0,400)));
    var result;try{result=JSON.parse(String(stdout).trim().split('\n').pop());}catch(e){return fail(new Error('Installer did not confirm completion'));}
    if(!result.ok)return fail(new Error('Installer did not confirm completion'));
    status({ok:true,running:false,phase:'complete'});try{removeTree(stage);}catch(ignore){}
   });
  });
 }catch(e){fail(e);}
}
try{
 if(action==='info')return output({ok:true,config:read(path.join(work,'config.json'),null),installed:fs.existsSync(path.join(work,'boot-enabled'))});
 if(action==='status'){
  var s=read(statusFile,{ok:true,running:false,phase:'idle'});
  if(s.running&&s.pid&&!alive(s.pid))s={ok:false,running:false,error:'Setup stopped unexpectedly'};
  return output(s);
 }
 if(action==='search')return search(decode(process.argv[3]),function(e,results){output(e?{ok:false,error:e.message}:{ok:true,results:results});});
 if(action==='start'){
  mkdir(home);var previous=read(statusFile,null);
  if(previous&&previous.running&&previous.pid&&alive(previous.pid))return output({ok:false,error:'Setup already running'});
  var config=validate(decode(process.argv[3]));preflight();
  var child=cp.spawn('/usr/bin/node',[__filename,'apply',new Buffer(JSON.stringify(config),'utf8').toString('base64')],{detached:true,stdio:'ignore'});
  child.unref();atomic(statusFile,{ok:true,running:true,phase:'starting',pid:child.pid,updated:Date.now()});return output({ok:true});
 }
 if(action==='apply')return apply(validate(decode(process.argv[3])));
 if(action==='restore')return cp.execFile('/usr/bin/node',[path.join(work,'install.js'),'restore'],{timeout:15000,maxBuffer:500000},function(e,out,err){
  if(e)return output({ok:false,error:String(err||e.message).trim().slice(0,400)});
  try{var r=JSON.parse(String(out).trim().split('\n').pop());output(r);}catch(parseError){output({ok:false,error:'Could not confirm restore'});}
 });
 throw new Error('Unsupported setup action');
}catch(e){output({ok:false,error:String(e.message||e)});}
