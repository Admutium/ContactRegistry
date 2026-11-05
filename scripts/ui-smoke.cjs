// Run with: node scripts/ui-smoke.cjs. Uses the actual persistence layer behind a browser bridge.
const {chromium}=require('playwright');const {Store}=require('../src/store.cjs');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');const assert=require('node:assert/strict');
(async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'registry-ui-'));const store=new Store(directory);await store.ensure();
 const server=require('node:http').createServer(async(req,res)=>{try{const name=({'/':'index.html','/style.css':'style.css','/renderer.js':'renderer.js'})[req.url];if(!name){res.writeHead(404);return res.end();}res.setHeader('Content-Type',name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':'text/html');res.end(await fs.readFile(path.resolve(__dirname,'../src',name)));}catch(e){res.writeHead(500);res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||(process.platform==='linux'?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.exposeFunction('bridge',async(name,...args)=>{
   if(name==='init')return {directory,theme:'light',autoCheck:false,version:'0.1.0'};
   if(name==='read')return store.read();if(name==='save')return store.save(...args);if(name==='remove')return store.remove(...args);if(name==='link')return store.link(...args);if(name==='unlink')return store.unlink(...args);if(name==='theme'||name==='copy')return;
   throw Error(`Unexpected bridge method ${name}`);
  });
  await page.addInitScript(()=>{window.registry=new Proxy({},{get:(_,name)=>(...args)=>window.bridge(name,...args)});});
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('heading',{name:'Начните с первого контакта'}).waitFor();
  await page.locator('#add-contact').click();await page.locator('[name="name"]').fill('Анна Смирнова');await page.locator('[name="position"]').fill('Директор');await page.locator('[name="phones"]').fill('+7 (900) 123-45-67');await page.locator('[name="emails"]').fill('anna@example.ru');await page.locator('[name="tags"]').fill('Партнёры, Важное');await page.locator('[name="notes"]').fill('Обсудить новый договор');await page.locator('#save-contact').click();await page.locator('#detail h2').filter({hasText:'Анна Смирнова'}).waitFor();
  await page.locator('#add-contact').click();await page.locator('input[name="kind"][value="organization"]').check();await page.locator('[name="name"]').fill('ООО «Север»');await page.locator('[name="fullName"]').fill('Общество с ограниченной ответственностью «Север»');await page.locator('[name="inn"]').fill('7701234567');await page.locator('[name="kpp"]').fill('770101001');await page.locator('[name="bank"]').fill('Банк Пример');await page.locator('[name="account"]').fill('40702810000000000001');await page.locator('[name="tags"]').fill('Партнёры');await page.locator('#save-contact').click();await page.locator('#detail h2').filter({hasText:'ООО «Север»'}).waitFor();
  await page.locator('#add-link').click();await page.locator('#link-role').fill('Директор');await page.locator('#link-form button[type="submit"]').click();await page.locator('.relation-open').filter({hasText:'Анна Смирнова'}).waitFor();
  await page.locator('#search').fill('900123');await page.locator('.contact-row').filter({hasText:'Анна Смирнова'}).waitFor();assert.equal(await page.locator('.contact-row').count(),1);
  await page.locator('#search').fill('');await page.locator('.contact-row').filter({hasText:'Анна Смирнова'}).click();
  await page.locator('#edit-selected').click();await page.locator('[name="name"]').fill('Анна Петрова');await page.locator('#save-contact').click();await page.locator('#detail h2').filter({hasText:'Анна Петрова'}).waitFor();
  // A second computer edits the card while this editor is open.
  await page.locator('#edit-selected').click();const current=(await store.read()).contacts.find(c=>c.name==='Анна Петрова');await store.save({...current,notes:'Изменено на втором ПК'});await page.locator('[name="notes"]').fill('Устаревшая правка');await page.locator('#save-contact').click();await page.locator('#form-error').filter({hasText:'другом ПК'}).waitFor();await page.locator('[data-close="editor"]').first().click();await page.locator('#refresh').click();
  await page.locator('#theme-toggle').click();assert.ok(await page.locator('body').evaluate(el=>el.classList.contains('dark')));await page.locator('#theme-toggle').click();
  await fs.mkdir(path.resolve(__dirname,'../.local'),{recursive:true});await page.screenshot({path:path.resolve(__dirname,'../.local/screenshot.png'),fullPage:true});
  await page.locator('#delete-selected').click();await page.locator('#confirm-accept').click();await page.locator('#detail h2').filter({hasText:'ООО «Север»'}).waitFor();assert.equal((await store.read()).relations.length,0);assert.equal((await store.read()).contacts.length,1);
  assert.deepEqual(errors,[]);console.log('UI smoke passed: create person + company, requisites, relation, phone search, edit, cross-PC conflict, theme, delete + cascade.');
 }finally{server.close();await browser.close();await fs.rm(directory,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
