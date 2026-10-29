const fs=require('fs'),vm=require('vm'),path=require('path');process.chdir(path.join(__dirname,'..','web'));
const ctx=vm.createContext({console,Date,Math,JSON,Intl,Object,Array,String,Number,RegExp,Error,Promise,Set,Map,fetch:()=>Promise.resolve({json:()=>({})}),window:{}});
// scripts mínimos para probar funciones puras
const esc="const esc=s=>String(s??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c]));var VISTAS={};";
vm.runInContext(esc+fs.readFileSync('manual.js','utf8').replace(/\nVISTAS\.manual=manualV;/,'')+`
globalThis.__t={MANUAL,manualSecciones,manualDocumento,ROL_NOMBRE};`,ctx);
const {MANUAL,manualSecciones,manualDocumento}=ctx.__t;
// 1) el manual NO contiene claves ni credenciales
const todo=MANUAL.map(s=>s.h).join(' ')+manualDocumento('FARMACEUTICO_REGENTE','1.0.8');
const prohibidos=[/Farmacia1234/i,/Asic\s*Santa/i,/22\s*03\s*2002/,/(clave|contrase(ñ|n)a)[^.<]{0,25}[:=]\s*\S*\d\S*/i,/(clave|contrase(ñ|n)a)\s+(es|sera|será)\s+\S+/i,/password/i,/scrypt/i];
const malos=prohibidos.filter(r=>r.test(todo));prohibidos.forEach(r=>{const m=todo.match(r);if(m)console.log('   coincidencia:',JSON.stringify(todo.slice(Math.max(0,m.index-40),m.index+60)))});console.log('1) sin credenciales en el manual:',malos.length?'FALLA '+malos:'OK');
// 2) filtrado por rol
const n=r=>manualSecciones(r).map(s=>s.id);
const reg=n('FARMACEUTICO_REGENTE'),alm=n('ALMACENISTA'),ins=n('INSPECTOR_ASIC');
console.log('2) secciones  regente:',reg.length,' almacenista:',alm.length,' inspector:',ins.length);
const ok=reg.includes('usuarios')&&reg.includes('anulacion')&&!alm.includes('usuarios')&&!alm.includes('anulacion')&&!ins.includes('despacho')&&!ins.includes('usuarios')&&ins.includes('consumo')&&alm.includes('despacho')&&ins.includes('auditoria')&&!alm.includes('auditoria');
console.log('   filtrado correcto:',ok?'OK':'FALLA');
console.log('   cierre solo-regente incluido solo para regente:',/Cerrar mes/.test(manualSecciones('FARMACEUTICO_REGENTE').find(s=>s.id==='cierre').h)&&!/Cerrar mes/.test(manualSecciones('ALMACENISTA').find(s=>s.id==='cierre').h)?'OK':'FALLA');
console.log('   marcadores sin resolver:',/\$\{REGENTE/.test(manualDocumento('ALMACENISTA',''))?'FALLA':'OK');
if (typeof malos !== 'undefined' && malos.length) process.exit(1);
