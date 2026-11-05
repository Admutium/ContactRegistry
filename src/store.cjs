const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const initSqlJs = require('sql.js');
let engine;
const sql = () => engine ||= initSqlJs();
const SCHEMA = `CREATE TABLE IF NOT EXISTS contacts (id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, payload TEXT NOT NULL, updated TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS relations (id TEXT PRIMARY KEY, source TEXT NOT NULL, target TEXT NOT NULL, role TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR IGNORE INTO metadata VALUES ('schema','1');`;
function rows(db, query, params = []) {
  const statement = db.prepare(query);
  try { statement.bind(params); const result = []; while (statement.step()) result.push(statement.getAsObject()); return result; }
  finally { statement.free(); }
}
function validate(input) {
  if (!input || !['person','organization'].includes(input.kind)) throw Error('Неверный тип контакта.');
  const name = String(input.name || '').trim();
  if (!name || name.length > 300) throw Error('Укажите название или ФИО (до 300 символов).');
  const text = key => String(input[key] || '').trim().slice(0, 20000);
  const list = key => [...new Set((Array.isArray(input[key]) ? input[key] : []).map(v => String(v).trim()).filter(Boolean))].slice(0, 100);
  const result = {kind:input.kind, name, tags:list('tags'), phones:list('phones'), emails:list('emails')};
  for (const key of ['position','fullName','inn','kpp','ogrn','legalAddress','postalAddress','bank','bik','account','correspondentAccount','website','notes']) result[key] = text(key);
  for (const email of result.emails) if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Error(`Проверьте адрес почты: ${email}`);
  for (const [key, lengths] of [['inn',[10,12]],['kpp',[9]],['ogrn',[13,15]],['bik',[9]],['account',[20]],['correspondentAccount',[20]]]) {
    if (result[key] && (!/^\d+$/.test(result[key]) || !lengths.includes(result[key].length))) throw Error(`Проверьте поле ${key.toUpperCase()}: допустимая длина ${lengths.join(' или ')} цифр.`);
  }
  return result;
}
class Store {
  constructor(directory) { this.directory = path.resolve(directory); this.file = path.join(this.directory,'contacts.sqlite'); this.lock = path.join(this.directory,'.contactregistry-write-lock'); }
  async open(create = false) {
    const SQL = await sql();
    let data;
    try { data = await fs.readFile(this.file); } catch (e) { if(e.code !== 'ENOENT' || !create) throw e; }
    const db = data ? new SQL.Database(data) : new SQL.Database();
    try {
      if (data) {
        const version = rows(db, "SELECT value FROM metadata WHERE key='schema'")[0]?.value;
        if (version !== '1') throw Error('Эта версия базы не поддерживается. Обновите приложение.');
        if (rows(db,'PRAGMA quick_check')[0]?.quick_check !== 'ok') throw Error('База повреждена. Восстановите резервную копию.');
      } else db.run(SCHEMA);
      return db;
    } catch(e) { db.close(); throw e; }
  }
  async read() {
    const db = await this.open();
    try { return {contacts:rows(db,'SELECT * FROM contacts ORDER BY name COLLATE NOCASE').map(r => ({...JSON.parse(r.payload),id:r.id,updated:r.updated})),relations:rows(db,'SELECT * FROM relations')}; }
    finally { db.close(); }
  }
  async write(operation, create = false) {
    await fs.mkdir(this.directory,{recursive:true});
    try { await fs.mkdir(this.lock); }
    catch(e) { if(e.code==='EEXIST') throw Error('База занята другим компьютером. Повторите сохранение через несколько секунд. Если программа аварийно завершилась, закройте её на всех ПК и удалите папку .contactregistry-write-lock рядом с базой.'); throw e; }
    let db, temp;
    try {
      await fs.writeFile(path.join(this.lock,'owner.json'),JSON.stringify({host:require('node:os').hostname(),pid:process.pid,at:new Date().toISOString()}));
      db = await this.open(create);
      const result = operation(db);
      const bytes = db.export();
      temp = `${this.file}.${crypto.randomUUID()}.tmp`;
      const handle = await fs.open(temp,'wx');
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      // Keep the previous committed version before replacing the live file.
      try { await fs.copyFile(this.file,`${this.file}.previous`); } catch(e) { if(e.code !== 'ENOENT') throw e; }
      await fs.rename(temp,this.file);
      return result;
    } finally {
      db?.close();
      if(temp) await fs.rm(temp,{force:true}).catch(()=>{});
      await fs.rm(this.lock,{recursive:true,force:true});
    }
  }
  async ensure() { await this.write(()=>{}, true); return this.read(); }
  async save(input) {
    const contact = validate(input);
    return this.write(db => {
      const previous = input.id ? rows(db,'SELECT updated FROM contacts WHERE id=?',[input.id])[0] : null;
      if(input.id && (!previous || previous.updated !== input.updated)) throw Error('Контакт изменён или удалён на другом ПК. Закройте форму, обновите список и повторите изменения.');
      const id = input.id || crypto.randomUUID();
      db.run('INSERT OR REPLACE INTO contacts VALUES (?,?,?,?,?)',[id,contact.kind,contact.name,JSON.stringify(contact),crypto.randomUUID()]);
      return id;
    });
  }
  async remove(id, updated) {
    return this.write(db => {
      const current = rows(db,'SELECT updated FROM contacts WHERE id=?',[id])[0];
      if(!current || current.updated !== updated) throw Error('Контакт уже изменён. Обновите список перед удалением.');
      db.run('DELETE FROM contacts WHERE id=?',[id]);
      db.run('DELETE FROM relations WHERE source=? OR target=?',[id,id]);
    });
  }
  async link(source,target,role) {
    if(source===target) throw Error('Выберите другой контакт.');
    role = String(role || 'Связан с').trim().slice(0,200);
    return this.write(db=>{
      if(rows(db,'SELECT id FROM contacts WHERE id IN (?,?)',[source,target]).length!==2) throw Error('Контакт удалён. Обновите список.');
      if(rows(db,'SELECT id FROM relations WHERE source=? AND target=? AND role=?',[source,target,role]).length) return;
      db.run('INSERT INTO relations VALUES (?,?,?,?)',[crypto.randomUUID(),source,target,role]);
    });
  }
  async unlink(id) { return this.write(db=>db.run('DELETE FROM relations WHERE id=?',[id])); }
  async backup(destination) {
    const db = await this.open();
    try { await fs.writeFile(destination,db.export(),{flag:'wx'}); } finally { db.close(); }
  }
}
module.exports = {Store,validate};
