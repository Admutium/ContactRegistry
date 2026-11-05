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
