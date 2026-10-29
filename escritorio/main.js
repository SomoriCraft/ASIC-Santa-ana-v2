// Farmacia CDI - programa de escritorio (v1.0.1). Arranca PostgreSQL portátil + la API y abre la ventana.
const { app, BrowserWindow, Menu, ipcMain, dialog, shell, safeStorage, net: redEl, powerMonitor, session } = require('electron');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), net = require('net'), http = require('http'), crypto = require('crypto'), os = require('os');
const { pathToFileURL } = require('url');
const { Readable } = require('stream');
const pg = require('pg'), bcrypt = require('bcryptjs');

const RES = app.isPackaged ? process.resourcesPath : path.join(__dirname, 'recursos');
const exe = n => path.join(RES, 'pgsql', 'bin', n + '.exe');
const SRC = path.join(__dirname, 'app-src');
const USER = app.getPath('userData');
const DATA = path.join(USER, 'pgdata'), CFG = path.join(USER, 'config.bin'), LOG = path.join(USER, 'postgres.log');
const ARR = path.join(USER, 'arranque.log'), MARCA = path.join(USER, 'initdb-ok'), BDFLAG = path.join(USER, 'bd-lista');
const BACKUPS = path.join(app.getPath('documents'), 'Farmacia CDI', 'Respaldos');
const CRIPTO = require('./cripto');
const CFG_MK = path.join(USER, 'config.mk'), ACT = path.join(USER, 'activacion.bin'), TMP = path.join(USER, 'tmp');
let demoraIntento = 1500;      // pausa entre intentos de clave maestra (ms)
const esResp = f => /\.(dump|cdibak)$/.test(f);
const rand = () => crypto.randomBytes(24).toString('hex');
let cerrando = false;
const est = { cfg: null, pgPort: 0, listo: false, win: null, saliendo: false, llaveMk: null, mkSalt: null };

// ---- registro de arranque (ayuda a diagnosticar problemas) ----
function log(m) { try { fs.mkdirSync(USER, { recursive: true }); fs.appendFileSync(ARR, `${new Date().toISOString()} ${m}\n`); } catch {} }
const cola = (f, n = 900) => { try { return fs.readFileSync(f, 'utf8').slice(-n); } catch { return '(sin registro)'; } };
process.on('uncaughtException', e => log('EXCEPCIÓN NO CONTROLADA: ' + (e && e.stack || e)));
process.on('unhandledRejection', e => log('PROMESA RECHAZADA: ' + (e && e.stack || e)));

// ---- instancia única: si ya hay otra abierta, ESTA se cierra de inmediato (sin tocar la base de datos) ----
const unica = app.requestSingleInstanceLock();
if (!unica) app.exit(0);
app.on('second-instance', () => { if (est.win) { if (est.win.isMinimized()) est.win.restore(); est.win.focus(); } });

// ---- configuración secreta (cifrada con la cuenta de Windows cuando es posible) ----
const loadCfg = () => {
  try { const b = fs.readFileSync(CFG); return JSON.parse(safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(b) : b.toString()); }
  catch (e) { if (fs.existsSync(CFG)) log('No se pudo leer config.bin: ' + e.message); return null; }
};
const saveCfg = c => {
  const t = JSON.stringify(c); fs.writeFileSync(CFG, safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(t) : Buffer.from(t));
  if (est.llaveMk) { try { CRIPTO.sobreEscribir(CFG_MK, c, est.llaveMk, est.mkSalt); } catch (e) { log('No se pudo actualizar el sobre de claves: ' + e.message); } }
};

