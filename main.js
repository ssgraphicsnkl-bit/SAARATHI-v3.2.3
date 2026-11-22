// SAARATHI v3.0 — offline-first Electron host / SQLite storage
const {app, BrowserWindow, shell, ipcMain, protocol} = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const initSqlJs = require('sql.js');
const {parseBulkItemFile} = require('./bulk-reader');

protocol.registerSchemesAsPrivileged([{scheme:'saarathi-media',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true,corsEnabled:true}}]);
let quitting=false, SQL, database, dataDir, dbFile, imageDir, backupDir, saveInProgress=false;
const TABLES=['companies','items','clients','sales','expenses','purchases','payments','attendance','staff','stockAdjustments','quotations','users'];
const externalHosts=new Set(['web.whatsapp.com','wa.me','api.whatsapp.com','www.facebook.com','facebook.com','www.instagram.com','instagram.com','www.youtube.com','youtube.com','chatgpt.com','www.google.com','business.google.com','maps.google.com']);
function allowedExternal(url){try{const u=new URL(url);return u.protocol==='https:'&&externalHosts.has(u.hostname)}catch{return false}}
function mkdir(p){fs.mkdirSync(p,{recursive:true});return p}
function isoDay(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function safeFileWrite(dest,content){
 // Write/sync the temp file before replacing the destination. Never edit the live DB in-place.
 const tmp=dest+'.tmp';let fd;
 try{
  fd=fs.openSync(tmp,'w');fs.writeFileSync(fd,content);fs.fsyncSync(fd);fs.closeSync(fd);fd=null;
  fs.renameSync(tmp,dest);
 }catch(e){if(fd!==undefined)try{fs.closeSync(fd)}catch{};throw e}
 finally{if(fs.existsSync(tmp))try{fs.rmSync(tmp,{force:true})}catch{}}
}
function assertHealthyDb(db){
 const rows=db.exec('PRAGMA integrity_check');
 if(rows[0]?.values?.[0]?.[0]!=='ok')throw Error('SQLite integrity check failed');
}
function assertState(state){
 if(!state||typeof state!=='object'||!Array.isArray(state.companies)||!Array.isArray(state.sales)||!Array.isArray(state.items))throw Error('Invalid database state');
 // Reject accidental duplicate IDs; otherwise entity_records would fail silently mid-write.
 for(const type of TABLES){const ids=new Set();for(const r of state[type]||[]){
  if(!r||r.id==null)throw Error('Missing ID in '+type);
  const id=String(r.id);if(ids.has(id))throw Error('Duplicate record ID in '+type+': '+id);ids.add(id);
 }}
}

function mediaFile(value,kind){if(typeof value!=='string'||!value.startsWith('data:image/'))return value;
 const m=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(value);if(!m)return value;
 const bytes=Buffer.from(m[2],'base64');if(!bytes.length||bytes.length>1000000)return value;
 const ext=m[1]==='jpeg'?'jpg':m[1];const digest=crypto.createHash('sha256').update(bytes).digest('hex');
 const filename=digest+'.'+ext;const dir=mkdir(path.join(imageDir,kind));const full=path.join(dir,filename);
 if(!fs.existsSync(full))safeFileWrite(full,bytes);
 return 'saarathi-media://files/'+kind+'/'+filename;
}
function externalize(obj){const data=structuredClone(obj);
 for(const c of data.companies||[]){for(const k of ['logo','image','photo'])if(c[k])c[k]=mediaFile(c[k],'companies')}
 for(const p of data.items||[]){for(const k of ['image','photo','logo'])if(p[k])p[k]=mediaFile(p[k],'products')}
 for(const s of [...(data.sales||[]),...(data.quotations||[])]){if(s.companySnapshot?.logo)s.companySnapshot.logo=mediaFile(s.companySnapshot.logo,'companies')}
 return data;
}
function initializeSql(){database=new SQL.Database(fs.existsSync(dbFile)?new Uint8Array(fs.readFileSync(dbFile)):undefined);
 database.run('PRAGMA foreign_keys=ON');
 database.run('CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK (id=1), data TEXT NOT NULL, updated_at TEXT NOT NULL)');
 database.run('CREATE TABLE IF NOT EXISTS entity_records (entity_type TEXT NOT NULL, record_id TEXT NOT NULL, company_id TEXT, record_json TEXT NOT NULL, PRIMARY KEY(entity_type,record_id))');
 database.run('CREATE INDEX IF NOT EXISTS idx_entity_company ON entity_records(entity_type,company_id)');
 assertHealthyDb(database);
}
function snapshotFile(){return new Uint8Array(database.export())}
function hasData(){const q=database.exec('SELECT 1 FROM app_state WHERE id=1');return !!q[0]?.values?.length}
function loadState(){const statement=database.prepare('SELECT data FROM app_state WHERE id=1');try{return statement.step()?JSON.parse(statement.getAsObject().data):null}finally{statement.free()}}
function archiveBackup(label){
 if(!fs.existsSync(dbFile))return null;
 const dir=mkdir(path.join(backupDir,label));const snapshot=path.join(dir,'saarathi.db');
 // Backup to temporary file first; verify database before publishing it.
 const temp=snapshot+'.pending';
 try{
  fs.copyFileSync(dbFile,temp);
  const test=new SQL.Database(new Uint8Array(fs.readFileSync(temp)));
  try{assertHealthyDb(test)}finally{test.close()}
  fs.renameSync(temp,snapshot);
  const mediaTarget=path.join(dir,'Images');
  if(fs.existsSync(imageDir))fs.cpSync(imageDir,mediaTarget,{recursive:true,force:true});
  return dir;
 }catch(e){if(fs.existsSync(temp))fs.rmSync(temp,{force:true});throw e}
}
function autoBackup(){const label='daily-'+isoDay();if(!fs.existsSync(path.join(backupDir,label,'saarathi.db')))archiveBackup(label)}
function saveState(raw){
 if(saveInProgress)return {ok:false,error:'Another save is already in progress'};
 saveInProgress=true;let working;
 try{
  assertState(raw);
  // A pre-save recovery point is mandatory before modifying existing financial records.
  if(fs.existsSync(dbFile))autoBackup();
  const data=externalize(raw);
  working=new SQL.Database(snapshotFile());
  working.run('BEGIN TRANSACTION');
  working.run('INSERT OR REPLACE INTO app_state (id,data,updated_at) VALUES (1,?,?)',[JSON.stringify(data),new Date().toISOString()]);
  working.run('DELETE FROM entity_records');
  const stmt=working.prepare('INSERT INTO entity_records (entity_type,record_id,company_id,record_json) VALUES (?,?,?,?)');
  try{for(const type of TABLES){for(const row of data[type]||[]){stmt.run([type,String(row.id),row.company==null?null:String(row.company),JSON.stringify(row)])}}}
  finally{stmt.free()}
  working.run('COMMIT');
  assertHealthyDb(working);
  const bytes=new Uint8Array(working.export());
  // Validate the actual exported bytes before replacing the old file.
  const verify=new SQL.Database(bytes);
  try{assertHealthyDb(verify);const saved=verify.exec('SELECT data FROM app_state WHERE id=1');if(!saved[0]?.values?.length)throw Error('Missing persisted state')}
  finally{verify.close()}
  safeFileWrite(dbFile,bytes);
  const oldDb=database;database=working;working=null;oldDb.close();
  return {ok:true,data};
 }catch(err){
  if(working)try{working.close()}catch{}
  return {ok:false,error:String(err.message||err)};
 }finally{saveInProgress=false}
}
function inlineMedia(value){
 if(typeof value!=='string'||!value.startsWith('saarathi-media://files/'))return value;
 const match=/^saarathi-media:\/\/files\/(companies|products)\/([a-f0-9]{64})\.(png|jpg|webp)$/.exec(value);
 if(!match)return value;
 const filename=path.join(imageDir,match[1],match[2]+'.'+match[3]);
 if(!fs.existsSync(filename))return value;
 const mime=match[3]==='jpg'?'image/jpeg':'image/'+match[3];
 return 'data:'+mime+';base64,'+fs.readFileSync(filename).toString('base64');
}
function portableState(){const data=loadState();if(!data)return null;
 for(const c of data.companies||[])for(const k of ['logo','image','photo'])if(c[k])c[k]=inlineMedia(c[k]);
 for(const x of data.items||[])for(const k of ['logo','image','photo'])if(x[k])x[k]=inlineMedia(x[k]);
 for(const x of [...(data.sales||[]),...(data.quotations||[])])if(x.companySnapshot?.logo)x.companySnapshot.logo=inlineMedia(x.companySnapshot.logo);
 return data;
}
function backupNow(){const label='manual-'+new Date().toISOString().replace(/[:.]/g,'-');if(!fs.existsSync(dbFile))throw Error('No database file to back up yet. Save a company first.');return archiveBackup(label)}
function storeMigrationJson(text){if(typeof text!=='string'||text.length>80*1024*1024)throw Error('Invalid migration backup');const dest=path.join(backupDir,'pre-migration-'+Date.now()+'.json');safeFileWrite(dest,Buffer.from(text,'utf8'));return dest}
function initHandlers(){
 ipcMain.handle('saarathi:bulk-parse',async(event,array,filename)=>{
  try{if(!Array.isArray(array)||array.length>12*1024*1024)throw Error('Invalid upload');return {ok:true,rows:await parseBulkItemFile(Buffer.from(array),filename)}}
  catch(e){return {ok:false,error:String(e.message||e)}}
 });
 ipcMain.on('saarathi:data-load',(event)=>{try{event.returnValue={ok:true,data:loadState(),path:dataDir}}catch(e){event.returnValue={ok:false,error:e.message}}});
 ipcMain.on('saarathi:data-save',(event,raw)=>{try{event.returnValue=saveState(raw)}catch(e){event.returnValue={ok:false,error:e.message}}});
 ipcMain.on('saarathi:portable-state',(event)=>{try{event.returnValue={ok:true,data:portableState()}}catch(e){event.returnValue={ok:false,error:e.message}}});
 ipcMain.on('saarathi:backup-now',(event)=>{try{event.returnValue={ok:true,path:backupNow()}}catch(e){event.returnValue={ok:false,error:e.message}}});
 ipcMain.on('saarathi:migration-copy',(event,s)=>{try{event.returnValue={ok:true,path:storeMigrationJson(s)}}catch(e){event.returnValue={ok:false,error:e.message}}});
 ipcMain.on('saarathi:data-info',(event)=>event.returnValue={path:dataDir,dbPath:dbFile,images:imageDir,backups:backupDir,engine:'SQLite (sql.js)',hasState:hasData()});
 ipcMain.on('saarathi:confirm-exit',(event)=>{const win=BrowserWindow.fromWebContents(event.sender);if(!win)return;quitting=true;win.close();app.quit()});
}
function createWindow(){let splash=null;try{splash=new BrowserWindow({width:530,height:380,frame:false,resizable:false,alwaysOnTop:true,skipTaskbar:true,backgroundColor:'#ffffff',show:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});splash.loadFile(path.join(__dirname,'splash.html'));}catch(err){console.warn('Splash unavailable:',err.message);if(splash&&!splash.isDestroyed())splash.close();splash=null;}const win=new BrowserWindow({show:false,title:'SAARATHI — Your Smart Business Assistant',width:1440,height:900,minWidth:980,minHeight:640,autoHideMenuBar:true,backgroundColor:'#f4f6fb',icon:path.join(__dirname,'assets','saarathi.ico'),webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,preload:path.join(__dirname,'preload.js')}});
 win.loadFile(path.join(__dirname,'index.html'));let openingDone=false;function finishOpening(){if(openingDone)return;openingDone=true;if(splash&&!splash.isDestroyed())splash.close();if(!win.isDestroyed()){win.show();win.focus()}}win.once('ready-to-show',()=>setTimeout(finishOpening,2800));win.webContents.once('did-fail-load',()=>setTimeout(finishOpening,2800));
 win.webContents.setWindowOpenHandler(({url})=>{if(url==='about:blank')return {action:'allow'};if(allowedExternal(url)){shell.openExternal(url).catch(()=>{});return {action:'deny'}}return {action:'deny'}});
 win.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith('file://')){event.preventDefault();if(allowedExternal(url))shell.openExternal(url).catch(()=>{})}});
 win.on('close',(event)=>{if(splash&&!splash.isDestroyed())splash.close();if(quitting)return;event.preventDefault();win.webContents.send('saarathi:exit-requested')});
}
app.whenReady().then(async()=>{
 dataDir=mkdir(path.join(app.getPath('userData'),'SAARATHI Data'));
 dbFile=path.join(dataDir,'saarathi.db');imageDir=mkdir(path.join(dataDir,'Images'));backupDir=mkdir(path.join(dataDir,'Backups'));
 const wasmPath=require.resolve('sql.js/dist/sql-wasm.wasm');
 SQL=await initSqlJs({wasmBinary:fs.readFileSync(wasmPath)});
 initializeSql();
 protocol.handle('saarathi-media',req=>{try{const u=new URL(req.url);const match=/^\/(companies|products)\/([a-f0-9]{64})\.(png|jpg|webp)$/.exec(u.pathname);if(u.hostname!=='files'||!match)return new Response('Not found',{status:404});const file=path.join(imageDir,match[1],match[2]+'.'+match[3]);if(!fs.existsSync(file))return new Response('Not found',{status:404});return new Response(fs.readFileSync(file),{status:200,headers:{'content-type':match[3]==='jpg'?'image/jpeg':'image/'+match[3],'access-control-allow-origin':'*'}})}catch{return new Response('Invalid image',{status:400})}});
 initHandlers();createWindow();
}).catch(e=>{console.error('SAARATHI failed to initialize SQLite:',e);app.quit()});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()});
app.on('activate',()=>{if(!BrowserWindow.getAllWindows().length&&database)createWindow()});
