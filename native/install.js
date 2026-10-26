// Run as root on a Glasshouse-enabled webOS TV; no launcher dependency.
var fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto'),http=require('http');
var action=process.argv[2],source=__dirname,target='/var/lib/tvweb/screensaver/qml',work='/var/lib/airplane-screensaver';
var live=path.join(target,'main.qml'),backup=path.join(work,'previous-main.qml'),marker='AIRPLANE_SCREENSAVER_NATIVE';
var lock=path.join(work,'ownership-lock');
function hash(p){return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');}
function atomic(p,data,mode){var tmp=p+'.airplane-new';fs.writeFileSync(tmp,data,{mode:mode||parseInt('600',8)});fs.renameSync(tmp,p);}
function copy(a,b,mode){atomic(b,fs.readFileSync(a),mode);}
function stop(){try{var pid=parseInt(fs.readFileSync(path.join(work,'backend.pid'),'utf8'),10),cmd=fs.readFileSync('/proc/'+pid+'/cmdline','utf8').split('\u0000');if(cmd.indexOf(path.join(work,'backend.js'))>=0)process.kill(pid);}catch(e){}}
function boot(){return require(path.join(work,'boot.js'));}
function fail(message){console.error('Installation failed: '+message);process.exitCode=1;}
function closeSaver(result){
 cp.execFile('luna-send',['-n','1','luna://com.webos.applicationManager/closeByAppId','{"id":"com.webos.app.screensaver"}'],{timeout:5000},function(err){result.closeRequested=!err;console.log(JSON.stringify(result));});
}
function checkHelper(child,done){
 var attempts=0,settled=false,launchError=null;
 child.on('error',function(err){launchError=err;});
 child.on('exit',function(){launchError=new Error('Data helper exited');});
 function finish(error){if(settled)return;settled=true;done(error);}
 function next(){
  if(launchError)return finish(launchError);
  if(++attempts>15)return finish(new Error('Data helper did not become ready on 127.0.0.1:8895'));
  var req,ended=false,timer=setTimeout(function(){finishAttempt(false);if(req)req.abort();},500);
  function finishAttempt(ok){if(ended||settled)return;ended=true;clearTimeout(timer);if(ok)return finish(null);setTimeout(next,250);}
  try{
   req=http.get({hostname:'127.0.0.1',port:8895,path:'/status'},function(res){var body='';res.on('data',function(chunk){body+=chunk;if(body.length>65536)finishAttempt(false);});res.on('end',function(){try{var status=JSON.parse(body);finishAttempt(res.statusCode===200&&status.ok===true&&status.service==='airplane-screensaver'&&status.pid===child.pid);}catch(e){finishAttempt(false);}});res.on('error',function(){finishAttempt(false);});});
   req.on('error',function(){finishAttempt(false);});
  }catch(e){finishAttempt(false);}
 }
 next();
}
try{
 if(['install','restore','status'].indexOf(action)<0)throw new Error('Usage: node install.js install|restore|status');
 if(action==='status'){if(!fs.existsSync(work))throw new Error('Not installed');console.log(JSON.stringify(boot().status()));return;}
 if(action==='restore'){
  if(!fs.existsSync(backup))throw new Error('No original backup exists');
  if(hash(live)!==hash(backup)&&fs.readFileSync(live,'utf8').indexOf(marker)<0)throw new Error('Screensaver changed; refusing to overwrite');
  boot().disable();copy(backup,live,parseInt('644',8));stop();
  require(path.join(work,'legacy-guard.js')).remove();try{fs.unlinkSync(lock);}catch(e){if(e.code!=='ENOENT')throw e;}
  closeSaver({ok:true,action:action});return;
 }
 if(!fs.existsSync('/var/lib/tvweb/screensaver/.tvweb-screensaver')||fs.readFileSync('/var/lib/tvweb/screensaver/.tvweb-screensaver','utf8').trim()!=='starfield')throw new Error('Select Glasshouse Starfield first');
 if(!fs.existsSync(live))throw new Error('Glasshouse screensaver is not staged');
 if(!fs.existsSync('/usr/palm/applications/com.webos.app.screensaver/.tvweb-screensaver')||fs.readFileSync('/usr/palm/applications/com.webos.app.screensaver/.tvweb-screensaver','utf8').trim()!=='starfield')throw new Error('Glasshouse Starfield mount is not active');
 var current=fs.readFileSync(live,'utf8');
 if(current.indexOf('TV_CLEAN_RADAR_PROTOTYPE')>=0)throw new Error('Another radar installation is active; restore it first');
 var files=['backend.js','map.json','map-native.json','config.json','radar.qml','core.js','map-render.js','boot.js','assets.js','legacy-guard.js','install.js'];
 files.forEach(function(n){if(!fs.existsSync(path.join(source,n)))throw new Error('Missing payload file: '+n);});
 ['aircraft.png','BarlowCondensed-Bold.ttf','BarlowCondensed-SemiBold.ttf','IBMPlexMono-Regular.ttf'].forEach(function(n){if(!fs.existsSync(path.join(source,'assets',n)))throw new Error('Missing display asset: '+n);});
 var hook='/var/lib/webosbrew/init.d/55-airplane-screensaver';
 if(fs.existsSync(hook)&&fs.readFileSync(hook,'utf8').indexOf('AIRPLANE_SCREENSAVER_BOOT:')<0)throw new Error('Boot hook belongs to another installation');
 if(fs.existsSync('/var/lib/tvweb/radar-compat/boot-enabled'))throw new Error('Older radar persistence is active; restore it before installing');
 var legacy=require(path.join(source,'legacy-guard.js'));legacy.inspect();
 var display=path.join(target,'airplane-assets');
 if(fs.existsSync(display)&&!fs.existsSync(path.join(display,'.airplane-screensaver')))throw new Error('Display assets directory belongs to another installation');
 if(!fs.existsSync(work))fs.mkdirSync(work,parseInt('700',8));
 if(!fs.existsSync(backup)){if(current.indexOf(marker)>=0)throw new Error('Original backup missing');copy(live,backup);}
 if(hash(live)!==hash(backup)&&current.indexOf(marker)<0)throw new Error('Unrecognised screensaver; refusing to overwrite');
 files.forEach(function(n){copy(path.join(source,n),path.join(work,n));});
 var assets=path.join(work,'assets');if(!fs.existsSync(assets))fs.mkdirSync(assets,parseInt('755',8));
 fs.readdirSync(path.join(source,'assets')).forEach(function(n){var f=path.join(source,'assets',n);if(fs.statSync(f).isFile())copy(f,path.join(assets,n),parseInt('644',8));});
 stop();var fd=fs.openSync(path.join(work,'backend.log'),'a',parseInt('600',8));
 var child=cp.spawn('/usr/bin/node',[path.join(work,'backend.js')],{detached:true,stdio:['ignore',fd,fd]});child.unref();fs.closeSync(fd);
 if(!child.pid)throw new Error('Data helper did not start');
 atomic(path.join(work,'backend.pid'),String(child.pid));
 checkHelper(child,function(err){
  if(err){try{child.kill();}catch(e){}return fail(err.message);}
  var alreadyOwned=fs.existsSync(lock);
  try{
   atomic(lock,'airplane-screensaver\n');legacy.install();
   require(path.join(work,'assets.js')).install(work,target);
   ['core.js','map-render.js'].forEach(function(n){copy(path.join(work,n),path.join(target,n),parseInt('644',8));});
   copy(path.join(work,'radar.qml'),live,parseInt('644',8));
   try{boot().enable(work);}catch(e){atomic(live,current,parseInt('644',8));throw e;}
   closeSaver({ok:true,action:action,helperReady:true,radarApplied:true,visibleVerified:false});
  }catch(e){
   if(!alreadyOwned){try{legacy.remove();fs.unlinkSync(lock);}catch(cleanupError){}}
   fail(e.message);
  }
 });
}catch(e){fail(e.message);}