const freePort = (pref = 0) => new Promise(res => {
  const s = net.createServer();
  s.once('error', () => freePort(0).then(res));
  s.listen(pref, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});
const esperar = (url, n = 60) => new Promise((ok, mal) => {
  const t = () => http.get(url, r => { r.resume(); ok(); }).on('error', () => n-- > 0 ? setTimeout(t, 500) : mal(new Error('El servidor interno no respondió en 30 segundos')));
  t();
});

// Códigos de salida de Windows que significan algo concreto
const PISTAS = {
  3221225781: 'Windows no encontró una librería (DLL). Instale «Microsoft Visual C++ Redistributable x64» (gratis, de microsoft.com) y abra el programa otra vez.',
  3221225477: 'Acceso denegado en memoria: casi siempre es el antivirus bloqueando PostgreSQL. Agregue una excepción para la carpeta del programa.',
  3221226505: 'PostgreSQL se cerró de forma inesperada: revise el antivirus y que el disco tenga espacio libre.',
};
const matar = pid => { try { spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch {} };

// Ejecuta un programa SIN colgarse. pg_ctl start deja PostgreSQL en segundo plano: con pipes Windows nunca daría
// por terminada la llamada, por eso pipes:false en ese caso. Si se pasa el tiempo, se mata el programa y sus hijos.
function ejecutar(cmd, args, { env, timeout = 120000, pipes = true } = {}) {
  return new Promise((ok, mal) => {
    log('> ' + path.basename(cmd) + ' ' + args.filter(a => !String(a).startsWith('--pwfile')).join(' ').slice(0, 300));
    let salida = '';
    let p;
    try { p = spawn(cmd, args, { env: env || process.env, windowsHide: true, stdio: pipes ? ['ignore', 'pipe', 'pipe'] : 'ignore' }); }
    catch (e) { log('  no se pudo lanzar: ' + e.message); return mal(e); }
    const t = setTimeout(() => { matar(p.pid); try { p.kill(); } catch {}
      mal(new Error(`Tiempo agotado (${timeout / 1000} s) en ${path.basename(cmd)} ${args[0]}`)); }, timeout);
    if (pipes) { p.stdout.on('data', d => { salida += d; }); p.stderr.on('data', d => { salida += d; }); }
    p.on('error', e => { clearTimeout(t); log('  error ' + e.message); mal(e); });
    p.on('exit', code => setTimeout(() => {
      clearTimeout(t); log('  salida ' + code + (salida ? '\n' + salida.slice(-1500).trim().replace(/^/gm, '    ') : ''));
      code === 0 ? ok(salida) : mal(new Error(`${path.basename(cmd)} terminó con código ${code}${PISTAS[code] ? '\n' + PISTAS[code] : ''}\n${salida.slice(-600)}`));
    }, 150));
  });
}

// ---- PostgreSQL portátil ----
const borrarCarpeta = d => fs.rmSync(d, { recursive: true, force: true, maxRetries: 8, retryDelay: 500 });
async function initdb(cfg) {
  borrarCarpeta(DATA);
  const pw = path.join(USER, 'pw.tmp'); fs.writeFileSync(pw, cfg.pgPass);
  const base = ['-D', DATA, '-U', 'postgres', '-A', 'scram-sha-256', '--pwfile=' + pw, '-E', 'UTF8', '--locale=C', '--no-sync'];
  const T = 420000;   // en PC lentas o con antivirus puede tardar varios minutos
  try {
    try { await ejecutar(exe('initdb'), [...base, '--locale-provider=icu', '--icu-locale=es'], { timeout: T }); }   // búsquedas sin distinguir acentos
    catch (e) { log('initdb con ICU falló, reintento sin ICU: ' + e.message); borrarCarpeta(DATA); await ejecutar(exe('initdb'), base, { timeout: T }); }
  } finally { fs.rmSync(pw, { force: true }); }
}
const pgStop = async () => { try { await ejecutar(exe('pg_ctl'), ['stop', '-m', 'fast', '-D', DATA], { timeout: 60000 }); } catch {} };
// Si quedó un PostgreSQL de una ejecución anterior, se detiene
const detener = async () => { if (!fs.existsSync(DATA)) return; try { await ejecutar(exe('pg_ctl'), ['status', '-D', DATA], { timeout: 20000 }); await pgStop(); } catch {} };
// Mata cualquier postgres.exe / initdb.exe que haya quedado huérfano de un intento anterior (solo los de ESTE programa)
async function limpiarHuerfanos() {
  if (process.platform !== 'win32') return;
  const dir = path.join(RES, 'pgsql').replace(/'/g, "''");
  const cmd = `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${dir}', [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  try { await ejecutar('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', cmd], { timeout: 30000 }); }
  catch (e) { log('limpieza de procesos: ' + e.message); }
}
async function pgStart(port) {
  await detener();
  try {
    await ejecutar(exe('pg_ctl'), ['start', '-w', '-t', '90', '-D', DATA, '-l', LOG, '-o', `-p ${port} -c listen_addresses=127.0.0.1 -c max_connections=40 -c fsync=on -c synchronous_commit=on -c full_page_writes=on`], { pipes: false, timeout: 120000 });
  } catch (e) { throw new Error(e.message + '\n\nÚltimas líneas de PostgreSQL:\n' + cola(LOG)); }
}
async function cliente(db) {
  const c = new pg.Client({ host: '127.0.0.1', port: est.pgPort, user: 'postgres', password: est.cfg.pgPass, database: db, connectionTimeoutMillis: 20000 });
  await c.connect(); return c;
}
async function prepararBD() {
  if (fs.existsSync(BDFLAG)) return;
  let c = await cliente('postgres');
  await c.query('DROP DATABASE IF EXISTS cdi'); await c.query('CREATE DATABASE cdi'); await c.end();
  c = await cliente('cdi');
  const dir = path.join(SRC, 'db');
  for (const f of fs.readdirSync(dir).filter(f => /^0\d_.*\.sql$/.test(f)).sort()) {
    log('ejecutando ' + f);
    try { await c.query(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { throw new Error(`Archivo ${f}: ${e.message}`); }
  }
  await c.query(`ALTER ROLE app_farmacia PASSWORD '${est.cfg.appPass}'`);
  await c.end();
  fs.writeFileSync(BDFLAG, 'ok');
}
// Migraciones: cambios de base de datos de versiones nuevas (también se aplican a instalaciones ya existentes)
async function migrar() {
  const dir = path.join(SRC, 'db', 'migraciones'); if (!fs.existsSync(dir)) return;
  const c = await cliente('cdi');
  try {
    await c.query('CREATE TABLE IF NOT EXISTS schema_migraciones (nombre TEXT PRIMARY KEY, aplicada TIMESTAMPTZ NOT NULL DEFAULT now())');
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
      if ((await c.query('SELECT 1 FROM schema_migraciones WHERE nombre=$1', [f])).rowCount) continue;
      log('migración ' + f);
      try { await c.query('BEGIN'); await c.query(fs.readFileSync(path.join(dir, f), 'utf8')); await c.query('INSERT INTO schema_migraciones (nombre) VALUES ($1)', [f]); await c.query('COMMIT'); }
      catch (e) { await c.query('ROLLBACK'); throw new Error(`Migración ${f}: ${e.message}`); }
    }
  } finally { await c.end(); }
}
async function hayUsuarios() {
  const c = await cliente('cdi');
  try { return (await c.query('SELECT count(*)::int AS n FROM usuarios')).rows[0].n > 0; } finally { await c.end(); }
}

// ---- primer uso: crear al Regente ----
function pedirAdmin() {
  return new Promise(resolve => {
    const w = new BrowserWindow({ width: 520, height: 700, title: 'Configuración inicial', autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true } });
    w.loadFile(path.join(__dirname, 'setup.html'));
    let hecho = false;
    ipcMain.handle('crear-admin', async (e, d) => {
      try {
        if (e.sender !== w.webContents) throw new Error('No autorizado');
        const t = x => String(x ?? '').trim();
        d = { institucion: t(d.institucion), nombre: t(d.nombre).replace(/\s+/g, ' '), cedula: t(d.cedula).toUpperCase().replace(/[\s.\-]/g, ''),
              matricula: t(d.matricula), usuario: t(d.usuario), clave: String(d.clave ?? '') };
        if (d.institucion.length < 3 || d.institucion.length > 100) throw new Error('Institución: 3 a 100 caracteres');
        if (d.nombre.length < 3 || d.nombre.length > 150 || !/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ .'\-]+$/.test(d.nombre)) throw new Error('Nombre completo: solo letras y espacios');
        if (!/^[VE]\d{6,9}$/.test(d.cedula)) throw new Error('Cédula: V o E seguida de 6 a 9 números');
        if (d.matricula && !/^[A-Za-z0-9.\-\/ ]{3,30}$/.test(d.matricula)) throw new Error('Matrícula: 3 a 30 caracteres (letras, números, punto, guion o barra)');
        if (!/^[A-Za-z0-9_.-]{3,30}$/.test(d.usuario)) throw new Error('Usuario: 3 a 30 letras o números, sin espacios');
        if (d.clave.length < 10 || d.clave.length > 128 || !/[a-z]/.test(d.clave) || !/[A-Z]/.test(d.clave) || !/\d/.test(d.clave)) throw new Error('La clave debe tener mínimo 10 caracteres con mayúscula, minúscula y número');
        if (d.clave === 'Farmacia1234.') throw new Error('Elija una clave distinta a la temporal del sistema');
        const c = await cliente('cdi');
        try {
          await c.query(`INSERT INTO usuarios (cedula,nombre_completo,cargo,matricula_mpps,rol,username,password_hash,es_principal)
                         VALUES ($1,$2,'Farmacéutico Regente',$3,'FARMACEUTICO_REGENTE',$4,$5,TRUE)`,
            [d.cedula, d.nombre, d.matricula || null, d.usuario, await bcrypt.hash(d.clave, 12)]);
        } finally { await c.end(); }
        est.cfg.institucion = d.institucion || est.cfg.institucion; saveCfg(est.cfg);
        hecho = true; setTimeout(() => w.close(), 600);
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    w.on('closed', () => { ipcMain.removeHandler('crear-admin'); resolve(hecho); });
  });
}

// ---- respaldos ----
const HORA_RESPALDO = 17;      // respaldo automático de fin de día (hora local) si la PC sigue encendida
const EXTRA_CFG = path.join(USER, 'respaldo-extra.json');
const rutaExtra = () => { try { return JSON.parse(fs.readFileSync(EXTRA_CFG, 'utf8')).ruta || ''; } catch { return ''; } };
const hoyLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
async function unidadesUSB() {
  if (process.platform !== 'win32') return [];
  try {
    const out = await ejecutar('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=2' | ForEach-Object { $_.DeviceID }"], { timeout: 20000 });
    return out.split(/\r?\n/).map(x => x.trim()).filter(x => /^[A-Z]:$/.test(x));
  } catch { return []; }
}
function copiarA(dir, archivo, max = 30) {
  fs.mkdirSync(dir, { recursive: true }); fs.copyFileSync(archivo, path.join(dir, path.basename(archivo)));
  const todos = fs.readdirSync(dir).filter(esResp).sort(); while (todos.length > max) fs.rmSync(path.join(dir, todos.shift()));
}
// Copia el respaldo a la carpeta adicional configurada y a toda USB conectada. Nunca lanza error: es un seguro extra.
async function replicarRespaldo(archivo) {
  const destinos = [], ex = rutaExtra(); if (ex) destinos.push(ex);
  for (const u of await unidadesUSB()) destinos.push(path.join(u + '\\', 'Respaldos Farmacia CDI'));
  const ok = [];
  for (const d of destinos) { try { copiarA(d, archivo); ok.push(d); } catch (e) { log('Copia de respaldo a ' + d + ' falló: ' + e.message); } }
  log(ok.length ? 'Respaldo copiado a: ' + ok.join(' | ') : 'Respaldo sin copia externa (no hay USB ni carpeta adicional disponible)');
  est.replicas = ok; return ok;
}
let respaldando = false;
// Respaldo: pg_dump comprimido → se verifica → se CIFRA (AES-256-GCM, llave envuelta con la clave maestra) → se copia a USB / carpeta adicional.
// El archivo temporal sin cifrar vive en una carpeta privada y se elimina enseguida.
async function respaldo(forzar, etiqueta = '') {
  if (!est.llaveMk) throw new Error('Este equipo no está autorizado: no se puede cifrar el respaldo');
  fs.mkdirSync(BACKUPS, { recursive: true }); fs.mkdirSync(TMP, { recursive: true });
  const ahora = new Date(), hoy = hoyLocal();
  if (!forzar && fs.readdirSync(BACKUPS).some(f => f.startsWith('cdi_' + hoy))) return null;
  if (respaldando) return null; respaldando = true;
  const hh = `${String(ahora.getHours()).padStart(2, '0')}-${String(ahora.getMinutes()).padStart(2, '0')}`;
  const base = `cdi_${hoy}_${hh}${etiqueta ? '_' + etiqueta : ''}`, plano = path.join(TMP, base + '.dump'), dest = path.join(BACKUPS, base + '.cdibak');
  try {
    await ejecutar(exe('pg_dump'), ['-h', '127.0.0.1', '-p', String(est.pgPort), '-U', 'postgres', '-Fc', '-Z', '6', '-f', plano, 'cdi'],
      { env: { ...process.env, PGPASSWORD: est.cfg.pgPass }, timeout: 600000 });
    await ejecutar(exe('pg_restore'), ['-l', plano], { pipes: false, timeout: 120000 })            // se comprueba que sea legible antes de cifrarlo
      .catch(e => { throw new Error('El respaldo salió dañado y se descartó: ' + e.message); });
    await CRIPTO.cifrarArchivo(plano, dest, est.llaveMk, est.mkSalt);
    const todos = fs.readdirSync(BACKUPS).filter(esResp).sort();
    while (todos.length > 60) CRIPTO.borrarArchivoSeguro(path.join(BACKUPS, todos.shift()));
    await replicarRespaldo(dest);
    return dest;
  } finally { CRIPTO.borrarArchivoSeguro(plano); respaldando = false; }
}
// Respaldos antiguos sin cifrar (de versiones anteriores): se cifran y se elimina el original
async function migrarRespaldosPlanos() {
  if (!est.llaveMk || !fs.existsSync(BACKUPS)) return;
  try {
    for (const f of fs.readdirSync(BACKUPS).filter(f => f.endsWith('.dump'))) {
      const src = path.join(BACKUPS, f), dst = src.replace(/\.dump$/, '.cdibak');
      await CRIPTO.cifrarArchivo(src, dst, est.llaveMk, est.mkSalt); CRIPTO.borrarArchivoSeguro(src); log('Respaldo antiguo cifrado: ' + f);
    }
  } catch (e) { log('Cifrado de respaldos antiguos: ' + e.message); }
}
// Respaldo de fin de día y copia automática cuando se conecta una USB
function vigilarRespaldos() {
  let usbVistas = new Set();
  setInterval(async () => {
    if (est.saliendo || actualizando) return;
    try {
      if (new Date().getHours() >= HORA_RESPALDO) { const d = await respaldo(false, 'findia'); if (d) log('Respaldo de fin de día: ' + d); }
      const usb = new Set(await unidadesUSB());
      const nuevas = [...usb].filter(u => !usbVistas.has(u));
      if (nuevas.length) {            // se conectó una USB: se le copia el respaldo más reciente
        const ult = fs.readdirSync(BACKUPS).filter(esResp).sort().pop();
        if (ult) for (const u of nuevas) { try { copiarA(path.join(u + '\\', 'Respaldos Farmacia CDI'), path.join(BACKUPS, ult)); log('Respaldo copiado a la USB ' + u); } catch (e) { log('USB ' + u + ': ' + e.message); } }
      }
      usbVistas = usb;
    } catch (e) { log('Vigilancia de respaldos: ' + e.message); }
  }, 10 * 60e3);
}
async function restaurar() {
  const r = await dialog.showOpenDialog(est.win, { title: 'Elija el respaldo a restaurar', defaultPath: BACKUPS, filters: [{ name: 'Respaldos de Farmacia CDI', extensions: ['cdibak', 'dump'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return;
  const f = r.filePaths[0];
  const c = await dialog.showMessageBox(est.win, { type: 'warning', buttons: ['Cancelar', 'Sí, restaurar'], defaultId: 0, cancelId: 0, noLink: true,
    message: '¿Restaurar este respaldo?', detail: `Los datos actuales serán REEMPLAZADOS por los de:\n${f}\n\nAntes se guardará una copia de seguridad de los datos de hoy, por si necesita volver atrás.` });
  if (c.response !== 1) return;
  let seg = '', plano = null;
  try {
    let archivo = f;
    if (CRIPTO.esRespaldoCifrado(f)) {
      const H = CRIPTO.leerCabecera(f); let llave;
      if (est.mkSalt && H.sal.equals(est.mkSalt)) llave = est.llaveMk;
      else {            // respaldo hecho en otra instalación: solo se abre con la clave maestra
        const m = await pedirMaestra({ titulo: 'Respaldo de otra instalación', texto: 'Este respaldo fue cifrado en otro equipo. Escriba la clave maestra del usuario principal para abrirlo.', intento: 0, max: 0 });
        if (m === null) return;
        if (!(await cargarMaestra())(m)) throw new Error('Clave maestra incorrecta');
        llave = CRIPTO.derivarLlave(m, H.sal);
      }
      fs.mkdirSync(TMP, { recursive: true }); plano = path.join(TMP, 'restaurar.dump');
      await CRIPTO.descifrarArchivo(f, plano, llave); archivo = plano;
    }
    seg = await respaldo(true, 'antes-de-restaurar');
    await ejecutar(exe('pg_restore'), ['--clean', '--if-exists', '--no-owner', '-h', '127.0.0.1', '-p', String(est.pgPort), '-U', 'postgres', '-d', 'cdi', archivo],
      { env: { ...process.env, PGPASSWORD: est.cfg.pgPass }, timeout: 600000 });
    log('Respaldo restaurado: ' + f);
    await dialog.showMessageBox(est.win, { type: 'info', message: 'Respaldo restaurado', detail: 'El sistema se recargará. Deberá iniciar sesión de nuevo.' });
    est.win.webContents.executeJavaScript('sessionStorage.clear()').catch(() => {}); est.win.reload();
  } catch (e) { log('restaurar: ' + e.message); dialog.showErrorBox('No se pudo restaurar', e.message + (seg ? '\n\nSus datos de antes están a salvo en:\n' + seg : '')); }
  finally { if (plano) CRIPTO.borrarArchivoSeguro(plano); }
}
async function copiarRespaldos() {
  const r = await dialog.showOpenDialog(est.win, { title: 'Elija la carpeta o USB donde copiar los respaldos', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return;
  try {
    fs.mkdirSync(BACKUPS, { recursive: true }); let n = 0;
    for (const f of fs.readdirSync(BACKUPS).filter(esResp)) { const d = path.join(r.filePaths[0], f); if (!fs.existsSync(d)) { fs.copyFileSync(path.join(BACKUPS, f), d); n++; } }
    dialog.showMessageBox(est.win, { type: 'info', message: n ? `Se copiaron ${n} respaldo(s)` : 'Todo ya estaba copiado', detail: r.filePaths[0] });
  } catch (e) { dialog.showErrorBox('No se pudo copiar', e.message); }
}

// ---- actualizaciones automáticas (desde las "Releases" de GitHub; el repositorio se escribe en actualizaciones.json) ----
let UPD_REPO = '';
try { UPD_REPO = String(JSON.parse(fs.readFileSync(path.join(__dirname, 'actualizaciones.json'), 'utf8')).repo || '').trim(); } catch {}
const vNum = v => String(v).replace(/^v/i, '').split('.').map(n => parseInt(n) || 0);
const esMayor = (a, b) => { const x = vNum(a), y = vNum(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
let actualizando = false;
async function buscarActualizacion(manual) {
  if (actualizando || !est.win) return;
  const info = (message, detail) => manual && dialog.showMessageBox(est.win, { type: 'info', message, detail });
  if (!/^[\w.-]+\/[\w.-]+$/.test(UPD_REPO)) return info('Las actualizaciones automáticas aún no están configuradas', 'Escriba el repositorio de GitHub (usuario/nombre) en escritorio/actualizaciones.json y genere el instalador de nuevo.');
  try {
    const r = await redEl.fetch(`https://api.github.com/repos/${UPD_REPO}/releases/latest`, { headers: { 'User-Agent': 'Farmacia-CDI', Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error('GitHub respondió ' + r.status);
    const rel = await r.json(), nueva = String(rel.tag_name || '');
    if (!esMayor(nueva, app.getVersion())) { log('Actualizaciones: al día (' + app.getVersion() + ')'); return info('Su programa está al día', 'Versión ' + app.getVersion()); }
    const asset = (rel.assets || []).find(a => /\.exe$/i.test(a.name) && /instalador/i.test(a.name));
    if (!asset) throw new Error('La versión ' + nueva + ' no trae el instalador (.exe)');
    const q = await dialog.showMessageBox(est.win, { type: 'question', buttons: ['Descargar e instalar', 'Más tarde'], defaultId: 0, cancelId: 1, noLink: true,
      message: 'Hay una versión nueva: ' + nueva, detail: `Usted tiene la ${app.getVersion()}. Se descargará (${Math.round(asset.size / 1048576)} MB), se hará un respaldo de sus datos y se abrirá el instalador. Sus datos se conservan.` });
    if (q.response !== 0) return;
    actualizando = true;
    const dest = path.join(app.getPath('temp'), asset.name), d = await redEl.fetch(asset.browser_download_url);
    if (!d.ok) throw new Error('No se pudo descargar (' + d.status + ')');
    const ws = fs.createWriteStream(dest), hash = crypto.createHash('sha256'); let got = 0;
    for await (const chunk of Readable.fromWeb(d.body)) { got += chunk.length; hash.update(chunk); if (!ws.write(chunk)) await new Promise(ok => ws.once('drain', ok)); est.win.setProgressBar(got / asset.size); }
    await new Promise(ok => ws.end(ok)); est.win.setProgressBar(-1);
    if (asset.size && got !== asset.size) throw new Error('La descarga quedó incompleta; intente de nuevo');
    if (/^sha256:/i.test(asset.digest || '') && asset.digest.slice(7).toLowerCase() !== hash.digest('hex')) { fs.rmSync(dest, { force: true }); throw new Error('La descarga no coincide con la firma de GitHub (sha256)'); }
    await respaldo(true, 'antes-de-actualizar');          // si el respaldo falla, NO se actualiza
    cerrando = true; await pgStop();
    spawn(dest, [], { detached: true, stdio: 'ignore' }).unref();
    log('Actualización: se abre el instalador ' + asset.name); app.exit(0);
  } catch (e) {
    actualizando = false; try { est.win.setProgressBar(-1); } catch {}
    log('Actualizaciones: ' + e.message); if (manual) dialog.showErrorBox('No se pudo actualizar', e.message);
  }
}
// Guardar el manual (u otro documento HTML generado por el sistema) como PDF, sin visores externos
ipcMain.handle('guardar-pdf', async (ev, { html, nombre }) => {
  if (!est.win || ev.sender !== est.win.webContents) throw new Error('No autorizado');
  if (typeof html !== 'string' || html.length > 5e6) throw new Error('Documento inválido');
  const w = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } });
  try {
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const pdf = await w.webContents.printToPDF({ pageSize: 'Letter', printBackground: true });
    const r = await dialog.showSaveDialog(est.win, { defaultPath: path.join(app.getPath('documents'), path.basename(String(nombre || 'documento.pdf')).replace(/[^\w.\- ]/g, '_')), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, pdf); return r.filePath;
  } finally { w.destroy(); }
});

