const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),esbuild=require('esbuild'),{JSDOM}=require('jsdom');

async function openPreview(query,stored){
  // Keep this a test of the browser app and simulated flight, without network
  // or a canvas implementation. Real map rendering is verified separately.
  const bundle=await esbuild.build({entryPoints:['src/js/flight-preview.js'],bundle:true,write:false,format:'iife',platform:'browser',plugins:[{
    name:'offline-map',setup(build){
      build.onResolve({filter:/^\.\/flight-map\.js$/},()=>({path:'offline-map',namespace:'test'}));
      build.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export function createFlightMap(){return {render:function(v){return v},pause:function(){},resume:function(){},clear:function(){}}}',loader:'js'}));
    }
  }]});
  const requests=[];
  const dom=new JSDOM(fs.readFileSync('src/flight-preview.html','utf8'),{url:'http://localhost:8894/'+query,runScripts:'dangerously',pretendToBeVisual:true,beforeParse(window){
    if(stored)window.localStorage.setItem('airplane-screensaver.zone',JSON.stringify(stored));
    window.fetch=url=>{requests.push(String(url));return Promise.reject(new Error('Network unavailable in this test'));};
    Object.defineProperty(window.HTMLElement.prototype,'clientWidth',{get(){return 1000;}});
    Object.defineProperty(window.HTMLElement.prototype,'clientHeight',{get(){return 600;}});
  }});
  dom.window.eval(bundle.outputFiles[0].text);
  return {dom,requests};
}
function until(predicate){return new Promise((resolve,reject)=>{const end=Date.now()+2000;(function poll(){if(predicate())return resolve();if(Date.now()>end)return reject(new Error('Preview did not render'));setTimeout(poll,10);})();});}

test('a fresh browser can see a clearly labelled simulated flight without storing a location',async()=>{
  const {dom,requests}=await openPreview('?simulation=1&phase=overhead');
  try{
    const d=dom.window.document;
    await until(()=>d.querySelector('.flight-code')&&d.querySelector('.flight-code').textContent==='TEST1234');
    assert.equal(d.querySelector('.flight-screen').hidden,false);
    assert.match(d.querySelector('.preview-simulation').textContent,/SIMULADOS/);
    assert.equal(d.querySelector('.preview-controls').hidden,true);
    assert.equal(dom.window.localStorage.getItem('airplane-screensaver.zone'),null);
    assert.deepEqual(requests,[]);
  }finally{dom.window.close();}
});

test('normal live preview still asks for a location on a fresh browser',async()=>{
  const {dom}=await openPreview('');
  try{
    const d=dom.window.document;
    assert.equal(d.querySelector('.flight-screen').hidden,true);
    assert.equal(d.querySelector('.preview-controls').hidden,false);
    assert.equal(d.querySelector('[name=latitude]').value,'');
    assert.equal(dom.window.localStorage.getItem('airplane-screensaver.zone'),null);
  }finally{dom.window.close();}
});
