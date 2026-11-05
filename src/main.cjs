const {app,BrowserWindow,ipcMain,dialog,shell,clipboard,nativeTheme} = require('electron');
const path=require('node:path');
const fs=require('node:fs/promises');
const os=require('node:os');
const {spawn}=require('node:child_process');
const {Store}=require('./store.cjs');
const updates=require('./update.cjs');
let win,store,config,configFile,pendingUpdate;
let freshConfig=false;
if(!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});
async function persist(next) {
  const temp=configFile+'.tmp'; await fs.writeFile(temp,JSON.stringify(next,null,2)); await fs.rename(temp,configFile); config=next;
}
function handle(name,fn) {
  ipcMain.handle(name,async(event,...args)=>{
    if(event.sender!==win.webContents || event.senderFrame!==win.webContents.mainFrame) throw Error('Недопустимый запрос.');
    try { return {ok:true,data:await fn(...args)}; } catch(e) { return {ok:false,error:e.message}; }
  });
}
function ps(value) { return "'"+value.replace(/'/g,"''")+"'"; }
app.whenReady().then(async()=>{
  configFile=path.join(app.getPath('userData'),'settings.json');
  await fs.mkdir(path.dirname(configFile),{recursive:true});
  try { config=JSON.parse(await fs.readFile(configFile,'utf8')); } catch(e) { if(e.code!=='ENOENT') dialog.showErrorBox('Настройки','Не удалось прочитать настройки. Используется локальная папка данных.'); config={}; freshConfig=e.code==='ENOENT'; }
  config={directory:config.directory||path.join(app.isPackaged?path.dirname(app.getPath('exe')):app.getPath('userData'),'ContactRegistryData'),theme:config.theme||'light',autoCheck:config.autoCheck!==false};
  store=new Store(config.directory);
  // Initialization never silently switches away from the selected network database.
  let startupError;
  try { await fs.access(store.file); } catch(e) { if(e.code==='ENOENT' && freshConfig) { try{await store.ensure();await persist(config);}catch(err){startupError=err.message;} } else startupError=e.message; }
  win=new BrowserWindow({width:1380,height:900,minWidth:980,minHeight:680,backgroundColor:'#f5f7fb',autoHideMenuBar:true,title:'Контактная книга',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',e=>e.preventDefault());
  handle('init',()=>({...config,version:app.getVersion(),platform:process.platform,startupError}));
  handle('read',()=>store.read());
  handle('save',input=>store.save(input));
  handle('remove',(id,updated)=>store.remove(id,updated));
  handle('link',(source,target,role)=>store.link(source,target,role));
  handle('unlink',id=>store.unlink(id));
  handle('copy',text=>clipboard.writeText(String(text)));
  handle('theme',async theme=>{if(!['light','dark'].includes(theme))throw Error('Неверная тема');await persist({...config,theme});nativeTheme.themeSource=theme;});
  handle('autoCheck',async value=>persist({...config,autoCheck:!!value}));
  handle('folder',async()=>{
    const result=await dialog.showOpenDialog(win,{title:'Папка общей базы (локальная или сетевая)',properties:['openDirectory','createDirectory']});
    if(result.canceled)return null;
    const directory=result.filePaths[0]; const next=new Store(directory);
    let exists=true;try{await fs.access(next.file);}catch(e){if(e.code==='ENOENT')exists=false;else throw e;}
    const answer=await dialog.showMessageBox(win,{type:'question',buttons:['Отмена',exists?'Подключить базу':'Создать пустую базу'],defaultId:0,cancelId:0,message:exists?'Подключить существующую базу?':'Создать новую базу в выбранной папке?',detail:'Текущая база останется на прежнем месте. Данные не объединяются и не переносятся автоматически. Для нескольких ПК выберите одну общую папку на каждом компьютере.'});
    if(answer.response!==1)return null;
    if(exists)await next.read();else await next.ensure();
    await persist({...config,directory}); store=next;return directory;
  });
  handle('backup',async()=>{
    const result=await dialog.showSaveDialog(win,{title:'Резервная копия базы',defaultPath:`contacts-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite`,filters:[{name:'SQLite',extensions:['sqlite']}]});
    if(result.canceled)return false;await store.backup(result.filePath);return true;
  });
  handle('checkUpdate',async()=>{pendingUpdate=await updates.check(app.getVersion());return pendingUpdate;});
  handle('installUpdate',async()=>{
    if(!pendingUpdate)throw Error('Сначала проверьте обновления.');
    if(process.platform!=='win32'||!app.isPackaged)throw Error('Установка обновлений доступна в переносимой сборке Windows.');
    const approval=await dialog.showMessageBox(win,{type:'question',buttons:['Отмена','Установить и перезапустить'],defaultId:0,cancelId:0,message:`Установить версию ${pendingUpdate.version}?`,detail:'Приложение закроется после загрузки. Контакты хранятся отдельно от файлов программы. Не выключайте компьютер во время установки.'});
    if(approval.response!==1)return false;
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'contactregistry-update-'));
    const archive=path.join(directory,'update.zip');await updates.fetchArchive(pendingUpdate,archive);
    const target=path.dirname(app.getPath('exe'));await fs.access(target,require('node:fs').constants.W_OK);
    const script=path.join(directory,'install.ps1');
    await fs.writeFile(script,`$ErrorActionPreference = 'Stop'\ntry {\nWait-Process -Id ${process.pid} -ErrorAction SilentlyContinue\nStart-Sleep -Seconds 2\nExpand-Archive -LiteralPath ${ps(archive)} -DestinationPath ${ps(path.join(directory,'unpacked'))}\nif (!(Test-Path -LiteralPath ${ps(path.join(directory,'unpacked','ContactRegistry.exe'))})) { throw 'Invalid update archive' }\nCopy-Item -Path ${ps(path.join(directory,'unpacked','*'))} -Destination ${ps(target)} -Recurse -Force\nStart-Process -FilePath ${ps(app.getPath('exe'))}\n} catch { $_ | Out-File -FilePath ${ps(path.join(directory,'error.txt'))}; Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('Update failed. Extract the release ZIP manually into the application folder. Your contact database is unchanged.'); }\n`);
    const child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script],{detached:true,stdio:'ignore',windowsHide:true});
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();app.quit();return true;
  });
  await win.loadFile(path.join(__dirname,'index.html'));
  nativeTheme.themeSource=config.theme;
}).catch(e=>{dialog.showErrorBox('Ошибка запуска',e.message);app.quit();});
app.on('window-all-closed',()=>app.quit());
