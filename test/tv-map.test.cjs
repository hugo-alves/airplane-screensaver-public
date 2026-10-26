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