// ---- Autorización del equipo: el programa y sus datos solo funcionan en el equipo autorizado con la clave maestra ----
let _verMaestra = null;
async function cargarMaestra() { if (!_verMaestra) _verMaestra = (await import(pathToFileURL(path.join(SRC, 'api', 'maestra.js')).href)).verMaestra; return _verMaestra; }
async function idEquipo() {          // huella del equipo: MachineGuid de Windows + UUID de la placa (un disco clonado en otra PC cambia de huella)
  if (process.platform !== 'win32') return { guid: os.hostname(), uuid: os.arch(), huella: CRIPTO.huellaEquipo(os.hostname(), os.arch()), confiable: false };
  let guid = '', uuid = '';
  try { const o = await ejecutar('reg.exe', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { timeout: 10000 }); guid = (o.match(/MachineGuid\s+REG_SZ\s+(\S+)/i) || [])[1] || ''; } catch {}
  try { const o = await ejecutar('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_ComputerSystemProduct).UUID'], { timeout: 25000 }); uuid = (o.trim().split(/\r?\n/)[0] || '').trim(); } catch {}
  return { guid, uuid, huella: CRIPTO.huellaEquipo(guid || os.hostname(), uuid), confiable: !!guid };
}
// true si coincide; false SOLO cuando hay una diferencia comprobada (nunca por un dato que no se pudo leer en este momento)
function mismoEquipo(act, eq) {
  if (!act) return false;
  let comparados = 0;
  for (const [a, b] of [[act.g, eq.guid], [act.u, eq.uuid]]) if (a && b) { if (a !== b) return false; comparados++; }
  return comparados > 0 || (!eq.guid && !eq.uuid);
}
function leerActivacion() {
  try { const b = fs.readFileSync(ACT); const t = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(b) : b.toString(); const a = JSON.parse(t);
    return a && a.m && a.salt && a.key ? a : null; } catch { return null; }
}
function pedirMaestra({ titulo, texto, codigo = '', aviso = false, intento = 0, max = 0, error = '' }) {
  return new Promise(res => {
    const w = new BrowserWindow({ width: 520, height: 470, resizable: false, minimizable: false, maximizable: false, title: titulo, autoHideMenuBar: true, alwaysOnTop: true,
      webPreferences: { preload: path.join(__dirname, 'preload-activar.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, devTools: false } });
    let listo = false;
    ipcMain.removeHandler('activar-enviar'); ipcMain.removeHandler('activar-cancelar');
    ipcMain.handle('activar-enviar', (e, v) => { if (e.sender !== w.webContents) throw new Error('No autorizado'); listo = true; res(String(v || '')); setTimeout(() => { try { w.close(); } catch {} }, 30); return true; });
    ipcMain.handle('activar-cancelar', e => { if (e.sender !== w.webContents) throw new Error('No autorizado'); listo = true; res(null); setTimeout(() => { try { w.close(); } catch {} }, 30); return true; });
    w.on('closed', () => { ipcMain.removeHandler('activar-enviar'); ipcMain.removeHandler('activar-cancelar'); if (!listo) res(null); });
    w.loadFile(path.join(__dirname, 'activar.html'), { query: { t: titulo, x: texto, c: codigo, a: aviso ? '1' : '', i: String(intento), m: String(max), e: error } });
  });
}
async function borrarCopiaNoAutorizada(motivo) {
  log('COPIA NO AUTORIZADA (' + motivo + '): se elimina la información de este equipo');
  try { await limpiarHuerfanos(); } catch {}
  for (const d of [DATA, TMP]) { try { CRIPTO.borrarCarpetaSegura(d); } catch (e) { log('borrado: ' + e.message); } }
  for (const f of [CFG, CFG_MK, ACT, MARCA, BDFLAG, LOG, EXTRA_CFG]) CRIPTO.borrarArchivoSeguro(f);
  try { if (fs.existsSync(BACKUPS)) for (const f of fs.readdirSync(BACKUPS).filter(esResp)) CRIPTO.borrarArchivoSeguro(path.join(BACKUPS, f)); } catch {}
  if (app.isPackaged) {           // el programa mismo se elimina cuando se cierre
    const dir = path.dirname(process.execPath);
    if (/farmacia/i.test(dir) && dir.length > 14) { try { spawn('cmd.exe', ['/c', `ping -n 5 127.0.0.1 >nul & rmdir /s /q "${dir}"`], { detached: true, windowsHide: true, stdio: 'ignore' }).unref(); } catch {} }
  }
}
async function autorizarEquipo(maestra, eq, act, cfgOk) {
  let sal;
  try { sal = fs.existsSync(CFG_MK) ? CRIPTO.sobreSal(CFG_MK) : (act && act.salt ? Buffer.from(act.salt, 'hex') : CRIPTO.nuevaSal()); } catch { sal = CRIPTO.nuevaSal(); }
  const llave = CRIPTO.derivarLlave(maestra, sal);
  let cfg = cfgOk ? loadCfg() : null;
  if (!cfg && fs.existsSync(CFG_MK)) { try { cfg = CRIPTO.sobreLeer(CFG_MK, llave); log('Claves internas recuperadas con la clave maestra'); } catch (e) { log('El sobre de claves no se pudo abrir: ' + e.message); } }
  est.llaveMk = llave; est.mkSalt = sal;
  if (cfg) saveCfg(cfg);           // las vuelve a cifrar para ESTE equipo y refresca el sobre
  const t = JSON.stringify({ m: eq.huella, g: eq.guid || '', u: eq.uuid || '', salt: sal.toString('hex'), key: llave.toString('hex') });
  fs.writeFileSync(ACT, safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(t) : Buffer.from(t));
  log('Equipo autorizado');
}
// Devuelve true si el equipo quedó autorizado. Si devuelve false, el programa debe cerrarse.
async function verificarEquipo() {
  if (app.isPackaged && process.platform === 'win32' && (await unidadesUSB()).includes(process.execPath.slice(0, 2).toUpperCase()))
    throw new Error('Por seguridad, el programa no puede ejecutarse desde una unidad USB. Instálelo en el disco de la computadora.');
  const eq = await idEquipo(), act = leerActivacion(), cfgOk = !!loadCfg(), hayDatos = fs.existsSync(MARCA) || fs.existsSync(DATA);
  if (act && mismoEquipo(act, eq) && fs.existsSync(CFG_MK)) { est.llaveMk = Buffer.from(act.key, 'hex'); est.mkSalt = Buffer.from(act.salt, 'hex'); return true; }
  const foraneo = hayDatos && (!cfgOk || (!!act && !mismoEquipo(act, eq)));       // datos que vienen de otro equipo (diferencia comprobada)
  clearTimeout(vigia); splash.hide();
  const verificar = await cargarMaestra(), MAX = 5;
  const texto = foraneo ? 'Estos datos pertenecen a otro equipo. Para usarlos aquí, el usuario principal debe autorizar este equipo con la clave maestra.'
    : (hayDatos ? 'Para proteger la información, confirme este equipo con la clave maestra del usuario principal (solo se pide una vez).' : 'Primera vez en este equipo: autorícelo con la clave maestra del usuario principal.');
  for (let i = 0; i < MAX; i++) {
    const m = await pedirMaestra({ titulo: 'Autorizar este equipo', texto, codigo: CRIPTO.codigoEquipo(eq.huella), aviso: foraneo, intento: i, max: MAX, error: i ? 'Clave maestra incorrecta.' : '' });
    if (m === null) { log('Autorización cancelada por la persona'); return false; }
    if (verificar(m)) { await autorizarEquipo(m, eq, act, cfgOk); splash.show(); return true; }
    log('Clave maestra incorrecta (' + (i + 1) + '/' + MAX + ')'); await new Promise(r => setTimeout(r, demoraIntento));
  }
  if (foraneo) { await borrarCopiaNoAutorizada('5 intentos fallidos con la clave maestra'); dialog.showMessageBoxSync({ type: 'error', title: 'Equipo no autorizado', message: 'Copia no autorizada', detail: 'La información copiada fue eliminada de este equipo.' }); }
  else dialog.showMessageBoxSync({ type: 'error', title: 'Equipo no autorizado', message: 'Clave maestra incorrecta', detail: 'Se agotaron los 5 intentos. Cierre y vuelva a abrir el programa.' });
  return false;
}
function menu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Archivo', submenu: [
      { label: 'Respaldo ahora', click: async () => { try { const d = await respaldo(true); dialog.showMessageBox({ message: 'Respaldo guardado en:\n' + d, detail: (est.replicas && est.replicas.length ? 'Copias en:\n' + est.replicas.join('\n') : 'Aún sin copia externa: conecte una USB o elija una carpeta adicional (Archivo → Carpeta de respaldo adicional).') }); } catch (e) { dialog.showErrorBox('No se pudo respaldar', e.message); } } },
      { label: 'Restaurar respaldo…', click: () => restaurar() },
      { label: 'Copiar respaldos a USB / otra carpeta…', click: () => copiarRespaldos() },
      { label: 'Carpeta de respaldo adicional…', click: async () => { const r = await dialog.showOpenDialog(est.win, { title: 'Carpeta donde se copiará cada respaldo (USB, disco externo o carpeta de red)', properties: ['openDirectory', 'createDirectory'] }); if (!r.canceled && r.filePaths[0]) { fs.writeFileSync(EXTRA_CFG, JSON.stringify({ ruta: r.filePaths[0] })); dialog.showMessageBox(est.win, { message: 'Carpeta adicional configurada', detail: r.filePaths[0] }); } } },
      { label: 'Abrir carpeta de respaldos', click: () => { fs.mkdirSync(BACKUPS, { recursive: true }); shell.openPath(BACKUPS); } },
      { label: 'Buscar actualizaciones…', click: () => buscarActualizacion(true) },
      { label: 'Ver registro de arranque', click: () => shell.openPath(ARR) },
      { type: 'separator' }, { role: 'quit', label: 'Salir' }] },
    { label: 'Ver', submenu: [{ role: 'reload', label: 'Recargar' }, { role: 'zoomIn', label: 'Acercar' }, { role: 'zoomOut', label: 'Alejar' }, { role: 'togglefullscreen', label: 'Pantalla completa' }] },
  ]));
}

