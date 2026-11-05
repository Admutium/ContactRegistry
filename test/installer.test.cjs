const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {waitForReady}=require('../src/installer.cjs');
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'installer-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return {ready:path.join(dir,'ready'),result:path.join(dir,'result.json'),child:Object.assign(new EventEmitter(),{exitCode:null}),timeout:300};}
test('installer readiness is required before the application can close',async t=>{const f=await fixture(t);const waiting=waitForReady(f);await fs.writeFile(f.ready,'ready');await waiting;});
test('failed preparation reports its log even when ready marker exists',async t=>{const f=await fixture(t);await fs.writeFile(f.ready,'ready');await fs.writeFile(f.result,'\uFEFF'+JSON.stringify({status:'failed',message:'Expand failed',log:'C:\\Logs\\update.log'}));await assert.rejects(()=>waitForReady(f),/Expand failed/);});
test('PowerShell process exit and launch failure do not authorize application shutdown',async t=>{const f=await fixture(t);f.child.exitCode=1;await assert.rejects(()=>waitForReady(f),/кодом 1/);f.child.exitCode=null;const pending=waitForReady(f);f.child.emit('error',Error('PowerShell blocked'));await assert.rejects(()=>pending,/PowerShell blocked/);});
test('hung helper times out instead of silently closing the application',async t=>{const f=await fixture(t);await assert.rejects(()=>waitForReady({...f,timeout:20}),/не подтвердил/);});

const {prepare}=require('../src/installer.cjs');
const fixtureArchive=Buffer.from('UEsDBBQAAAAIAOdGZV1eSjLLFQAAABMAAAATAAAAQ29udGFjdFJlZ2lzdHJ5LmV4ZctLLdctKMpPL0rM1U3LrCgpLUoFAFBLAwQUAAAACADnRmVdgIGMMRIAAAAQAAAAEgAAAHJlc291cmNlcy9hcHAuYXNhcstLLddNLE4s0k3LrCgpLUoFAFBLAQIUAxQAAAAIAOdGZV1eSjLLFQAAABMAAAATAAAAAAAAAAAAAACAAQAAAABDb250YWN0UmVnaXN0cnkuZXhlUEsBAhQDFAAAAAgA50ZlXYCBjDESAAAAEAAAABIAAAAAAAAAAAAAAIABRgAAAHJlc291cmNlcy9hcHAuYXNhclBLBQYAAAAAAgACAIEAAACIAAAAAAA=','base64');
async function windowsFixture(t) {
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'registry-launch-'));
  const directory=path.join(base,"Контакты [test] O'Brien");const userData=path.join(base,'profile');const target=path.join(base,'app');
  for(const folder of [directory,userData,target])await fs.mkdir(folder,{recursive:true});
  t.after(()=>fs.rm(base,{recursive:true,force:true,maxRetries:10,retryDelay:200}));
  const archive=path.join(directory,'update.zip');await fs.writeFile(archive,fixtureArchive);await fs.writeFile(path.join(target,'ContactRegistry.exe'),'old');
  return {directory,archive,userData,target,exe:'ContactRegistry.exe',version:'test'};
}
test('Windows launches the real helper with Unicode config, inherited log handles and readiness handshake',{skip:process.platform!=='win32'},async t=>{
  const f=await windowsFixture(t);const prepared=await prepare(f).catch(async error=>{for(const name of ['last-update.log','last-update-launch.log']){try{console.error(name,await fs.readFile(path.join(f.userData,name),'utf8'));}catch{}}throw error;});
  assert.equal(await fs.readFile(path.join(f.target,f.exe),'utf8'),'old');
  assert.equal((await fs.readFile(path.join(f.directory,'install.ps1'))).subarray(0,3).toString('hex'),'efbbbf');
  await fs.writeFile(path.join(f.directory,'cancel'),'cancel');
  const deadline=Date.now()+20000;let outcome;
  while(Date.now()<deadline){try{outcome=JSON.parse((await fs.readFile(prepared.result,'utf8')).replace(/^\uFEFF/,''));break;}catch(e){if(e.code!=='ENOENT')throw e;}await new Promise(r=>setTimeout(r,100));}
  assert.equal(outcome?.status,'failed');assert.match(outcome.message,/cancelled/);assert.equal(await fs.readFile(path.join(f.target,f.exe),'utf8'),'old');
});
test('Windows malformed archive fails preparation without authorizing shutdown',{skip:process.platform!=='win32'},async t=>{
  const f=await windowsFixture(t);await fs.writeFile(f.archive,'not a zip');await assert.rejects(()=>prepare(f),/Не удалось подготовить|кодом/);assert.equal(await fs.readFile(path.join(f.target,f.exe),'utf8'),'old');await assert.rejects(()=>fs.access(path.join(f.directory,'ready')),{code:'ENOENT'});
});

test('successful bootstrap exit is not readiness; helper must separately acknowledge',async t=>{
 const f=await fixture(t);f.child.exitCode=0;await assert.rejects(()=>waitForReady({...f,allowExitZero:true,timeout:20}),/не подтвердил/);await fs.writeFile(f.ready,'ready');await waitForReady({...f,allowExitZero:true});
});
