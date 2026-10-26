// Node 0.12 / ES5. Fixed public data sources, loopback only, no command endpoint.
var http=require('http'),fs=require('fs'),execFile=require('child_process').execFile,path=require('path');
var dir=__dirname,config=JSON.parse(fs.readFileSync(path.join(dir,'config.json'),'utf8'));
var maps={},cache={},pending={},lanes={nearby:false,metadata:false};
var prefix=path.join(dir,'status-'),build='1',nearbyPending=null;
function counters(){return {attempts:0,successes:0,failures:0,lastSuccess:0,lastFailure:0,lastError:null,lastElapsedMs:0};}
var state={ok:true,service:'airplane-screensaver',pid:process.pid,started:Date.now(),beats:0,frames:0,mapLoaded:false,flightCount:0,
 transport:{preferredFamily:'IPv4',curl:null},nearby:counters(),metadata:counters(),providers:{adsbfi:counters(),adsblol:counters()},activeSource:null};
var point=config.location.latitude.toFixed(2)+'/lon/'+config.location.longitude.toFixed(2)+'/dist/'+Math.ceil((config.radiusKm+2)/1.852);
var sources=[{key:'adsbfi',name:'ADSB.fi',url:'https://opendata.adsb.fi/api/v3/lat/'+point},
 {key:'adsblol',name:'ADSB.lol',url:'https://api.adsb.lol/v2/lat/'+point}];
