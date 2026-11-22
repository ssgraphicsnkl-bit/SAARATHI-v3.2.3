'use strict';
// SAARATHI offline Excel/CSV parser. Uses Node built-ins; no runtime npm dependencies.
const path = require('path');
const zlib = require('zlib');
function entityDecode(s){return String(s).replace(/&(#(?:x[\da-f]+|\d+)|amp|lt|gt|quot|apos);/gi,(full,e)=>{
 if(e[0]==='#'){let n=e[1]?.toLowerCase()==='x'?parseInt(e.slice(2),16):parseInt(e.slice(1),10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):''}
 return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[e.toLowerCase()]??full;
});}
function attr(tag,name){const match=new RegExp('(?:^|\\s)'+name+'\\s*=\\s*(["\'])(.*?)\\1','i').exec(tag);return match?entityDecode(match[2]):null;}
function xmlText(s){let out='';for(const match of s.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g))out+=entityDecode(match[1]);return out;}
function xlsxFiles(buffer){
 if(buffer.length<22||buffer.readUInt32LE(0)!==0x04034b50)throw Error('Invalid Excel workbook: not a ZIP file');
 const searchStart=Math.max(0,buffer.length-65557);let eocd=-1;
 for(let i=buffer.length-22;i>=searchStart;i--){if(buffer.readUInt32LE(i)===0x06054b50){eocd=i;break}}
 if(eocd<0)throw Error('Invalid Excel workbook: ZIP index missing');
 const count=buffer.readUInt16LE(eocd+10),index=buffer.readUInt32LE(eocd+16);let offset=index;
 if(count===0xffff||index===0xffffffff||count>10000)throw Error('Unsupported or oversized Excel workbook');
 const files=new Map();
 for(let i=0;i<count;i++){
  if(offset+46>buffer.length||buffer.readUInt32LE(offset)!==0x02014b50)throw Error('Broken Excel file index');
  const method=buffer.readUInt16LE(offset+10), compressed=buffer.readUInt32LE(offset+20), uncompressed=buffer.readUInt32LE(offset+24);
  const nameLen=buffer.readUInt16LE(offset+28),extraLen=buffer.readUInt16LE(offset+30),commentLen=buffer.readUInt16LE(offset+32),localOffset=buffer.readUInt32LE(offset+42);
  const name=buffer.toString('utf8',offset+46,offset+46+nameLen);
  offset+=46+nameLen+extraLen+commentLen;
  if(name.endsWith('/')||!name.startsWith('xl/'))continue;
  if(uncompressed>30*1024*1024)throw Error('Excel sheet is too large');
  if(localOffset+30>buffer.length||buffer.readUInt32LE(localOffset)!==0x04034b50)throw Error('Excel contains broken ZIP entry');
  const start=localOffset+30+buffer.readUInt16LE(localOffset+26)+buffer.readUInt16LE(localOffset+28);
  if(start+compressed>buffer.length)throw Error('Excel file is truncated');
  const source=buffer.subarray(start,start+compressed);
  let data;
  if(method===0)data=source;
  else if(method===8)data=zlib.inflateRawSync(source,{maxOutputLength:30*1024*1024});
  else throw Error('Unsupported Excel ZIP compression');
  if(data.length!==uncompressed)throw Error('Excel ZIP data size mismatch');
  files.set(name,data.toString('utf8'));
 }
 return files;
}
function firstWorksheet(files){
 const workbook=files.get('xl/workbook.xml');
 if(!workbook)return files.get('xl/worksheets/sheet1.xml');
 const sheet=/<sheet\b[^>]*\/>/.exec(workbook)||/<sheet\b[^>]*>/.exec(workbook);
 if(!sheet)return files.get('xl/worksheets/sheet1.xml');
 const rid=attr(sheet[0],'r:id');
 const rels=files.get('xl/_rels/workbook.xml.rels')||'';
 if(rid){for(const r of rels.matchAll(/<Relationship\b[^>]*\/?\s*>/g)){
  if(attr(r[0],'Id')!==rid)continue;
  let target=attr(r[0],'Target')||'';
  target=target.startsWith('/')?target.replace(/^\/+/, ''):path.posix.normalize(path.posix.join('xl',target));
  if(!target.startsWith('xl/'))throw Error('Invalid Excel worksheet path');
  if(files.has(target))return files.get(target);
 }}
 return files.get('xl/worksheets/sheet1.xml');
}
function parseXlsx(buffer){
 const files=xlsxFiles(buffer);const sheet=firstWorksheet(files);
 if(!sheet)throw Error('Excel workbook has no readable worksheet');
 const shared=[];const ss=files.get('xl/sharedStrings.xml')||'';
 for(const match of ss.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g))shared.push(xmlText(match[1]));
 const rows=[];
 for(const match of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)){
  const cells=[];let nextColumn=0;
  for(const cell of match[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)){
   const info=cell[1],content=cell[2]||'',type=attr(info,'t');
   const location=attr(info,'r')||'';const letters=/^[A-Za-z]+/.exec(location);
   let col=nextColumn;if(letters){col=0;for(const character of letters[0].toUpperCase())col=col*26+character.charCodeAt(0)-64;col--}
   if(col>500)throw Error('Excel sheet contains too many columns');
   const raw=/<v\b[^>]*>([\s\S]*?)<\/v>/.exec(content)?.[1];
   let value='';
   if(type==='inlineStr')value=xmlText(content);
   else if(type==='s')value=shared[Number(raw)]??'';
   else if(type==='b')value=raw==='1'?'TRUE':'FALSE';
   else if(type==='e')value='';
   else if(raw!==undefined)value=entityDecode(raw);
   else value=xmlText(content);
   cells[col]=value;nextColumn=col+1;
  }
  if(cells.some(v=>v!=null&&String(v).trim()))rows.push(Array.from({length:cells.length},(_,i)=>String(cells[i]??'')));
  if(rows.length>5001)throw Error('Maximum 5,000 rows per import');
 }
 return rows;
}
function parseCsv(buffer){
 let text=buffer.toString('utf8').replace(/^\ufeff/,'');if(text.charCodeAt(0)===0xfffd)throw Error('CSV must be UTF-8 encoded');
 const rows=[];let row=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++}else if(c==='"')quoted=false;else field+=c;continue}
  if(c==='"'&&!field){quoted=true;continue}
  if(c===','){row.push(field);field='';continue}
  if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(v=>v.trim()))rows.push(row);if(rows.length>5001)throw Error('Maximum 5,000 rows per import');row=[];field='';continue}
  field+=c;
 }
 if(quoted)throw Error('CSV contains an unclosed quoted cell');
 row.push(field);if(row.some(v=>v.trim()))rows.push(row);
 if(rows.length>5001)throw Error('Maximum 5,000 rows per import');
 return rows;
}
async function parseBulkItemFile(buffer,filename){
 if(!Buffer.isBuffer(buffer)||buffer.length>12*1024*1024)throw Error('File must be smaller than 12 MB');
 const ext=path.extname(String(filename||'')).toLowerCase();
 if(ext==='.csv')return parseCsv(buffer);
 if(ext==='.xlsx')return parseXlsx(buffer);
 throw Error('Use .xlsx or .csv file');
}
module.exports={parseBulkItemFile,parseCsv,parseXlsx};
