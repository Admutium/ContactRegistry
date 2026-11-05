const {test}=require('node:test');const assert=require('node:assert/strict');const {allowed,isNewer}=require('../src/update.cjs');
test('versions compare numerically and reject malformed/prerelease versions',()=>{assert.ok(isNewer('0.10.0','0.9.9'));assert.ok(!isNewer('0.1.0','0.1.0'));assert.ok(!isNewer('0.1.0','0.2.0'));assert.ok(!isNewer('../evil','0.1.0'));});
test('updater accepts only HTTPS release hosts without credentials or arbitrary ports',()=>{assert.ok(allowed('https://github.com/Admutium/ContactRegistry/releases/latest/download/update.json'));for(const url of ['http://github.com/file','https://evil.example/file','https://github.com.evil.example/file','https://user:password@github.com/file','https://github.com:8888/file'])assert.equal(allowed(url),false);});
test('manifest validation, archive checksum and redirect policy protect updates',async t=>{
 const https=require('node:https');const {PassThrough}=require('node:stream');const {EventEmitter}=require('node:events');const crypto=require('node:crypto');const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');const updater=require('../src/update.cjs');
 const original=https.get;let body,status=200,location;
 https.get=(url,options,callback)=>{const request=new EventEmitter();request.setTimeout=()=>{};request.destroy=e=>request.emit('error',e);process.nextTick(()=>{const res=new PassThrough();res.statusCode=status;res.headers={location};callback(res);res.end(body);});return request;};
 t.after(()=>https.get=original);
 const bytes=Buffer.from('release zip bytes');const manifest={version:'0.2.0',url:'https://github.com/Admutium/ContactRegistry/releases/download/v0.2.0/ContactRegistry-0.2.0-win-x64.zip',sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
 body=JSON.stringify(manifest);const update=await updater.check('0.1.0');assert.equal(update.version,'0.2.0');assert.equal(await updater.check('0.2.0'),null);
 body=JSON.stringify({...manifest,url:'https://github.com/other/repo/archive.zip'});await assert.rejects(()=>updater.check('0.1.0'),/манифест/);
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'update-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const file=path.join(dir,'update.zip');
 body=bytes;await updater.fetchArchive(update,file);assert.deepEqual(await fs.readFile(file),bytes);
 body=Buffer.from('tampered');await assert.rejects(()=>updater.fetchArchive(update,path.join(dir,'bad.zip')),/сумма/);await assert.rejects(()=>fs.access(path.join(dir,'bad.zip')),{code:'ENOENT'});
 status=302;location='https://evil.example/archive.zip';await assert.rejects(()=>updater.fetchArchive(update,path.join(dir,'redirect.zip')),/адрес/);
});
