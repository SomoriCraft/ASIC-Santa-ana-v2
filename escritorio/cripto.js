'use strict';
// Criptografía local de Farmacia CDI (sin dependencias). Todo con AES-256-GCM:
//  · Los respaldos (.cdibak) se cifran con una llave aleatoria por archivo; esa llave viaja "envuelta" con una llave derivada de la CLAVE MAESTRA.
//    Así un respaldo copiado a una USB es ilegible sin la clave maestra, y se puede restaurar en cualquier PC conociéndola.
//  · Las claves internas del sistema (config) tienen además un "sobre" (config.mk) cifrado con la clave maestra, para poder migrar a otra PC con autorización.
const crypto = require('crypto');
const fs = require('fs');

const MAGIA_RESP = Buffer.from('CDIB2'), MAGIA_SOBRE = Buffer.from('CDIK1'), CAB = 93;      // 5 magia + 16 sal + 12 iv + 32 llave + 16 etiqueta + 12 iv datos
const derivarLlave = (maestra, sal) => crypto.scryptSync(String(maestra).normalize('NFC'), sal, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const nuevaSal = () => crypto.randomBytes(16);

// ---- respaldos ----
function cifrarArchivo(src, dst, llave, sal) {
  return new Promise((ok, mal) => {
    const fk = crypto.randomBytes(32), wiv = crypto.randomBytes(12), w = crypto.createCipheriv('aes-256-gcm', llave, wiv);
    const wk = Buffer.concat([w.update(fk), w.final()]), wtag = w.getAuthTag(), div = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', fk, div);
    const inp = fs.createReadStream(src), out = fs.createWriteStream(dst);
    const falla = e => { try { out.destroy(); fs.rmSync(dst, { force: true }); } catch {} mal(e); };
    out.write(Buffer.concat([MAGIA_RESP, sal, wiv, wk, wtag, div]));
    inp.on('error', falla); c.on('error', falla); out.on('error', falla);
    inp.pipe(c).pipe(out, { end: false });
    c.on('end', () => out.end(c.getAuthTag(), ok));
  });
}
function leerCabecera(src) {
  const fd = fs.openSync(src, 'r'), h = Buffer.alloc(CAB);
  try { if (fs.readSync(fd, h, 0, CAB, 0) < CAB) throw new Error('Archivo de respaldo incompleto'); } finally { fs.closeSync(fd); }
  if (!h.subarray(0, 5).equals(MAGIA_RESP)) throw new Error('No es un respaldo cifrado de Farmacia CDI');
  return { sal: h.subarray(5, 21), wiv: h.subarray(21, 33), wk: h.subarray(33, 65), wtag: h.subarray(65, 81), div: h.subarray(81, 93) };
}
const esRespaldoCifrado = src => { try { leerCabecera(src); return true; } catch { return false; } };
function descifrarArchivo(src, dst, llave) {
  return new Promise((ok, mal) => {
    let H, fk; const size = fs.statSync(src).size;
    try { H = leerCabecera(src); } catch (e) { return mal(e); }
    try { const w = crypto.createDecipheriv('aes-256-gcm', llave, H.wiv); w.setAuthTag(H.wtag); fk = Buffer.concat([w.update(H.wk), w.final()]); }
    catch { return mal(new Error('Clave maestra incorrecta o respaldo alterado')); }
    if (size < CAB + 16) return mal(new Error('Archivo de respaldo incompleto'));
    const tag = Buffer.alloc(16), fd = fs.openSync(src, 'r'); fs.readSync(fd, tag, 0, 16, size - 16); fs.closeSync(fd);
    const d = crypto.createDecipheriv('aes-256-gcm', fk, H.div); d.setAuthTag(tag);
    if (size === CAB + 16) { try { d.final(); fs.writeFileSync(dst, ''); return ok(); } catch { return mal(new Error('El respaldo está dañado o fue alterado')); } }   // contenido vacío
    const inp = fs.createReadStream(src, { start: CAB, end: size - 17 }), out = fs.createWriteStream(dst);
    let hecho = false;
    const falla = () => { if (hecho) return; hecho = true; try { out.destroy(); fs.rmSync(dst, { force: true }); } catch {} mal(new Error('El respaldo está dañado o fue alterado')); };
    inp.on('error', falla); d.on('error', falla); out.on('error', falla);
    out.on('finish', () => { if (!hecho) { hecho = true; ok(); } });
    inp.pipe(d).pipe(out);
  });
}

// ---- sobre de las claves internas (config.mk) ----
function sobreEscribir(ruta, obj, llave, sal) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', llave, iv), enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  fs.writeFileSync(ruta, Buffer.concat([MAGIA_SOBRE, sal, iv, c.getAuthTag(), enc]));
}
const sobreSal = ruta => { const b = fs.readFileSync(ruta); if (!b.subarray(0, 5).equals(MAGIA_SOBRE)) throw new Error('Sobre inválido'); return b.subarray(5, 21); };
function sobreLeer(ruta, llave) {
  const b = fs.readFileSync(ruta); if (!b.subarray(0, 5).equals(MAGIA_SOBRE)) throw new Error('Sobre inválido');
  const d = crypto.createDecipheriv('aes-256-gcm', llave, b.subarray(21, 33)); d.setAuthTag(b.subarray(33, 49));
  return JSON.parse(Buffer.concat([d.update(b.subarray(49)), d.final()]).toString('utf8'));
}

// ---- huella del equipo ----
const huellaEquipo = (machineGuid, uuidBios) => crypto.createHash('sha256').update(`cdi|${String(machineGuid).toLowerCase()}|${String(uuidBios).toLowerCase()}`).digest('hex');
const codigoEquipo = huella => huella.slice(0, 12).toUpperCase().replace(/(.{4})/g, '$1-').slice(0, 14);

// ---- borrado: sobrescribe antes de eliminar (en SSD no es una garantía absoluta) ----
function borrarArchivoSeguro(f) {
  try {
    const st = fs.statSync(f);
    if (st.isFile()) { if (st.size <= 64 * 1024 * 1024) { const fd = fs.openSync(f, 'r+'); try { const z = Buffer.alloc(Math.min(st.size, 1 << 20)); for (let o = 0; o < st.size; o += z.length) fs.writeSync(fd, crypto.randomFillSync(z), 0, Math.min(z.length, st.size - o), o); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } } fs.rmSync(f, { force: true }); }
  } catch { try { fs.rmSync(f, { force: true }); } catch {} }
}
function borrarCarpetaSegura(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = require('path').join(dir, e.name); e.isDirectory() ? borrarCarpetaSegura(p) : borrarArchivoSeguro(p); }
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 400 });
}
module.exports = { derivarLlave, nuevaSal, cifrarArchivo, descifrarArchivo, leerCabecera, esRespaldoCifrado, sobreEscribir, sobreLeer, sobreSal, huellaEquipo, codigoEquipo, borrarArchivoSeguro, borrarCarpetaSegura, CAB };