function snapshot(label){fs.writeFileSync(prefix+label+'-'+build+'.json',JSON.stringify(state));}
function report(){snapshot('live');}
function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(typeof data==='string'?data:JSON.stringify(data));}
function reply(raw){
 var body=String(raw||''),status=null,retry=null;
 while(/^HTTP\/[\d.]+\s+\d{3}/.test(body)){
  var end=body.indexOf('\r\n\r\n');if(end<0)break;
  var header=body.slice(0,end);body=body.slice(end+4);
  status=parseInt(/^HTTP\/[\d.]+\s+(\d{3})/.exec(header)[1],10);
  var match=/\r\nretry-after:\s*([^\r\n]+)/i.exec(header);retry=match?match[1].trim():null;
 }
 var delay=retry===null?0:/^\d+$/.test(retry)?parseInt(retry,10)*1000:Math.max(0,Date.parse(retry)-Date.now());
 return {body:body,status:status,retryAfterMs:isFinite(delay)?Math.min(86400000,delay):0};
}
function failure(err,stderr,httpStatus){
 var code=err&&err.code,match=/returned error:?\s*(\d{3})/i.exec(String(stderr||''));
 return {kind:err&&err.killed||code===28?'timeout':code===6?'dns':code===7?'connect':code===22?'http':code===35||code===60?'tls':code==='invalid-json'?'invalid-json':code==='stale-feed'?'stale-feed':'client',
  code:typeof code==='number'?code:null,httpStatus:httpStatus||(match?parseInt(match[1],10):null)};
}
function upstream(url,ttl,lane,cb,routeFallback,provider){
 var old=cache[url];if(old&&old.until>Date.now())return cb(null,old.body);
 if(pending[url]){pending[url].push(cb);return;}
 // Position updates have their own slot; metadata can never occupy it.
 if(lanes[lane])return cb(new Error('busy'));
 lanes[lane]=true;pending[url]=[cb];
 var metric=state[lane],source=provider&&state.providers[provider],started=Date.now();metric.attempts++;
 if(source)source.attempts++;
 function finish(err,body,stderr,wire){
  lanes[lane]=false;
  var callbacks=pending[url];delete pending[url];metric.lastElapsedMs=Date.now()-started;
  if(err){metric.failures++;metric.lastFailure=Date.now();metric.lastError=failure(err,stderr,wire&&wire.status);}
  else{
   metric.successes++;metric.lastSuccess=Date.now();metric.lastError=null;
   var keys=Object.keys(cache);if(keys.length>=64)delete cache[keys[0]];
   cache[url]={until:Date.now()+(typeof ttl==='function'?ttl(body):ttl),body:body};
  }
  if(source){
   source.lastElapsedMs=metric.lastElapsedMs;
   if(err){
    source.failures++;source.failureStreak=(source.failureStreak||0)+1;source.lastFailure=Date.now();source.lastError=metric.lastError;
    var limited=source.lastError.httpStatus===429;
    var pause=Math.min(limited?300000:60000,(limited?60000:15000)*Math.pow(2,Math.min(5,source.failureStreak-1)));
    source.blockedUntil=Date.now()+Math.max(pause,wire&&wire.retryAfterMs||0);
    if(limited){source.rateLimits=(source.rateLimits||0)+1;if(source.rateLimits===1)snapshot('rate-limit-'+provider);}
   }else{source.successes++;source.lastSuccess=Date.now();source.lastError=null;source.failureStreak=0;source.blockedUntil=0;}
  }
  callbacks.forEach(function(done){done(err,body);});
 }
 function attempt(family,target){
  execFile('curl',[family,'--include','--fail','--silent','--show-error','--location','--max-redirs','3',
   '--proto','=https','--proto-redir','=https','--user-agent','Airplane-Screensaver/1.0',
   '--connect-timeout',provider?'2':'3','--max-time',provider?'3':'7','--max-filesize','2000000',target],{timeout:provider?4000:8500,maxBuffer:2000000},function(err,raw,stderr){
   var wire=reply(raw),body=wire.body;
   if(err&&family==='-4'&&!err.killed&&(err.code===6||err.code===7||err.code===28))return attempt('-6',target);
   if(err&&err.code===22&&routeFallback&&failure(err,stderr).httpStatus===404){
    var fallback=routeFallback;routeFallback=null;return attempt('-4',fallback);
   }
   if(err&&lane==='metadata'&&err.code===22&&failure(err,stderr).httpStatus===404){err=null;body='{"response":{}}';}
   if(!err){try{JSON.parse(body);}catch(e){err=new Error('invalid data');err.code='invalid-json';}}
   if(!err&&provider){
    var feed=JSON.parse(body),stamp=feed&&(feed.now>1e12?feed.now:feed.now*1000);
    if(!feed||!Array.isArray(feed.ac)||typeof feed.now!=='number'||!isFinite(feed.now)||Date.now()-stamp>25000||stamp-Date.now()>60000){err=new Error('Invalid or stale aircraft source');err.code='stale-feed';}
   }
   finish(err,body,stderr,wire);
  });
 }
 attempt('-4',url);
}
function nearby(done){
 if(nearbyPending){nearbyPending.push(done);return;}
 nearbyPending=[done];
 function finish(err,data,wait){var callbacks=nearbyPending;nearbyPending=null;callbacks.forEach(function(cb){cb(err,data,wait);});}
 function next(index){
  if(index>=sources.length){
   var delay=Math.min.apply(Math,sources.map(function(s){return Math.max(1000,(state.providers[s.key].blockedUntil||Date.now()+15000)-Date.now());}));
   return finish(new Error('Sources paused'),null,delay);
  }
  var s=sources[index],health=state.providers[s.key];
  if(health.blockedUntil>Date.now())return next(index+1);
  upstream(s.url,9000,'nearby',function(err,body){
   if(err)return next(index+1);
   var data=JSON.parse(body);data._airplaneSource=s.name;state.activeSource=s.name;finish(null,data,0);
  },null,s.key);
 }
 next(0);
}
var server=http.createServer(function(req,res){
 var u=require('url').parse(req.url,true),q=u.query;
 if(req.method!=='GET')return send(res,405,{error:'GET only'});
 if(u.pathname==='/config')return send(res,200,config);
 if(u.pathname==='/map'){
  var mapFile=q.native==='1'?'map-native.json':'map.json';
  if(!maps[mapFile])maps[mapFile]=fs.readFileSync(path.join(dir,mapFile),'utf8');
  state.mapFormat=q.native==='1'?'compiled-paths':'point-arrays';
  return send(res,200,maps[mapFile]);
 }
 if(u.pathname==='/beat'){
  state.beats++;state.lastBeat=Date.now();state.frames=Math.min(10000000,Math.max(0,parseInt(q.frames,10)||0));
  state.mapLoaded=q.loaded==='1';state.feedAgeSeconds=q.age==='none'?null:Math.min(86400,Math.max(0,parseInt(q.age,10)||0));
  state.hasLiveFeed=q.live==='1'&&state.feedAgeSeconds!==null&&state.feedAgeSeconds<25;
  state.flightCount=Math.min(40,Math.max(0,parseInt(q.count,10)||0));
  state.aircraftIcons={ready:Math.min(40,Math.max(0,parseInt(q.iconsReady,10)||0)),failed:Math.min(40,Math.max(0,parseInt(q.iconsError,10)||0))};
  state.paint={count:Math.min(10000000,Math.max(0,parseInt(q.paints,10)||0)),totalMs:Math.min(86400000,Math.max(0,parseInt(q.paintTotal,10)||0)),maxMs:Math.min(60000,Math.max(0,parseInt(q.paintMax,10)||0)),strokes:Math.min(30000,Math.max(0,parseInt(q.strokes,10)||0)),features:Math.min(50000,Math.max(0,parseInt(q.features,10)||0))};
  state.paint.bulkPaths=q.bulk==='1';state.routeVisible=q.route==='1';report();
  if([1,4,12,24,36,60,120].indexOf(state.beats)>=0)snapshot('render-'+state.beats);
  if(state.hasLiveFeed&&!state.liveObserved){state.liveObserved=true;snapshot('feed');}
  return send(res,200,{ok:true});
 }
 if(u.pathname==='/status')return send(res,200,state);
 if(u.pathname==='/nearby')return nearby(function(err,data,wait){send(res,err?503:200,err?{error:'sources-paused',retryAfterMs:wait}:data);});
 if(u.pathname==='/metadata'&&/^[a-f0-9]{6}$/i.test(q.id||'')&&/^[a-z0-9]{0,12}$/i.test(q.callsign||''))return upstream('https://api.adsbdb.com/v0/aircraft/'+q.id+(q.callsign?'?callsign='+q.callsign:''),function(body){
  var decoded=JSON.parse(body),p=decoded&&decoded.response;return p&&p.flightroute?900000:60000;
 },'metadata',function(err,data){send(res,err?502:200,err?{error:'Metadata unavailable'}:data);},q.callsign?'https://api.adsbdb.com/v0/callsign/'+q.callsign:null);
 send(res,404,{error:'Not found'});
});
server.listen(8895,'127.0.0.1',function(){report();execFile('curl',['--version'],{timeout:1500,maxBuffer:2048},function(err,out){state.transport.curl=err?'unavailable':String(out).split('\n')[0].slice(0,160);});});
