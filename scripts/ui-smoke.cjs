// Run with: node scripts/ui-smoke.cjs. Uses the actual persistence layer behind a browser bridge.
const {chromium}=require('playwright');const {Store}=require('../src/store.cjs');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');const assert=require('node:assert/strict');
(async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'registry-ui-'));const store=new Store(directory);await store.ensure();
 const server=require('node:http').createServer(async(req,res)=>{try{const name=({'/':'index.html','/style.css':'style.css','/renderer.js':'renderer.js'})[req.url];if(!name){res.writeHead(404);return res.end();}res.setHeader('Content-Type',name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':'text/html');res.end(await fs.readFile(path.resolve(__dirname,'../src',name)));}catch(e){res.writeHead(500);res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||(process.platform==='linux'?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox']});
 try{
  let savedTheme='light';
  const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.exposeFunction('bridge',async(name,...args)=>{
   if(name==='init')return {directory,theme:savedTheme,platform:'win32',autoCheck:false,version:require('../package.json').version};
   if(name==='read')return store.read();if(name==='save')return store.save(...args);if(name==='remove')return store.remove(...args);if(name==='link')return store.link(...args);if(name==='unlink')return store.unlink(...args);if(name==='theme'){savedTheme=args[0];return;}if(name==='copy')return;
   throw Error(`Unexpected bridge method ${name}`);
  });
  await page.addInitScript(()=>{window.registry=new Proxy({},{get:(_,name)=>(...args)=>window.bridge(name,...args)});});
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('heading',{name:'Начните с первого контакта'}).waitFor();
  await page.locator('#add-contact').click();await page.locator('[name="name"]').fill('Анна Смирнова');await page.locator('[name="position"]').fill('Директор');await page.locator('[name="phones"]').fill('+7 (900) 123-45-67');await page.locator('[name="emails"]').fill('anna@example.ru');await page.locator('[name="tags"]').fill('Партнёры, Важное');await page.locator('[name="notes"]').fill('Обсудить новый договор');await page.locator('#save-contact').click();await page.locator('#detail h2').filter({hasText:'Анна Смирнова'}).waitFor();
  await page.locator('#add-contact').click();await page.locator('input[name="kind"][value="organization"]').check();await page.locator('[name="name"]').fill('ООО «Север»');await page.locator('[name="fullName"]').fill('Общество с ограниченной ответственностью «Север»');await page.locator('[name="inn"]').fill('7701234567');await page.locator('[name="kpp"]').fill('770101001');await page.locator('[name="bank"]').fill('Банк Пример');await page.locator('[name="account"]').fill('40702810000000000001');await page.locator('[name="tags"]').fill('Партнёры');await page.locator('#save-contact').click();await page.locator('#detail h2').filter({hasText:'ООО «Север»'}).waitFor();
  await page.locator('#add-link').click();await page.locator('#link-role').fill('Директор');await page.locator('#link-form button[type="submit"]').click();await page.locator('.relation-open').filter({hasText:'Анна Смирнова'}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('#link-dialog').open);await page.locator('#search').fill('900123');await page.locator('.contact-row').filter({hasText:'Анна Смирнова'}).waitFor();assert.equal(await page.locator('.contact-row').count(),1);
  await page.locator('#search').fill('');await page.locator('.contact-row').filter({hasText:'Анна Смирнова'}).click();
  await page.locator('#edit-selected').click();await page.locator('[name="name"]').fill('Анна Петрова');await page.locator('#save-contact').click();await page.locator('#detail h2').filter({hasText:'Анна Петрова'}).waitFor();
  // A second computer edits the card while this editor is open.
  await page.locator('#edit-selected').click();const current=(await store.read()).contacts.find(c=>c.name==='Анна Петрова');await store.save({...current,notes:'Изменено на втором ПК'});await page.locator('[name="notes"]').fill('Устаревшая правка');await page.locator('#save-contact').click();await page.locator('#form-error').filter({hasText:'другом ПК'}).waitFor();await page.locator('[data-close="editor"]').first().click();await page.locator('#refresh').click();
  await page.locator('#theme-toggle').click();
  await page.waitForTimeout(250);
  // Check visible colors and contrast, not just the theme class.
  const dark=await page.evaluate(()=>{
    const style=selector=>getComputedStyle(document.querySelector(selector));
    const rgb=value=>value.match(/[\d.]+/g).slice(0,3).map(Number);
    const luminance=color=>rgb(color).map(c=>{c/=255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;}).reduce((sum,c,i)=>sum+c*[0.2126,0.7152,0.0722][i],0);
    const contrast=(foreground,background)=>{const a=luminance(foreground),b=luminance(background);return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);};
    const checks=[['h1','body'],['.stat-card strong','.stat-card'],['.stat-card div>span','.stat-card'],['.detail h2','.contact-panel'],['.nav-item:not(.active)','.sidebar'],['.note','.detail'],['.primary','.primary']];
    return {root:style('html').backgroundColor,body:style('body').backgroundColor,contrast:checks.map(([text,bg])=>({selector:text,ratio:contrast(style(text).color,style(bg).backgroundColor==='rgba(0, 0, 0, 0)'?style('.contact-panel').backgroundColor:style(bg).backgroundColor)}))};
  });
  assert.equal(await page.locator('#window-titlebar').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(32, 34, 46)');
  assert.equal(dark.root,'rgb(24, 26, 35)');assert.equal(dark.body,dark.root);
  for(const check of dark.contrast)assert.ok(check.ratio>=4.5,`${check.selector} dark contrast ${check.ratio}`);
  await page.locator('#edit-selected').click();
  assert.equal(await page.locator('#editor').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(32, 34, 46)');
  assert.equal(await page.locator('[name="name"]').evaluate(el=>getComputedStyle(el).color),'rgb(238, 238, 245)');
  await page.locator('[data-close="editor"]').first().click();
  await page.locator('#settings').click();
  assert.equal(await page.locator('#settings-dialog').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(32, 34, 46)');
  await page.locator('[data-close="settings-dialog"]').click();
  await fs.mkdir(path.resolve(__dirname,'../.local'),{recursive:true});
  await page.screenshot({path:path.resolve(__dirname,'../.local/dark-theme.png'),fullPage:true});
  await page.reload();await page.locator('#detail h2').waitFor();
  assert.equal(await page.locator('html').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(24, 26, 35)');
  await page.locator('.contact-row').filter({hasText:'Анна Петрова'}).click();
  await page.locator('#theme-toggle').click();
  assert.equal(await page.locator('html').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(246, 247, 251)');
  await fs.mkdir(path.resolve(__dirname,'../.local'),{recursive:true});await page.screenshot({path:path.resolve(__dirname,'../.local/screenshot.png'),fullPage:true});
  await page.locator('#delete-selected').click();await page.locator('#confirm-accept').click();await page.locator('#detail h2').filter({hasText:'ООО «Север»'}).waitFor();assert.equal((await store.read()).relations.length,0);assert.equal((await store.read()).contacts.length,1);
  assert.deepEqual(errors,[]);console.log('UI smoke passed: create person + company, requisites, relation, phone search, edit, cross-PC conflict, dark backgrounds + contrast + dialogs + persisted preference, delete + cascade.');
 }catch(e){const pages=browser.contexts().flatMap(c=>c.pages());if(pages[0]){await fs.mkdir(path.resolve(__dirname,'../.local'),{recursive:true});await pages[0].screenshot({path:path.resolve(__dirname,'../.local/ui-failure.png'),fullPage:true});console.error(await pages[0].locator('body').innerText());}throw e;}finally{server.close();await browser.close();await fs.rm(directory,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
