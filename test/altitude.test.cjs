const {test}=require('node:test'),assert=require('node:assert/strict'),esbuild=require('esbuild'),vm=require('node:vm');
function load(file){const result=esbuild.buildSync({entryPoints:[file],bundle:true,write:false,platform:'node',format:'cjs'});const module={exports:{}};vm.runInNewContext(result.outputFiles[0].text,{module,exports:module.exports,require,Intl,console});return module.exports;}
test('negative barometric altitude is not presented as ground or fabricated as zero',()=>{
 const f=load('src/js/flight-tracking.js');const now=Date.now();const base={hex:'abcdef',lat:40,lon:-73,seen_pos:1,flight:'TEST'};
 const reports=f.readAircraftFeed({now,ac:[{...base,alt_baro:-75},{...base,hex:'abcdee',alt_baro:0},{...base,hex:'abcded',alt_baro:700},{...base,hex:'abcdec',alt_baro:'ground'},{...base,hex:'abcdeb',ground:true,alt_baro:10},{...base,hex:'abcdea'}]},now);
 assert.equal(reports.length,4);assert.equal(f.altitudeDisposition(reports[0].altitudeM),'below-zero');assert.equal(reports[0].altitudeM,-75*.3048);assert.equal(f.altitudeDisposition(reports[1].altitudeM),'valid');assert.equal(f.altitudeDisposition(reports[2].altitudeM),'valid');assert.equal(f.altitudeDisposition(reports[3].altitudeM),'unavailable');
 const tracker=f.createFlightTracker();tracker.ingest(reports,now);assert.equal(f.altitudeDisposition(tracker.positions(now).find(p=>p.id==='abcdef').altitudeM),'below-zero');
});
