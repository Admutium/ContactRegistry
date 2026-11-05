'use strict';
const api=window.registry;
const $=selector=>document.querySelector(selector);
const $$=selector=>[...document.querySelectorAll(selector)];
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state={contacts:[],relations:[],filter:'all',tag:null,search:'',selected:null,config:null,editing:null,loading:false,unavailable:false};
let toastTimer;
function toast(message,error=false){const el=$('#toast');el.textContent=message;el.classList.toggle('error-toast',error);el.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.hidden=true,error?10000:3500);}
function initials(c){return c.name.split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase();}
function avatar(c){return `<span class="avatar ${c.kind}">${escape(initials(c))}</span>`;}
function linkedOrganizations(c){return state.relations.filter(r=>r.source===c.id||r.target===c.id).map(r=>state.contacts.find(x=>x.id===(r.source===c.id?r.target:r.source))).filter(x=>x?.kind==='organization').map(x=>x.name);}
function subtitle(c){return c.kind==='person'?[c.position,...linkedOrganizations(c)].filter(Boolean).join(' · ')||c.emails[0]||c.phones[0]||'Человек':c.inn?`ИНН ${c.inn}`:c.fullName||'Организация / ИП';}
function filtered(){let list=state.contacts.filter(c=>(state.filter==='all'||c.kind===state.filter)&&(!state.tag||c.tags.includes(state.tag)));const q=state.search.trim().toLocaleLowerCase('ru');if(q){const digits=q.replace(/[^\d+]/g,'');list=list.filter(c=>[c.name,c.position,c.fullName,c.inn,c.notes,...c.tags,...c.phones,...c.emails,...linkedOrganizations(c)].join(' ').toLocaleLowerCase('ru').includes(q)||(digits.length>=3&&c.phones.some(p=>p.replace(/[^\d+]/g,'').includes(digits))));}return list.sort((a,b)=>a.name.localeCompare(b.name,'ru')*($('#sort').value==='desc'?-1:1));}
function setFilter(filter){state.filter=filter;state.tag=null;render();}
function render(){
 const labels={all:'Все контакты',person:'Люди',organization:'Организации'};
 for(const key of ['all','person','organization']){const n=state.contacts.filter(c=>key==='all'||c.kind===key).length;$('#count-'+key).textContent=n;$('#stat-'+key).textContent=n;}
 $$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.filter===state.filter));
 $('#breadcrumb').textContent=labels[state.filter];$('#page-title').innerHTML=escape(state.tag||labels[state.filter])+'<span class="heading-dot">.</span>';
 $('#page-description').textContent=state.tag?'Все контакты с выбранным тегом.':{all:'Люди, компании и связи между ними.',person:'Личные и рабочие контакты в одном месте.',organization:'Компании, реквизиты и люди, с которыми вы работаете.'}[state.filter];
 const tags=[...new Set(state.contacts.flatMap(c=>c.tags))].sort((a,b)=>a.localeCompare(b,'ru'));
 $('#tag-count').textContent=tags.length;
 $('#tag-list').innerHTML=tags.length?tags.map(t=>`<button class="tag-button ${state.tag===t?'active':''}" data-tag="${escape(t)}"><span class="tag-dot"></span>${escape(t)}</button>`).join(''):'<p class="tag-empty">Добавляйте теги в карточках,<br>чтобы находить нужное быстрее.</p>';
 $$('#tag-list button').forEach(b=>b.onclick=()=>{state.tag=state.tag===b.dataset.tag?null:b.dataset.tag;render();});
 const list=filtered();
 if(!list.some(c=>c.id===state.selected))state.selected=list[0]?.id||null;
 $('#results-count').textContent=`Найдено: ${list.length}`;
 $('#clear-filter').hidden=!state.tag&&!state.search&&state.filter==='all';
 if(state.unavailable){$('#contact-list').innerHTML='<div class="empty-state"><span class="empty-icon">!</span><h3>База недоступна</h3><p>Проверьте подключение сетевого диска или выберите папку базы в настройках.</p><button id="retry-read" class="secondary">Повторить загрузку</button></div>';$('#retry-read').onclick=()=>refresh();$('#detail').innerHTML='';return;}
 $('#contact-list').innerHTML=list.length?list.map(c=>`<button class="contact-row ${c.id===state.selected?'selected':''}" data-id="${escape(c.id)}">${avatar(c)}<span class="row-text"><strong>${escape(c.name)}</strong><span class="row-subtitle">${escape(subtitle(c))}</span></span>${c.tags[0]?`<span class="row-tag">${escape(c.tags[0])}</span>`:''}<span class="row-arrow">›</span></button>`).join(''):`<div class="empty-state"><span class="empty-icon">${state.contacts.length?'⌕':'＋'}</span><h3>${state.contacts.length?'Ничего не найдено':'Начните с первого контакта'}</h3><p>${state.contacts.length?'Попробуйте другое имя, телефон или измените фильтры.':'Добавьте человека или организацию. Все данные останутся у вас.'}</p>${state.contacts.length?'':'<button class="primary" id="empty-add">Добавить контакт</button>'}</div>`;
 $$('.contact-row').forEach(b=>b.onclick=()=>{state.selected=b.dataset.id;render();});
 if($('#empty-add'))$('#empty-add').onclick=()=>edit();
 renderDetail();
}
function field(label,value){if(!value)return '';return `<div class="detail-field"><div class="field-content"><small>${escape(label)}</small><div class="field-value">${escape(value)}</div></div><button class="copy-button" data-copy="${escape(value)}" aria-label="Копировать ${escape(label)}" title="Копировать">⧉</button></div>`;}
const requisites=[['fullName','Полное наименование'],['inn','ИНН'],['kpp','КПП'],['ogrn','ОГРН / ОГРНИП'],['legalAddress','Юридический адрес'],['postalAddress','Почтовый адрес'],['bank','Банк'],['bik','БИК'],['account','Расчётный счёт'],['correspondentAccount','Корреспондентский счёт']];
function renderDetail(){
 const c=state.contacts.find(c=>c.id===state.selected);
 if(!c){$('#detail').innerHTML='<div class="empty-state"><span class="empty-icon">◈</span><h3>Здесь будет карточка контакта</h3><p>Телефоны, реквизиты и полезные связи — всё под рукой.</p></div>';return;}
 const rels=state.relations.filter(r=>r.source===c.id||r.target===c.id);
 const related=rels.map(r=>{const other=state.contacts.find(x=>x.id===(r.source===c.id?r.target:r.source));if(!other)return '';return `<div class="relation">${avatar(other)}<button class="relation-open" data-open="${escape(other.id)}"><strong>${escape(other.name)}</strong><small>${escape(r.role)}${r.target===c.id?' · входящая связь':''}</small></button><button class="copy-button" data-unlink="${escape(r.id)}" title="Удалить связь" aria-label="Удалить связь">×</button></div>`;}).join('');
 const reqs=requisites.map(([key,label])=>field(label,c[key])).join('');
 $('#detail').innerHTML=`<div class="detail-head">${avatar(c)}<div class="detail-heading"><div class="type-label">${c.kind==='person'?'Человек':'Организация / ИП'}</div><h2>${escape(c.name)}</h2><div class="detail-subtitle">${escape(subtitle(c))}</div></div></div><div class="detail-actions"><button id="edit-selected" class="secondary">✎ Редактировать</button>${c.kind==='organization'?'<button id="copy-requisites" class="secondary">⧉ Реквизиты</button>':''}<button id="delete-selected" class="icon-button" title="Удалить контакт" aria-label="Удалить контакт">×</button></div>${c.tags.length?'<div class="detail-tags">'+c.tags.map(t=>`<span class="pill">${escape(t)}</span>`).join('')+'</div>':''}<div class="detail-section"><div class="section-heading"><h3>Контактные данные</h3></div>${c.phones.map((p,i)=>field(`Телефон${c.phones.length>1?' '+(i+1):''}`,p)).join('')}${c.emails.map((e,i)=>field(`Электронная почта${c.emails.length>1?' '+(i+1):''}`,e)).join('')}${field('Сайт',c.website)}${!c.phones.length&&!c.emails.length&&!c.website?'<p class="muted">Телефоны и почта ещё не добавлены.</p>':''}</div>${c.kind==='organization'?`<div class="detail-section"><div class="section-heading"><h3>Реквизиты</h3></div>${reqs||'<p class="muted">Добавьте реквизиты для договоров.</p>'}</div>`:''}<div class="detail-section"><div class="section-heading"><h3>Связанные контакты · ${rels.length}</h3><button class="text-button" id="add-link">＋ Добавить</button></div>${related||'<p class="muted">Свяжите контакт с человеком или организацией.</p>'}</div>${c.notes?`<div class="detail-section"><div class="section-heading"><h3>Заметки</h3></div><div class="note">${escape(c.notes)}</div></div>`:''}`;
 $('#edit-selected').onclick=()=>edit(c);
 $('#delete-selected').onclick=async()=>{if(await confirmDelete('Удалить контакт?',`«${c.name}» и все его связи будут удалены. Перед удалением можно сохранить резервную копию в настройках.`)){try{await api.remove(c.id,c.updated);await refresh();toast('Контакт удалён');}catch(e){toast(e.message,true);}}};
 if($('#copy-requisites'))$('#copy-requisites').onclick=()=>copy([c.name,...requisites.filter(([key])=>c[key]).map(([key,label])=>`${label}: ${c[key]}`)].join('\n'));
 $$('[data-copy]').forEach(b=>b.onclick=()=>copy(b.dataset.copy));
 $$('[data-open]').forEach(b=>b.onclick=()=>{state.filter='all';state.tag=null;state.search='';$('#search').value='';state.selected=b.dataset.open;render();});
 $$('[data-unlink]').forEach(b=>b.onclick=async()=>{if(await confirmDelete('Удалить связь?','Оба контакта останутся в базе.'))try{await api.unlink(b.dataset.unlink);await refresh();toast('Связь удалена');}catch(e){toast(e.message,true);}});
 $('#add-link').onclick=()=>openLink(c);
}
async function copy(value){try{await api.copy(value);toast('Скопировано');}catch(e){toast(e.message,true);}}
function confirmDelete(title,description){$('#confirm-title').textContent=title;$('#confirm-description').textContent=description;$('#confirm-dialog').showModal();return new Promise(resolve=>{let resolved=false;const finish=value=>{if(resolved)return;resolved=true;$('#confirm-dialog').close();$('#confirm-dialog').oncancel=null;resolve(value);};$('#confirm-accept').onclick=()=>finish(true);$('#confirm-cancel').onclick=()=>finish(false);$('#confirm-dialog').oncancel=e=>{e.preventDefault();finish(false);};});}
const commonFields=[['phones','Телефоны','+7 (999) 123-45-67','Несколько номеров — по одному на строку.'],['emails','Электронная почта','name@company.ru','Несколько адресов — по одному на строку.'],['website','Сайт','company.ru'],['tags','Теги','Клиенты, Партнёры','Разделяйте теги запятыми.']];
let editorDraft={};
function readForm(){const result={};$$('#form-fields [name]').forEach(el=>result[el.name]=el.value);return result;}
function renderForm(kind){
 const fields=[['name',kind==='person'?'ФИО *':'Название организации / ИП *',kind==='person'?'Иван Петров':'ООО «Название»']];
 if(kind==='person')fields.push(['position','Должность','Например: руководитель отдела']);
 else fields.push(...requisites.map(([key,label])=>[key,label,'']));
 fields.push(...commonFields,['notes','Заметки','Что важно помнить об этом контакте']);
 $('#form-fields').innerHTML=fields.map(([key,label,placeholder,hint])=>{const multiline=['phones','emails','notes'].includes(key);return `<label class="field ${['name','notes','fullName','legalAddress','postalAddress'].includes(key)?'wide':''}">${escape(label)}${multiline?`<textarea name="${key}" rows="${key==='notes'?3:2}" placeholder="${escape(placeholder)}" maxlength="20000">${escape(editorDraft[key]||'')}</textarea>`:`<input name="${key}" value="${escape(editorDraft[key]||'')}" placeholder="${escape(placeholder)}" ${key==='name'?'required maxlength="300"':'maxlength="20000"'} ${['inn','kpp','ogrn','bik','account','correspondentAccount'].includes(key)?'inputmode="numeric"':''}>`}${hint?`<small>${escape(hint)}</small>`:''}</label>`;}).join('');
 $('#form-fields [name="name"]').oninput=duplicateCheck;
 $('#form-fields [name="inn"]')?.addEventListener('input',duplicateCheck);
 duplicateCheck();
}
function duplicateCheck(){const values=readForm();const match=state.contacts.find(c=>c.id!==state.editing?.id&&(c.name.toLocaleLowerCase('ru')===values.name?.trim().toLocaleLowerCase('ru')||(values.inn&&c.inn===values.inn.trim())));$('#duplicate-warning').hidden=!match;$('#duplicate-warning').textContent=match?`Похожий контакт уже есть: ${match.name}. Проверьте, не создаёте ли вы дубликат.`:'';}
function edit(c){state.editing=c?structuredClone(c):null;editorDraft=c?{...c,phones:c.phones.join('\n'),emails:c.emails.join('\n'),tags:c.tags.join(', ')}:{};const kind=c?.kind||(state.filter==='organization'?'organization':'person');$('#editor-title').textContent=c?'Редактировать контакт':'Новый контакт';$$('input[name="kind"]').forEach(r=>{r.checked=r.value===kind;r.disabled=!!c;});$('#form-error').textContent='';renderForm(kind);$('#editor').showModal();setTimeout(()=>$('#form-fields [name="name"]').focus(),60);}
$$('input[name="kind"]').forEach(r=>r.onchange=()=>{editorDraft={...editorDraft,...readForm()};renderForm(r.value);});
$('#contact-form').onsubmit=async event=>{event.preventDefault();const button=$('#save-contact');button.disabled=true;$('#form-error').textContent='';try{const values=readForm();const payload={...state.editing,...values,kind:$('input[name="kind"]:checked').value};for(const key of ['phones','emails'])payload[key]=(values[key]||'').split(/[\n;]/).map(x=>x.trim()).filter(Boolean);payload.tags=(values.tags||'').split(',').map(x=>x.trim()).filter(Boolean);const id=await api.save(payload);$('#editor').close();state.selected=id;state.filter='all';state.tag=null;state.search='';$('#search').value='';await refresh();toast('Контакт сохранён');}catch(e){$('#form-error').textContent=e.message;}finally{button.disabled=false;}};
function openLink(c){const others=state.contacts.filter(x=>x.id!==c.id).sort((a,b)=>a.name.localeCompare(b.name,'ru'));if(!others.length)return toast('Сначала добавьте ещё один контакт.');$('#link-target').innerHTML=others.map(x=>`<option value="${escape(x.id)}">${escape(x.name)} · ${x.kind==='person'?'человек':'организация'}</option>`).join('');$('#link-role').value=c.kind==='person'&&c.position?c.position:'';$('#link-error').textContent='';$('#link-dialog').showModal();}
$('#link-form').onsubmit=async e=>{e.preventDefault();const button=$('#link-form [type="submit"]');button.disabled=true;try{await api.link(state.selected,$('#link-target').value,$('#link-role').value);$('#link-dialog').close();await refresh();toast('Связь добавлена');}catch(err){$('#link-error').textContent=err.message;}finally{button.disabled=false;}};
async function refresh(silent=false){if(state.loading)return;state.loading=true;try{const data=await api.read();state.contacts=data.contacts;state.relations=data.relations;state.unavailable=false;$('#sync-status').textContent='● Сохранено на диске';$('#footer-status').textContent=`Обновлено в ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`;render();}catch(e){state.unavailable=true;$('#sync-status').textContent='● База недоступна';render();if(!silent)toast(e.message,true);}finally{state.loading=false;}}
function settings(){if(!state.config)return;$('#database-path').textContent=state.config.directory;$('#auto-check').checked=state.config.autoCheck;$('#app-version').textContent=state.config.version;$('#settings-dialog').showModal();}
$('#settings').onclick=settings;
$('#choose-folder').onclick=async()=>{try{const directory=await api.folder();if(directory){state.config.directory=directory;$('#database-path').textContent=directory;$('#storage-label').textContent=directory;state.selected=null;state.search='';$('#search').value='';await refresh();toast('База подключена');}}catch(e){toast(e.message,true);}};
$('#backup').onclick=async()=>{try{if(await api.backup())toast('Резервная копия сохранена');}catch(e){toast(e.message,true);}};
async function checkUpdate(silent=false){const button=$('#check-update');button.disabled=true;if(!silent)$('#update-status').textContent='Проверяем GitHub Releases…';try{const update=await api.checkUpdate();$('#install-update').hidden=!update;$('#update-status').textContent=update?`Доступна версия ${update.version}.`:'У вас последняя опубликованная версия.';if(update&&silent)toast(`Доступна версия ${update.version}. Откройте настройки для установки.`);}catch(e){$('#update-status').textContent=e.message;}finally{button.disabled=false;}}
$('#check-update').onclick=()=>checkUpdate();
$('#install-update').onclick=async()=>{const button=$('#install-update');button.disabled=true;$('#update-status').textContent='Подготовка обновления…';try{const installed=await api.installUpdate();if(!installed)$('#update-status').textContent='Установка отменена.';}catch(e){$('#update-status').textContent=e.message;}finally{button.disabled=false;}};
$('#auto-check').onchange=async e=>{try{await api.autoCheck(e.target.checked);state.config.autoCheck=e.target.checked;}catch(err){e.target.checked=!e.target.checked;toast(err.message,true);}};
$('#theme-toggle').onclick=async()=>{const theme=document.body.classList.contains('dark')?'light':'dark';try{await api.theme(theme);document.body.classList.toggle('dark',theme==='dark');}catch(e){toast(e.message,true);}};
$$('[data-filter]').forEach(b=>b.onclick=()=>setFilter(b.dataset.filter));
$$('[data-close]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.close).close());
$('#add-contact').onclick=()=>edit();
$('#refresh').onclick=()=>refresh();
$('#search').oninput=e=>{state.search=e.target.value;render();};
$('#sort').onchange=render;
$('#clear-filter').onclick=()=>{state.filter='all';state.tag=null;state.search='';$('#search').value='';render();};
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('#search').focus();}if((e.ctrlKey||e.metaKey)&&e.key===','){e.preventDefault();if(!document.querySelector('dialog[open]'))settings();}});
async function start(){try{state.config=await api.init();document.body.classList.toggle('dark',state.config.theme==='dark');$('#storage-label').textContent=state.config.directory;$('#storage-label').title=state.config.directory;await refresh();if(state.config.startupError)toast(state.config.startupError,true);if(state.config.autoCheck)void checkUpdate(true);setInterval(()=>{if(!document.querySelector('dialog[open]')&&document.visibilityState==='visible')void refresh(true);},12000);}catch(e){toast(e.message,true);}}
void start();