// ---- arranque ----
let splash = null, paso = '', vigia = null;
const SPLASH = '<body style="font-family:Segoe UI,Arial,sans-serif;text-align:center;margin:0;padding-top:38px;color:#0f766e;background:#fff">'
  + '<h2 style="margin:0 0 6px">Farmacia CDI</h2><div style="font-size:16px">Iniciando el sistema…</div>'
  + '<div id="p" style="font-size:13px;color:#334155;margin:12px 14px 0;min-height:36px">Preparando…</div>'
  + '<div style="font-size:12px;color:#64748b;margin-top:8px">La primera vez puede tardar varios minutos.<br>Tiempo transcurrido: <span id="t">0</span> s</div>'
  + '<script>let s=0;setInterval(function(){document.getElementById("t").textContent=++s},1000)</script></body>';
const estado = txt => { try { if (splash && !splash.isDestroyed()) splash.webContents.executeJavaScript(`document.getElementById('p').textContent=${JSON.stringify(txt)}`).catch(() => {}); } catch {} };

// Cada paso tiene su propio límite. Si se pasa, NO se cierra: se avisa y el usuario decide.
function armar(seg) {
  clearTimeout(vigia);
  vigia = setTimeout(async () => {
    log('AVISO: el paso «' + paso + '» lleva más de ' + seg + ' s');
    estado('Está tardando más de lo normal en: ' + paso);
    const r = await dialog.showMessageBox({ type: 'warning', title: 'Farmacia CDI está tardando', noLink: true, defaultId: 0, cancelId: 0,
      message: 'Se detuvo en el paso: ' + paso,
      detail: 'Puede ser el antivirus revisando archivos nuevos (en la primera vez es normal que tarde).\n\nSi lleva más de 10 minutos, pulse «Abrir registro» y envíe ese archivo a quien le ayuda:\n' + ARR,
      buttons: ['Seguir esperando', 'Abrir registro', 'Cerrar el programa'] });
    if (r.response === 1) shell.openPath(ARR);
    if (r.response === 2) return salir(1);
    armar(240);
  }, seg * 1000);
}
const marca = (n, seg = 150) => { paso = n; log('PASO: ' + n); estado(n + '…'); armar(seg); };
async function salir(code) {
  est.saliendo = true; clearTimeout(vigia);
  try { await pgStop(); } catch {}
  await limpiarHuerfanos();
  app.exit(code);
}

