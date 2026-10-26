// Generate the same vector map as the computer-side preparer, on the TV.
// ES5: webOS 4/5 can ship Node 0.12. No user-provided URL is executed.
var fs = require('fs'), path = require('path'), execFile = require('child_process').execFile;
var vector = require('./vector-bundle.js');

function request(url, output, done) {
 var args = ['-4','--fail','--silent','--show-error','--location','--max-redirs','3',
  '--proto','=https','--proto-redir','=https','--connect-timeout','5','--max-time','20',
  '--max-filesize','2000000','--user-agent','Airplane-Screensaver/1.0'];
 if (output) args.push('--output', output);
 args.push(url);
 function run(family) {
  args[0] = family;
  execFile('curl', args, {timeout:23000,maxBuffer:2100000}, function(err, body) {
   if (err && family === '-4' && !err.killed && (err.code === 6 || err.code === 7 || err.code === 28)) return run('-6');
   done(err, body);
  });
 }
 run('-4');
}
function style(name, p, type) {
 if (name === 'water') return {fill:'#07333e'};
 if (name === 'park') return {fill:'#1a2a29'};
 if (name === 'landuse') return {fill:p['class'] === 'residential' ? '#151e22' : '#1b282b'};
 if (name === 'aeroway') return type === 3 ? {fill:'#344247'} : {stroke:'#5a6c70',width:1.3};
 if (name === 'transportation') {
  if (p['class'] === 'path' || p['class'] === 'track') return null;
  return {stroke:/^(motorway|trunk)$/.test(p['class']) ? '#b8beb0' : /^(primary|secondary)$/.test(p['class']) ? '#939f98' : '#506263',
   width:/^(motorway|trunk)$/.test(p['class']) ? 1.6 : 0.7};
 }
 return null;
}
function boundsFor(config) {
 var lat=config.location.latitude, lon=config.location.longitude, radius=config.radiusKm;
 // The observation radius can be 1 km, but the idle camera still shows a
 // 20 km-wide map. Cover that wider view (and its 20% canvas margin) too.
 var dLat=Math.max(radius*1.45,8)/111.2;
 var dLon=Math.min(180,Math.max(radius*1.45,12)/111.2/Math.cos(lat*Math.PI/180));
 function tx(x,z){return Math.floor((x+180)/360*Math.pow(2,z));}
 function ty(y,z){
  var value=Math.tan(Math.max(-85,Math.min(85,y))*Math.PI/180);
  var asinh=Math.log(value+Math.sqrt(value*value+1));
  return Math.floor((1-asinh/Math.PI)/2*Math.pow(2,z));
 }
 var z=12,b,count;
 do {
  count=Math.pow(2,z);
  b={x0:tx(lon-dLon,z),x1:tx(lon+dLon,z),y0:Math.max(0,ty(lat+dLat,z)),y1:Math.min(count-1,ty(lat-dLat,z))};
  if ((b.x1-b.x0+1)*(b.y1-b.y0+1)<=60) return {zoom:z,bounds:b};
  z--;
 } while(z>=6);
 throw new Error('Selected map area is too large');
}
function create(config, out, progress, done) {
 var plan;
 try { plan=boundsFor(config); } catch(e) { return done(e); }
 request('https://tiles.openfreemap.org/planet', null, function(err, metadata) {
  if (err) return done(new Error('Could not reach the map service'));
  var template;
  try { template=JSON.parse(metadata).tiles[0]; } catch(e) { return done(new Error('Invalid map service response')); }
  if (!/^https:\/\/tiles\.openfreemap\.org\/planet\/[a-z0-9_/-]+\/\{z\}\/\{x\}\/\{y\}\.pbf$/i.test(template)) return done(new Error('Invalid map source'));
  var z=plan.zoom,b=plan.bounds,jobs=[],shapes=[],finished=0,total,x,y;
  for(x=b.x0;x<=b.x1;x++) for(y=b.y0;y<=b.y1;y++) jobs.push({x:x,y:y});
  total=jobs.length;
  function next() {
   if (!jobs.length) {
    try {
     shapes.sort(function(a,b){return Number(!!a.stroke)-Number(!!b.stroke);});
     var pointShapes=[],nativeShapes=[];
     shapes.forEach(function(f){
      var a={polygon:f.polygon,paths:f.paths,bounds:f.bounds}, n={polygon:f.polygon,nativePath:f.nativePath,nativeVertices:f.nativeVertices,bounds:f.bounds};
      if(f.fill){a.fill=f.fill;n.fill=f.fill;} if(f.stroke){a.stroke=f.stroke;n.stroke=f.stroke;a.width=f.width;n.width=f.width;}
      pointShapes.push(a);nativeShapes.push(n);
     });
     fs.writeFileSync(path.join(out,'map.json'),JSON.stringify({source:'OpenFreeMap / OpenStreetMap contributors',shapes:pointShapes}));
     fs.writeFileSync(path.join(out,'map-native.json'),JSON.stringify({source:'OpenFreeMap / OpenStreetMap contributors',shapes:nativeShapes}));
     return done(null,{tiles:total,features:shapes.length});
    } catch(e) { return done(e); }
   }
   var tile=jobs.shift(),count=Math.pow(2,z),wrapped=((tile.x%count)+count)%count;
   var tileUrl=template.replace('{z}',z).replace('{x}',wrapped).replace('{y}',tile.y),file=path.join(out,'.map-tile.pbf');
   request(tileUrl,file,function(fetchError) {
    if(fetchError) return done(new Error('A map tile could not be downloaded'));
    try {
     var raw=fs.readFileSync(file),bytes=new Uint8Array(raw.length),i;
     for(i=0;i<raw.length;i++)bytes[i]=raw[i];
     fs.unlinkSync(file);
     var data=new vector.VectorTile(new vector.Pbf(bytes)),size=1200/count,ox=tile.x*size,oy=tile.y*size;
     ['landuse','park','water','aeroway','transportation'].forEach(function(name){
      var layer=data.layers[name]; if(!layer)return;
      for(var n=0;n<layer.length;n++) {
       var f=layer.feature(n),appearance=style(name,f.properties,f.type);if(!appearance)continue;
       var rings=f.loadGeometry(),paths=[],parts=[],vertices=0,x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
       rings.forEach(function(ring){
        var points=[];vertices+=ring.length;
        ring.forEach(function(p,index){
         var px=+(ox+p.x/f.extent*size).toFixed(6),py=+(oy+p.y/f.extent*size).toFixed(6);
         points.push([px,py]);parts.push((index?'L':'M')+px+' '+py);
         x0=Math.min(x0,px);y0=Math.min(y0,py);x1=Math.max(x1,px);y1=Math.max(y1,py);
        });
        if(f.type===3 && ring.length)parts.push('Z');paths.push(points);
       });
       if(!isFinite(x0))continue;
       var item={polygon:f.type===3,paths:paths,nativePath:parts.join(''),nativeVertices:vertices,bounds:[x0,y0,x1,y1]};
       if(appearance.fill)item.fill=appearance.fill;if(appearance.stroke){item.stroke=appearance.stroke;item.width=appearance.width;}
       shapes.push(item);
      }
     });
     finished++;progress(finished,total);setTimeout(next,0);
    } catch(e) { done(new Error('Could not prepare the map: '+e.message)); }
   });
  }
  progress(0,total);next();
 });
}
module.exports={create:create,boundsFor:boundsFor};
