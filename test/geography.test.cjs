const {test}=require('node:test'),assert=require('node:assert/strict'),esbuild=require('esbuild'),vm=require('node:vm');
function load(file){const result=esbuild.buildSync({entryPoints:[file],bundle:true,write:false,platform:'node',format:'cjs'});const module={exports:{}};vm.runInNewContext(result.outputFiles[0].text,{module,exports:module.exports,require,Intl,console});return module.exports;}
test('aircraft and camera use the nearest copy across the date line',()=>{
 const c=load('src/js/flight-camera.js'),center={latitude:0,longitude:179.99},aircraft={latitude:0,longitude:-179.99,stale:false,speedKmh:null,heading:null};
 const view=c.createFlightCamera(center,5).update(aircraft,{width:1000,height:500},0),point=c.cameraPoint(aircraft,view,{width:1000,height:500});
 assert.ok(view.targetSpanKm<10,'the nearby aircraft must not look a world away');assert.ok(point.x>500&&point.x<700,'aircraft must appear east of the centre');
});
test('provider distance uses nautical miles and allows for rounded coordinates',()=>{
 const d=load('src/js/flight-data.js');assert.match(d.aircraftUrl({location:{latitude:0,longitude:0},radiusKm:18.52}),/\/dist\/12$/);
});
