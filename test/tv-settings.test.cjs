const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');

function until(predicate) {
  return new Promise((resolve,reject) => {
    const end=Date.now()+3000;
    (function check(){if(predicate())return resolve();if(Date.now()>end)return reject(new Error('UI did not update'));setTimeout(check,10);})();
  });
}

test('on-TV setup searches for a city, selects it and applies the chosen settings', async () => {
  const calls=[];
  const html=fs.readFileSync('native/app/index.html','utf8');
  const dom=new JSDOM(html,{url:'file:///media/apps/com.airplanescreensaver.app/index.html',runScripts:'dangerously',beforeParse(window){
    Object.defineProperty(window.navigator,'language',{value:'pt-PT'});
    window.PalmServiceBridge=function(){this.call=(service,payload)=>{
      assert.equal(service,'luna://org.webosbrew.hbchannel.service/exec');
      const command=JSON.parse(payload).command;
      const match=command.match(/'(info|search|start|status|restore)'(?: '([A-Za-z0-9+/=]+)')?$/);
      assert.ok(match,command);
      const action=match[1],arg=match[2]?JSON.parse(Buffer.from(match[2],'base64').toString('utf8')):null;
      calls.push({action,arg,command});
      let reply;
      if(action==='info')reply={ok:true,config:null};
      else if(action==='search')reply={ok:true,results:[{name:'Tokyo',region:'Tokyo',country:'Japan',latitude:35.6895,longitude:139.6917}]};
      else if(action==='start')reply={ok:true};
      else if(action==='status')reply={ok:true,running:false,phase:'complete'};
      else if(action==='restore')reply={ok:true};
      else throw new Error('Unexpected action '+action);
      setTimeout(()=>this.onservicecallback(JSON.stringify({returnValue:true,stdoutString:JSON.stringify(reply)})),0);
    };};
  }});
  try {
    const d=dom.window.document;
    await until(()=>calls.some(c=>c.action==='info'));
    const city=d.getElementById('city');city.value="Tokyo'; echo ignored";city.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
    d.getElementById('search').click();
    await until(()=>d.querySelector('#results button'));
    assert.equal(calls.find(c=>c.action==='search').arg.name,"Tokyo'; echo ignored");
    assert.ok(!calls.find(c=>c.action==='search').command.includes('echo ignored'));
    d.querySelector('#results button').click();
    assert.match(d.getElementById('selected').textContent,/Tokyo, Japan/);
    d.getElementById('more').click();d.getElementById('units').click();
    d.getElementById('save').click();
    await until(()=>d.getElementById('status').textContent.includes('Pronto'));
    assert.deepEqual(calls.find(c=>c.action==='start').arg,{location:{name:'Tokyo',latitude:35.6895,longitude:139.6917},radiusKm:6,language:'pt',units:'aviation'});
    d.getElementById('restore').click();
    await until(()=>d.getElementById('status').textContent.includes('reposto'));
    assert.ok(calls.some(c=>c.action==='restore'));
  } finally {dom.window.close();}
});

test('the app does not install before a search result is selected', async () => {
  let starts=0;
  const dom=new JSDOM(fs.readFileSync('native/app/index.html','utf8'),{url:'file:///app/index.html',runScripts:'dangerously',beforeParse(window){
    window.PalmServiceBridge=function(){this.call=(service,payload)=>{const command=JSON.parse(payload).command;if(command.includes("'start'"))starts++;setTimeout(()=>this.onservicecallback(JSON.stringify({stdoutString:'{"ok":true,"config":null}'})),0);};};
  }});
  try {await until(()=>dom.window.document.activeElement.id==='city');dom.window.document.getElementById('save').click();assert.equal(starts,0);assert.match(dom.window.document.getElementById('status').textContent,/select a city|seleciona primeiro/i);}
  finally {dom.window.close();}
});

test('editing the city after choosing a result cannot activate the old location', async () => {
  let starts=0;
  const dom=new JSDOM(fs.readFileSync('native/app/index.html','utf8'),{url:'file:///app/index.html',runScripts:'dangerously',beforeParse(window){
    window.PalmServiceBridge=function(){this.call=(service,payload)=>{
      const command=JSON.parse(payload).command,action=(command.match(/'(info|search|start)'/)||[])[1];
      if(action==='start')starts++;
      const reply=action==='search'?{ok:true,results:[{name:'Tokyo',country:'Japan',latitude:35.6895,longitude:139.6917}]}:{ok:true,config:null};
      setTimeout(()=>this.onservicecallback(JSON.stringify({stdoutString:JSON.stringify(reply)})),0);
    };};
  }});
  try {
    const d=dom.window.document;await until(()=>d.activeElement.id==='city');
    d.getElementById('city').value='Tokyo';d.getElementById('search').click();await until(()=>d.querySelector('#results button'));
    d.querySelector('#results button').click();
    // Some LG IMEs update the value before dispatching the input event.
    d.getElementById('city').value='Osaka';d.getElementById('save').click();
    assert.equal(starts,0);assert.match(d.getElementById('status').textContent,/select a city|seleciona primeiro/i);
  } finally {dom.window.close();}
});
