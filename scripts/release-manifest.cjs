const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const {version}=require('../package.json');
const name=`ContactRegistry-${version}-win-x64.zip`;const file=path.join(__dirname,'../dist',name);
const sha256=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
fs.writeFileSync(path.join(__dirname,'../dist/update.json'),JSON.stringify({version,url:`https://github.com/Admutium/ContactRegistry/releases/download/v${version}/${name}`,sha256},null,2)+'\n');
console.log(`Manifest created for ${name}`);