// Endurecimiento: sin DevTools, sin navegar fuera de la PC, sin permisos del navegador, sin webviews
app.on('web-contents-created', (_e, c) => {
  c.on('will-attach-webview', ev => ev.preventDefault());
  c.on('will-navigate', (ev, url) => { if (!/^(file:|http:\/\/127\.0\.0\.1:|data:|about:)/i.test(url)) ev.preventDefault(); });
  c.setWindowOpenHandler(({ url }) => (url === 'about:blank' || /^http:\/\/127\.0\.0\.1:/.test(url))
    ? { action: 'allow', overrideBrowserWindowOptions: { webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, devTools: false } } } : { action: 'deny' });
});
if (unica) app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  splash = new BrowserWindow({ width: 460, height: 250, frame: false, resizable: false, backgroundColor: '#ffffff' });
  splash.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(SPLASH));
  // Si la persona cierra la ventanita de inicio, se sale limpiamente (sin dejar PostgreSQL abierto)
  splash.on('closed', () => { if (!est.listo && !est.saliendo) salir(0); });
  let aviso = null;
  try {
    fs.mkdirSync(USER, { recursive: true });
    try { if (fs.statSync(ARR).size > 1e6) fs.rmSync(ARR); } catch {}
    log(`==== Inicio v${app.getVersion()} | Electron ${process.versions.electron} | ${os.release()} ${os.arch()} | empaquetado=${app.isPackaged} ====`);
    log('Usuario: ' + os.userInfo().username + ' | datos: ' + USER + ' | programa: ' + RES);
    await ejecutar('fltmc.exe', [], { timeout: 8000 }).then(() => log('Ejecutándose como ADMINISTRADOR'), () => log('Ejecutándose como usuario normal'));

    marca('verificar la autorización de este equipo', 3600);
    if (!(await verificarEquipo())) { est.saliendo = true; try { splash.close(); } catch {} return app.exit(0); }
    try { CRIPTO.borrarCarpetaSegura(TMP); } catch {}              // restos de trabajos anteriores (nunca debe quedar nada sin cifrar)
    marca('revisar los archivos de PostgreSQL');
    for (const n of ['initdb', 'pg_ctl', 'postgres'])
      if (!fs.existsSync(exe(n))) throw new Error(`Falta ${n}.exe en:\n${path.join(RES, 'pgsql', 'bin')}\n\nReinstale el programa. Si un antivirus borró archivos, agregue una excepción para la carpeta del programa y reinstale.`);

    marca('cerrar restos de intentos anteriores');
    await detener(); await limpiarHuerfanos();

    marca('leer configuración');
    est.cfg = loadCfg();
    if (!est.cfg) {
      est.cfg = { pgPass: rand(), appPass: rand(), jwt: rand() + rand(), institucion: 'CDI Santa Ana' };
      saveCfg(est.cfg);
      if (fs.existsSync(MARCA)) {   // la clave guardada se perdió pero la base ya existe: se aparta (NO se borra) y se crea una nueva
        const vieja = path.join(USER, 'pgdata_anterior_' + Date.now());
        log('config.bin ausente o ilegible con base existente: se aparta pgdata en ' + vieja);
        try { fs.renameSync(DATA, vieja); aviso = 'No se pudo leer la clave interna de la base de datos anterior. Se creó una base nueva; la anterior se conservó en:\n' + vieja + '\n\nSus respaldos (.dump) siguen en Documentos\\Farmacia CDI\\Respaldos.'; } catch (e) { log('no se pudo apartar: ' + e.message); }
        fs.rmSync(MARCA, { force: true }); fs.rmSync(BDFLAG, { force: true });
      }
    }
    if (!fs.existsSync(MARCA)) {                       // primera vez (o una instalación que no terminó)
      marca('crear la base de datos (puede tardar varios minutos)', 450);
      fs.rmSync(BDFLAG, { force: true });
      await initdb(est.cfg); fs.writeFileSync(MARCA, 'ok');
    }
    est.pgPort = await freePort();
    marca('iniciar PostgreSQL (puerto ' + est.pgPort + ')', 200);
    await pgStart(est.pgPort);
    marca('preparar tablas y reglas', 240);
    await prepararBD();
    marca('actualizar la base de datos');
    await migrar();
    marca('revisar usuarios');
    if (!(await hayUsuarios())) {
      clearTimeout(vigia); splash.hide();
      paso = 'pantalla de bienvenida'; log('PASO: ' + paso);
      if (!(await pedirAdmin())) return salir(0);
      splash.show();
    }
    marca('iniciar el servicio del sistema');
    const port = await freePort(3000);
    Object.assign(process.env, {
      DATABASE_URL: `postgres://app_farmacia:${est.cfg.appPass}@127.0.0.1:${est.pgPort}/cdi`,
      JWT_SECRET: est.cfg.jwt, RESPALDOS: BACKUPS, APP_VERSION: app.getVersion(), PORT: String(port), HOST: '127.0.0.1', INSTITUCION: est.cfg.institucion });
    await import(pathToFileURL(path.join(SRC, 'api', 'server.js')).href);
    marca('esperar al servicio');
    await esperar(`http://127.0.0.1:${port}/config.json`);
    menu();
    const icono = path.join(SRC, 'web', 'icon-512.png');
    est.win = new BrowserWindow({ width: 1280, height: 820, title: 'Farmacia CDI', ...(fs.existsSync(icono) && { icon: icono }), webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, devTools: process.env.CDI_DEBUG === '1', preload: path.join(__dirname, 'preload-app.js') } });
    est.win.loadURL(`http://127.0.0.1:${port}/`);
    est.listo = true; clearTimeout(vigia); splash.close(); log('Sistema listo');
    vigilarRespaldos(); migrarRespaldosPlanos();
    powerMonitor.on('shutdown', () => { try { spawnSync(exe('pg_ctl'), ['stop', '-m', 'fast', '-D', DATA], { windowsHide: true, timeout: 15000 }); } catch {} });
    let ultBat = 0; powerMonitor.on('on-battery', () => { if (Date.now() - ultBat > 30 * 60e3) { ultBat = Date.now(); log('Sin energía eléctrica: se hace un respaldo preventivo'); respaldo(true, 'sinluz').catch(e => log('respaldo preventivo: ' + e.message)); } });
    setTimeout(() => buscarActualizacion(false), 30000); setInterval(() => buscarActualizacion(false), 6 * 3600e3);
    if (aviso) dialog.showMessageBox(est.win, { type: 'info', message: 'Aviso', detail: aviso });
  } catch (e) {
    est.saliendo = true; clearTimeout(vigia);
    log('ERROR en «' + paso + '»: ' + e.message);
    try { splash.close(); } catch {}
    dialog.showErrorBox('No se pudo iniciar Farmacia CDI', `Paso: ${paso}\n\n${e.message}\n\nRegistro (envíelo si pide ayuda):\n${ARR}`);
    await salir(1);
  }
});

app.on('before-quit', async ev => {
  if (cerrando || !est.listo) return;
  ev.preventDefault(); cerrando = true;
  try { await respaldo(false); } catch (e) { log('respaldo: ' + e.message); }
  await pgStop(); app.exit(0);
});
app.on('window-all-closed', () => { if (est.listo) app.quit(); });
