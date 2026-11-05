const crypto = require('node:crypto');
const https = require('node:https');
const fs = require('node:fs/promises');
const REPO = 'Admutium/ContactRegistry';
const MANIFEST = `https://github.com/${REPO}/releases/latest/download/update.json`;
function allowed(url) {
  const u = new URL(url);
  return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port==='443') &&
    (u.hostname === 'github.com' || u.hostname === 'release-assets.githubusercontent.com' || u.hostname === 'objects.githubusercontent.com');
}
function download(url, limit = 1024*1024, redirects = 0) {
  if(!allowed(url) || redirects>5) return Promise.reject(Error('Недопустимый адрес обновления.'));
  return new Promise((resolve,reject)=>{
    const request = https.get(url,{'headers':{'User-Agent':'ContactRegistry'}},res=>{
      if([301,302,303,307,308].includes(res.statusCode)) { res.resume(); return download(new URL(res.headers.location,url).href,limit,redirects+1).then(resolve,reject); }
      if(res.statusCode!==200) { res.resume(); return reject(Error(res.statusCode===404?'Опубликованных обновлений пока нет.':`Сервер обновлений ответил: ${res.statusCode}`)); }
      const chunks=[]; let size=0;
      res.on('data',chunk=>{size+=chunk.length; if(size>limit) res.destroy(Error('Файл обновления слишком большой.')); else chunks.push(chunk);});
      res.on('end',()=>resolve(Buffer.concat(chunks))); res.on('error',reject);
    });
    request.setTimeout(30000,()=>request.destroy(Error('Время ожидания обновления истекло.')));
    request.on('error',reject);
  });
}
function isNewer(next,current) {
  if(!/^\d+\.\d+\.\d+$/.test(next)) return false;
  const a=next.split('.').map(Number), b=current.split('.').map(Number);
  for(let i=0;i<3;i++) { if(a[i]>b[i]) return true; if(a[i]<b[i]) return false; } return false;
}
async function check(current) {
  const data=JSON.parse((await download(MANIFEST)).toString('utf8'));
  if(!isNewer(data.version,current)) return null;
  const expected=`https://github.com/${REPO}/releases/download/v${data.version}/ContactRegistry-${data.version}-win-x64.zip`;
  if(data.url!==expected || !/^[a-f0-9]{64}$/i.test(data.sha256)) throw Error('Некорректный манифест обновления.');
  return {version:data.version,url:expected,sha256:data.sha256.toLowerCase()};
}
async function fetchArchive(update,destination) {
  const bytes=await download(update.url,350*1024*1024);
  if(crypto.createHash('sha256').update(bytes).digest('hex')!==update.sha256) throw Error('Контрольная сумма обновления не совпала. Установка отменена.');
  await fs.writeFile(destination,bytes,{flag:'wx'});
}
module.exports={check,fetchArchive,isNewer,allowed};
