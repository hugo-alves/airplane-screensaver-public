// Cooperate with the older TV Clean radar when it is installed on the same TV.
// Strict ES5 for webOS. Do not replace user changes made around our guard.
var fs=require('fs'),path=require('path');
var file='/media/developer/apps/usr/palm/applications/org.webosbrew.lounge.launcher/assets/glasshouse-compat/install.js';
var lock='/var/lib/airplane-screensaver/ownership-lock';
var begin='// AIRPLANE_STANDALONE_GUARD_BEGIN\n';
var end='// AIRPLANE_STANDALONE_GUARD_END\n';
var guard=begin+"if ((action==='prepare'||action==='persist') && fs.existsSync('"+lock+"')) throw new Error('Independent airplane screensaver is active; restore it before activating the older radar');\n"+end;
function write(source){var tmp=file+'.airplane-guard-new',mode=fs.statSync(file).mode&parseInt('777',8);fs.writeFileSync(tmp,source,{mode:mode});fs.chmodSync(tmp,mode);fs.renameSync(tmp,file);}
function inspect(){
 if(!fs.existsSync(file))return 'absent';
 var source=fs.readFileSync(file,'utf8');
 if(source.indexOf(begin)>=0||source.indexOf(end)>=0){if(source.indexOf(guard)<0)throw new Error('Older radar guard was changed; no files modified');return 'installed';}
 if(source.indexOf("var action=process.argv[2],source=__dirname")<0||source.indexOf("if(['prepare','persist','restore'].indexOf(action)<0)")<0||source.indexOf('try{\n')<0)throw new Error('Unrecognised older radar installer; restore or update it before installing');
 return 'supported';
}
function install(){var state=inspect();if(state!=='supported')return state;var source=fs.readFileSync(file,'utf8');write(source.replace('try{\n','try{\n'+guard));return 'installed';}
function remove(){if(!fs.existsSync(file))return;var source=fs.readFileSync(file,'utf8');if(source.indexOf(begin)<0&&source.indexOf(end)<0)return;if(source.indexOf(guard)<0)throw new Error('Older radar guard was changed; no files modified');write(source.replace(guard,''));}
module.exports={inspect:inspect,install:install,remove:remove};
