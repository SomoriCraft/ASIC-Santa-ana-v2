// Prueba de la autorización por equipo y del borrado de copias, con Electron simulado.  Uso: node pruebas/anticopia.test.js
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const RAIZ = path.join(__dirname, '..', 'escritorio'); let fallos = 0;
const ok = (c, t) => { console.log((c ? 'OK     ' : 'FALLA  ') + t); if (!c) fallos++; };
const MAESTRA = process.env.CDI_MAESTRA_PRUEBA;            // la clave maestra real se pasa por variable de entorno: no está escrita aquí
if (!MAESTRA) { console.log('Defina CDI_MAESTRA_PRUEBA para ejecutar esta prueba'); process.exit(0); }
function crearEntorno(raiz, dpapiKey) {                     // dpapiKey simula "esta Windows / este usuario"
  const userData = path.join(raiz, 'userData'), docs = path.join(raiz, 'docs'); fs.mkdirSync(userData, { recursive: true }); fs.mkdirSync(docs, { recursive: true });
  const enc = s => Buffer.concat([Buffer.from('ENC:' + dpapiKey + ':'), Buffer.from(s)]);
  const dec = b => { const t = b.toString(); const pre = 'ENC:' + dpapiKey + ':'; if (!t.startsWith(pre)) throw new Error('DPAPI: otra máquina'); return t.slice(pre.length); };
  const electron = { app: { getPath: n => n === 'documents' ? docs : userData, isPackaged: false, requestSingleInstanceLock: () => true, whenReady: () => new Promise(() => {}), on() {}, exit() {}, quit() {}, getVersion: () => '1.0.9' },
    BrowserWindow: class { }, Menu: {}, ipcMain: { handle() {}, removeHandler() {} }, dialog: { showMessageBoxSync() { return 0; } }, shell: {}, safeStorage: { isEncryptionAvailable: () => true, encryptString: enc, decryptString: dec }, net: {}, powerMonitor: { on() {} }, session: {} };
  const req = n => n === 'electron' ? electron : (n === 'pg' || n === 'bcryptjs') ? {} : n.startsWith('./') ? require(path.join(RAIZ, n)) : require(n);
  const ctx = vm.createContext({ require: req, process, console, Buffer, setTimeout, clearTimeout, setInterval, __dirname: RAIZ, URL, URLSearchParams, Promise, module: {}, exports: {} });
  vm.runInContext(fs.readFileSync(path.join(RAIZ, 'main.js'), 'utf8'), ctx, { filename: 'main.js' });
  return { ctx, userData, docs, run: c => vm.runInContext(c, ctx) };
}
const arch = (e) => ({ act: fs.existsSync(path.join(e.userData, 'activacion.bin')), mk: fs.existsSync(path.join(e.userData, 'config.mk')), cfg: fs.existsSync(path.join(e.userData, 'config.bin')), data: fs.existsSync(path.join(e.userData, 'pgdata')) });
let VER;
function preparar(e, guid, respuestas) {                    // sustituye lo que toca Windows y la ventana de la clave maestra
  e.ctx.__vm = VER; e.ctx.__uuid = undefined; e.ctx.__guid = guid; e.ctx.__resp = respuestas.slice(); e.ctx.__pedidas = 0; e.ctx.__borrado = false;
  e.run(`idEquipo = async () => ({ guid: __guid, uuid: __uuid === undefined ? 'BIOS-1' : __uuid, huella: CRIPTO.huellaEquipo(__guid, 'BIOS-1'), confiable: !!__guid });
         cargarMaestra = async () => __vm; unidadesUSB = async () => []; limpiarHuerfanos = async () => {};
         pedirMaestra = async () => { __pedidas++; return __resp.length ? __resp.shift() : null; };
         splash = { hide() {}, show() {}, close() {} }; vigia = null;
         dialog.showMessageBoxSync = () => 0;
         const __borrar = borrarCopiaNoAutorizada; borrarCopiaNoAutorizada = async m => { __borrado = true; return __borrar(m); };`);
}
(async () => {
  VER = (await import('../api/maestra.js')).verMaestra;
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cdi-anticopia-'));
  // A) instalación nueva: pide la clave maestra una vez y deja todo protegido
  const A = crearEntorno(path.join(base, 'A'), 'WIN-A'); preparar(A, 'GUID-A', [MAESTRA]);
  ok(await A.run('verificarEquipo()') === true, 'A1: equipo nuevo + clave maestra correcta → autorizado');
  A.run(`est.cfg = { pgPass: 'pg-secreta', appPass: 'app', jwt: 'jwt', institucion: 'CDI' }; saveCfg(est.cfg);`);
  fs.mkdirSync(path.join(A.userData, 'pgdata')); fs.writeFileSync(path.join(A.userData, 'pgdata', 'base'), 'datos'); fs.writeFileSync(path.join(A.userData, 'initdb-ok'), 'ok');
  let s = arch(A); ok(s.act && s.mk && s.cfg, 'A2: quedan la activación, el sobre de claves y la configuración cifrada');
  ok(!fs.readFileSync(path.join(A.userData, 'config.mk')).toString('latin1').includes('pg-secreta'), 'A3: el sobre no contiene las claves en texto legible');
  // B) segunda ejecución en el mismo equipo: no pregunta nada
  const B = crearEntorno(path.join(base, 'A'), 'WIN-A'); preparar(B, 'GUID-A', []);
  ok(await B.run('verificarEquipo()') === true && B.ctx.__pedidas === 0, 'B: el mismo equipo arranca sin pedir la clave');
  ok(B.run('est.llaveMk && est.llaveMk.length') === 32, 'B2: la llave de cifrado de respaldos queda disponible');
  // C) copia a otro equipo (otra Windows → DPAPI no descifra; otra huella) con clave maestra correcta: se migra
  fs.cpSync(A.userData, path.join(base, 'C', 'userData'), { recursive: true });
  const C = crearEntorno(path.join(base, 'C'), 'WIN-C'); preparar(C, 'GUID-C', [MAESTRA]);
  ok(await C.run('verificarEquipo()') === true && !C.ctx.__borrado, 'C1: copia en otro equipo + clave maestra correcta → se autoriza y NO se borra nada');
  ok(C.run('loadCfg()').pgPass === 'pg-secreta', 'C2: las claves internas se recuperan del sobre y quedan cifradas para el equipo nuevo');
  ok(arch(C).data, 'C3: los datos siguen ahí');
  // D) copia a otro equipo, 5 claves incorrectas: se elimina la información copiada
  fs.cpSync(A.userData, path.join(base, 'D', 'userData'), { recursive: true });
  const D = crearEntorno(path.join(base, 'D'), 'WIN-D'); preparar(D, 'GUID-D', ['x1', 'x2', 'x3', 'x4', 'x5']);
  D.run('demoraIntento = 0'); const t0 = Date.now(); const rD = await D.run('verificarEquipo()'); s = arch(D);
  ok(rD === false && D.ctx.__borrado && D.ctx.__pedidas === 5, 'D1: 5 claves incorrectas en una copia ajena → no se autoriza y se dispara el borrado');
  ok(!s.data && !s.cfg && !s.mk && !s.act, 'D2: pgdata, config, sobre y activación fueron eliminados de la copia');
  // E) copia ajena y la persona cancela: NO se borra (solo se sale)
  fs.cpSync(A.userData, path.join(base, 'E', 'userData'), { recursive: true });
  const E = crearEntorno(path.join(base, 'E'), 'WIN-E'); preparar(E, 'GUID-E', []); E.run('demoraIntento = 0');
  ok(await E.run('verificarEquipo()') === false && !E.ctx.__borrado && arch(E).data, 'E: si solo se cancela, no se borra (el programa simplemente no abre)');
  // F) el mismo equipo (datos legítimos) pero se olvidó la clave: 5 fallos → NO borra (no es una copia ajena)
  fs.cpSync(A.userData, path.join(base, 'F', 'userData'), { recursive: true });
  const F = crearEntorno(path.join(base, 'F'), 'WIN-A'); preparar(F, 'GUID-A', []); F.run('demoraIntento = 0');
  fs.rmSync(path.join(F.userData, 'activacion.bin'));                                 // como una actualización desde una versión anterior
  F.ctx.__resp = ['m1', 'm2', 'm3', 'm4', 'm5'];
  ok(await F.run('verificarEquipo()') === false && !F.ctx.__borrado && arch(F).data, 'F: mismo equipo, clave olvidada → no se autoriza pero tampoco se borra nada');
  // G) disco clonado: misma Windows (DPAPI descifra) pero otro hardware, 5 fallos → se trata como copia ajena
  fs.cpSync(A.userData, path.join(base, 'G', 'userData'), { recursive: true });
  const G = crearEntorno(path.join(base, 'G'), 'WIN-A'); preparar(G, 'GUID-CLONADO', ['q', 'q', 'q', 'q', 'q']); G.run('demoraIntento = 0');
  ok(await G.run('verificarEquipo()') === false && G.ctx.__borrado, 'G: disco clonado en otro hardware + clave incorrecta → se borra');
  // H) lectura fallida del hardware en el MISMO equipo (PowerShell lento / antivirus): no debe acusarse de copia ni borrar
  const H = crearEntorno(path.join(base, 'A'), 'WIN-A'); preparar(H, '', []); H.run('demoraIntento = 0');
  ok(await H.run('verificarEquipo()') === true && H.ctx.__pedidas === 0 && !H.ctx.__borrado, 'H: si no se pudo leer ningún dato del equipo, se confía en la autorización existente (sin preguntar ni borrar)');
  const I = crearEntorno(path.join(base, 'A'), 'WIN-A'); preparar(I, 'GUID-A', []); I.ctx.__uuid = ''; 
  ok(await I.run('verificarEquipo()') === true && I.ctx.__pedidas === 0, 'I: si solo falla la lectura del UUID de la placa, el equipo se reconoce por el otro dato');
  fs.rmSync(base, { recursive: true, force: true });
  console.log(fallos ? `\n${fallos} PRUEBA(S) FALLARON` : '\nTodas las pruebas de autorización y anticopia pasaron'); process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
