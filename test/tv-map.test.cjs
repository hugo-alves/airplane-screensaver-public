const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');

test('TV map builder converts a downloaded vector tile into both renderer formats', async () => {
  const payload=path.resolve('build/lg-app/payload');
  const {Pbf}=require(path.join(payload,'vector-bundle.js'));
  const writer=new Pbf();
  writer.writeMessage(3,(_unused,layer)=>{
    layer.writeVarintField(15,2);layer.writeStringField(1,'water');layer.writeVarintField(5,4096);
    layer.writeMessage(2,(_feature,f)=>{f.writeVarintField(3,3);f.writePackedVarint(4,[9,0,0,26,20,0,0,20,19,0,15]);},null);
  },null);
  const tile=Buffer.from(writer.finish()),oldExec=cp.execFile;
  const out=fs.mkdtempSync(path.join(os.tmpdir(),'airplane-map-test-'));
  try {
    cp.execFile=(_exe,args,_options,cb)=>{
      if(args.includes('--output')){fs.writeFileSync(args[args.indexOf('--output')+1],tile);return process.nextTick(()=>cb(null,''));}
      process.nextTick(()=>cb(null,JSON.stringify({tiles:['https://tiles.openfreemap.org/planet/sample/{z}/{x}/{y}.pbf']})));
    };
    const map=require(path.join(payload,'map-create.js'));
    const progress=[];
    const result=await new Promise((resolve,reject)=>map.create({location:{latitude:35.6895,longitude:139.6917},radiusKm:1},out,(n,total)=>progress.push([n,total]),(err,value)=>err?reject(err):resolve(value)));
    const points=JSON.parse(fs.readFileSync(path.join(out,'map.json'),'utf8')).shapes;
    const compiled=JSON.parse(fs.readFileSync(path.join(out,'map-native.json'),'utf8')).shapes;
    assert.ok(result.tiles>1);assert.equal(points.length,result.tiles);assert.equal(compiled.length,result.tiles);
    assert.equal(points[0].fill,'#07333e');assert.ok(points[0].paths[0].length>=4);assert.match(compiled[0].nativePath,/^M.*Z$/);
    assert.deepEqual(progress[0],[0,result.tiles]);assert.deepEqual(progress[progress.length-1],[result.tiles,result.tiles]);
  } finally {cp.execFile=oldExec;fs.rmSync(out,{recursive:true,force:true});}
});

test('native map tiles cover the square theme camera and its buffered canvas', () => {
  // The same ES5 planner is used by TV setup and computer-side preparation.
  const {boundsFor} = require('../native/map-bounds.js');
  for (const latitude of [-85, -70, 0, 38.7, 70, 85]) {
    for (const longitude of [-179.99, 0, 179.99]) {
      for (const radiusKm of [1, 5, 50]) {
        const config={location:{latitude,longitude},radiusKm};
        for (const maxTiles of [60,100]) {
          const {zoom,bounds:b}=boundsFor(config,maxTiles), count=2**zoom;
          const sin=Math.sin(latitude*Math.PI/180), cx=(longitude+180)/360;
          const cy=(1-Math.log((1+sin)/(1-sin))/(2*Math.PI))/2;
          // 1.15 is the circular viewport's camera padding; 1.2 is
          // radar.qml's offscreen canvas margin. Compare in Mercator space.
          const half=Math.max(20,radiusKm*2.4)*1.15*1.2/2/(6371*Math.cos(latitude*Math.PI/180)*2*Math.PI);
          const msg=`lat=${latitude} lon=${longitude} radius=${radiusKm} max=${maxTiles}`;
          assert.ok(b.x0/count<=cx-half,msg);assert.ok((b.x1+1)/count>=cx+half,msg);
          assert.ok(b.y0/count<=Math.max(0,cy-half),msg);assert.ok((b.y1+1)/count>=Math.min(1,cy+half),msg);
          assert.ok((b.x1-b.x0+1)*(b.y1-b.y0+1)<=maxTiles,msg);
        }
      }
    }
  }
});
