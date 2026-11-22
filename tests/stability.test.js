'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const child=require('node:child_process');
const base=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(base,'index.html'),'utf8');
const pkg=JSON.parse(fs.readFileSync(path.join(base,'package.json'),'utf8'));
assert.equal(pkg.version,'3.2.3');
assert.equal(pkg.main,'main.js');
assert(!JSON.stringify(pkg).includes('exceljs'),'exceljs must not be included');
for(const x of ['main.js','preload.js','bulk-reader.js','splash.html','assets/logo.png','assets/saarathi.ico'])assert(fs.existsSync(path.join(base,x)),x+' missing');
const source=(html.match(/<script>([\s\S]*?)<\/script>/)||[])[1];
assert(source,'main inline script not found');
const check=child.spawnSync(process.execPath,['--check'],{input:source,encoding:'utf8'});
assert.equal(check.status,0,'Syntax failure: '+check.stderr);
for(const x of ['main.js','preload.js','bulk-reader.js'])assert.equal(child.spawnSync(process.execPath,['--check',path.join(base,x)]).status,0,x+' syntax');
assert.match(html,/function attendanceHasPermission/);
assert.match(html,/function payrollPreview/);
assert.match(html,/Custom Range/);
assert.match(html,/if\(!save\(\)\)\{db=beforeRestore;/);
assert.match(html,/if\(saveAttendanceChoice\(staffId,'Present',\{permissionHours:hrs/);
assert.match(html,/db\.seq=previousSeq/);
const fnNames=['attendanceHasPermission','attendanceDisplayStatus','attendanceSummary','attendancePeriodBounds','payrollPreview','filteredAttendanceRecords'];
function extractFunction(name){
 const pos=source.indexOf('function '+name+'(');assert(pos>=0,name+' missing');
 let brace=source.indexOf('{',pos),depth=0,quote=null,escape=false,template=false;
 // All tested functions are plain JS with no nested template literals except display strings.
 for(let i=brace;i<source.length;i++){
  const c=source[i];
  if(quote){if(escape){escape=false;continue}if(c==='\\'){escape=true;continue}if(c===quote){quote=null;continue}continue}
  if(c==='"'||c==="'"||c==='`'){quote=c;continue}
  if(c==='{')depth++;
  if(c==='}'&&!--depth)return source.slice(pos,i+1);
 }
 throw Error('Unclosed '+name);
}
const context={db:{attendance:[]},company:1,attendanceHistoryStaff:'all',attendanceHistoryPeriod:'month',attendanceHistoryFrom:'2026-11-01',attendanceHistoryTo:'2026-11-30',staffForCompany:()=>[{id:7,name:'Test Staff',company:1,monthlySalary:26000,payableDays:26}],mine:a=>a.filter(x=>x.company===1),today:()=> '2026-11-22',E:x=>String(x)};
vm.createContext(context);
for(const name of fnNames)vm.runInContext(extractFunction(name),context);
const legacy={id:1,company:1,staffId:7,name:'Test Staff',status:'Permission',permissionHours:2,permissionFrom:'14:00',permissionTo:'16:00',date:'2026-11-20'};
const modern={id:2,company:1,staffId:7,name:'Test Staff',status:'Present',permissionHours:1,permissionFrom:'12:00',permissionTo:'13:00',date:'2026-11-21'};
const half={id:3,company:1,staffId:7,name:'Test Staff',status:'Half Day',halfSession:'AM',date:'2026-11-22'};
assert.equal(context.attendanceHasPermission(legacy),true);
assert.equal(context.attendanceHasPermission(modern),true);
assert.equal(context.attendanceDisplayStatus(legacy),'Present + Permission (legacy)');
assert.equal(context.attendanceDisplayStatus(modern),'Present + Permission');
const summary=context.attendanceSummary([legacy,modern,half]);
assert.equal(summary.present,2);
assert.equal(summary.half,1);
assert.equal(summary.permissionCount,2);
assert.equal(summary.permissionHours,3);
assert.equal(summary.paidDays,2.5);
context.db.attendance=[legacy,modern,half];
const report=context.payrollPreview(context.staffForCompany()[0],'2026-11');
assert.equal(report.credited,2.5);
assert.equal(report.estimated,2500);
context.attendanceHistoryStaff='7';context.attendanceHistoryPeriod='custom';
context.attendanceHistoryFrom='2026-11-21';context.attendanceHistoryTo='2026-11-22';
assert.equal(context.filteredAttendanceRecords().length,2);
context.attendanceHistoryFrom='2026-11-29';context.attendanceHistoryTo='2026-11-10';
assert.equal(context.filteredAttendanceRecords().length,0,'Invalid range must not return other dates');
const bounds=context.attendancePeriodBounds('month',new Date(2026,10,22));
assert.equal(bounds[0],'2026-11-01');assert.equal(bounds[1],'2026-11-22');
console.log('Stability tests passed: syntax, packaging, attendance legacy and new permission, payroll preview, custom dates, backups and import rollback');
