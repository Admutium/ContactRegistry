const fs = require('node:fs/promises');
const path = require('node:path');
const {spawn} = require('node:child_process');
async function waitForReady({ready,result,child,timeout=120000}) {
  const deadline=Date.now()+timeout;
  let failure;
  const onError=error=>{failure=error;};
  child.on('error',onError);
  try {
    while(Date.now()<deadline) {
      let outcome;
      try { outcome=JSON.parse((await fs.readFile(result,'utf8')).replace(/^\uFEFF/,'')); } catch(e) { if(e.code!=='ENOENT') throw e; }
      if(outcome && outcome.status!=='installed') throw Error(`Не удалось подготовить обновление: ${outcome.message}\nЖурнал: ${outcome.log}`);
      if(failure) throw failure;
      if(child.exitCode!==null && child.exitCode!==undefined) throw Error(`Установщик завершился с кодом ${child.exitCode}. Приложение остаётся открытым.`);
      try { await fs.access(ready); return; } catch(e) { if(e.code!=='ENOENT') throw e; }
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    throw Error('Установщик не подтвердил готовность. Приложение остаётся открытым.');
  } finally { child.removeListener('error',onError); }
}
async function prepare({directory,archive,target,exe,version,userData,pid=process.pid}) {
  const result=path.join(directory,'result.json');
  const ready=path.join(directory,'ready');
  const proceed=path.join(directory,'proceed');
  const cancel=path.join(directory,'cancel');
  const log=path.join(userData,'last-update.log');
  await fs.writeFile(log,`Preparing ContactRegistry ${version}\n`);
  const config={directory,archive,target,exe,version,pid,ready,proceed,cancel,result,log};
  const configFile=path.join(directory,'config.json');
  const script=path.join(directory,'install.ps1');
  await fs.writeFile(configFile,JSON.stringify(config));
  // Windows PowerShell 5.1 otherwise reads non-ASCII source using the ANSI code page.
  await fs.writeFile(script,'\uFEFF'+await fs.readFile(path.join(__dirname,'install-update.ps1'),'utf8'));
  const executable=path.join(process.env.SystemRoot || 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const launchLog=path.join(userData,'last-update-launch.log');
  const output=await fs.open(launchLog,'w');
  let child,readiness;
  try { child=spawn(executable,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-ConfigPath',configFile],{detached:true,stdio:['ignore',output.fd,output.fd],windowsHide:true,cwd:directory});readiness=waitForReady({ready,result,child});readiness.catch(()=>{}); }
  finally { await output.close(); }
  try { await readiness; }
  catch(e) { await fs.writeFile(cancel,'cancel').catch(()=>{}); child.unref(); throw Error(`${e.message}\nЖурнал: ${log}\nВывод PowerShell: ${launchLog}`); }
  child.unref();
  return {log,result,proceed:()=>fs.writeFile(proceed,'install')};
}
module.exports={prepare,waitForReady};
