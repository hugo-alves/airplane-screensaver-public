// Node 0.12 / ES5. One bounded, detached boot job; no network command endpoint.
var fs=require('fs'),path=require('path'),cp=require('child_process'),http=require('http'),crypto=require('crypto');
var work='/var/lib/airplane-screensaver',target='/var/lib/tvweb/screensaver/qml';
var hook='/var/lib/webosbrew/init.d/55-airplane-screensaver';
var enabled=path.join(work,'boot-enabled'),reportFile='/var/lib/airplane-screensaver/boot-status.json';
var hookText='#!/bin/sh\n# AIRPLANE_SCREENSAVER_BOOT: reversible, detached, bounded.\n'+
 'test -x /usr/bin/node || exit 0\n'+
 'test -f '+enabled+' || exit 0\n'+
 '( /usr/bin/node '+work+'/boot.js boot </dev/null >/dev/null 2>&1 & )\nexit 0\n';
function hash(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function atomic(file,data,mode){var temp=file+'.new';fs.writeFileSync(temp,data,{mode:mode||parseInt('600',8)});fs.renameSync(temp,file);}
function remove(file){try{fs.unlinkSync(file);}catch(e){if(e.code!=='ENOENT')throw e;}}
function ownsHook(){return fs.existsSync(hook)&&fs.readFileSync(hook,'utf8').indexOf('AIRPLANE_SCREENSAVER_BOOT:')>=0;}
function backendPid(){
 try{var pid=parseInt(fs.readFileSync(path.join(work,'backend.pid'),'utf8'),10);
  if(fs.readFileSync('/proc/'+pid+'/cmdline','utf8').split('\u0000').indexOf(path.join(work,'backend.js'))>=0)return pid;
 }catch(e){}return null;
}
function bootId(){try{return fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();}catch(e){return null;}}
function status(){return {enabled:fs.existsSync(enabled)&&ownsHook(),hookOwned:ownsHook(),backendPid:backendPid(),bootId:bootId()};}
function enable(source){
 if(fs.existsSync(hook)&&!ownsHook())throw new Error('Boot hook belongs to another installation');
 ['radar.qml','core.js','map-render.js','boot.js'].forEach(function(name){atomic(path.join(work,name),fs.readFileSync(path.join(source,name)));});
 // Reuse Homebrew init.d; do not modify Glasshouse, LG files or other hooks.
 atomic(hook,hookText,parseInt('755',8));fs.chmodSync(hook,parseInt('755',8));
 atomic(enabled,'150\n');return status();
}
function disable(){remove(enabled);if(ownsHook())remove(hook);return status();}
function request(port,route,done){
 var settled=false,req,timer=setTimeout(function(){finish(null);if(req)req.abort();},2000);
 function finish(data){if(settled)return;settled=true;clearTimeout(timer);done(data);}
 req=http.get({hostname:'127.0.0.1',port:port,path:route},function(res){
  var body='';res.on('data',function(chunk){body+=chunk;if(body.length>65536){finish(null);req.abort();}});
  res.on('end',function(){try{finish(res.statusCode===200?JSON.parse(body):null);}catch(e){finish(null);}});
  res.on('error',function(){finish(null);});
 });req.on('error',function(){finish(null);});
}
function run(done){
 var started=Date.now(),attempts=0,port=8080;
 try{var config=JSON.parse(fs.readFileSync('/var/lib/tvweb/config.json','utf8'));port=config.port||8080;}catch(e){}
 function report(result){result.bootId=bootId();result.attempts=attempts;result.elapsedMs=Date.now()-started;
  atomic(reportFile,JSON.stringify(result));if(done)done(result);}
 function next(){
  if(!fs.existsSync(enabled))return report({ok:true,skipped:'disabled-or-uninstalled'});
  // Count bounded attempts: standby and clock corrections must not consume the readiness budget.
  if(attempts>=60)return report({ok:false,error:'glasshouse-start-timeout'});
  attempts++;
  // A response is served only after Glasshouse's synchronous restaging finishes.
  request(port,'/api/screensaver',function(ready){
   if(!ready)return setTimeout(next,3000);
   try{
    var marker='/var/lib/tvweb/screensaver/.tvweb-screensaver';
    if(!fs.existsSync(marker)||fs.readFileSync(marker,'utf8').trim()!=='starfield')return report({ok:true,skipped:'different-screensaver-selected'});
    var mounted='/usr/palm/applications/com.webos.app.screensaver/.tvweb-screensaver';
    if(!fs.existsSync(mounted)||fs.readFileSync(mounted,'utf8').trim()!=='starfield')return report({ok:false,error:'glasshouse-mount-not-active'});
    var live=path.join(target,'main.qml'),backup=path.join(work,'previous-main.qml');
    if(!fs.existsSync(backup))throw new Error('Original backup missing');
    if(hash(live)!==hash(backup)&&fs.readFileSync(live,'utf8').indexOf('AIRPLANE_SCREENSAVER_NATIVE')<0)throw new Error('Unexpected screensaver content');
    var pid=backendPid();
    if(!pid){
     // Bounded log per boot. Start only our helper, never a respawn loop.
     var fd=fs.openSync(path.join(work,'backend.log'),'w',parseInt('600',8));
     var child=cp.spawn('/usr/bin/node',[path.join(work,'backend.js')],{detached:true,stdio:['ignore',fd,fd]});
     child.on('error',function(){});child.unref();fs.closeSync(fd);pid=child.pid;
     if(!pid)throw new Error('Data helper did not start');
     atomic(path.join(work,'backend.pid'),String(pid));
    }
    request(8895,'/status',function(health){
     try{
     if(!health||health.ok!==true||health.service!=='airplane-screensaver'||health.pid!==pid)return setTimeout(next,1000);
     if(!fs.existsSync(enabled)||fs.readFileSync(marker,'utf8').trim()!=='starfield')return report({ok:true,skipped:'selection-changed'});
     require(path.join(work,'assets.js')).install(work,target);
     ['core.js','map-render.js'].forEach(function(name){atomic(path.join(target,name),fs.readFileSync(path.join(work,name)),parseInt('644',8));});
     var changed=hash(live)!==hash(path.join(work,'radar.qml'));
     atomic(live,fs.readFileSync(path.join(work,'radar.qml')),parseInt('644',8));
     var result={ok:true,radarApplied:true,backendPid:pid,originalHash:hash(backup),currentHash:hash(live)};
     // Close only a cached native saver when its files changed. Never launch an app at boot.
     if(!changed)return report(result);
     cp.execFile('luna-send',['-n','1','luna://com.webos.applicationManager/closeByAppId','{"id":"com.webos.app.screensaver"}'],{timeout:3500},function(){report(result);});
     }catch(e){report({ok:false,error:String(e.message)});}
    });
   }catch(e){report({ok:false,error:String(e.message)});}
  });
 }
 next();
}
module.exports={enable:enable,disable:disable,status:status,run:run};
if(require.main===module&&process.argv[2]==='boot')run();
