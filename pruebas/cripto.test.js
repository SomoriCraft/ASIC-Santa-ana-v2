// Prueba del cifrado de respaldos, el sobre de claves y el borrado seguro (se ejecuta con: node pruebas/cripto.test.js)
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const C = require('../escritorio/cripto.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdi-cripto-')); let fallos = 0;
const ok = (c, t) => { console.log((c ? 'OK     ' : 'FALLA  ') + t); if (!c) fallos++; };
(async () => {
  const sal = C.nuevaSal(), llave = C.derivarLlave('Clave de prueba 1', sal), otra = C.derivarLlave('Otra clave', sal);
  const plano = path.join(dir, 'a.dump'); fs.writeFileSync(plano, crypto.randomBytes(3 * 1024 * 1024 + 123));          // 3 MB + resto
  const enc = path.join(dir, 'a.cdibak'); await C.cifrarArchivo(plano, enc, llave, sal);
  ok(fs.statSync(enc).size === fs.statSync(plano).size + C.CAB + 16, 'el archivo cifrado tiene el tamaño esperado (cabecera + datos + etiqueta)');
  ok(!fs.readFileSync(enc).includes(fs.readFileSync(plano).subarray(1000, 1064)), 'el contenido original no aparece en el archivo cifrado');
  ok(C.esRespaldoCifrado(enc) && !C.esRespaldoCifrado(plano), 'se distingue un respaldo cifrado de uno en claro');
  ok(C.leerCabecera(enc).sal.equals(sal), 'la sal viaja en la cabecera (permite restaurar en otra PC con la clave maestra)');
  const dec = path.join(dir, 'a.out'); await C.descifrarArchivo(enc, dec, C.derivarLlave('Clave de prueba 1', C.leerCabecera(enc).sal));
  ok(fs.readFileSync(dec).equals(fs.readFileSync(plano)), 'descifrado con la clave correcta = archivo idéntico');
  let e1 = ''; try { await C.descifrarArchivo(enc, path.join(dir, 'x.out'), otra); } catch (e) { e1 = e.message; }
  ok(/incorrecta/.test(e1) && !fs.existsSync(path.join(dir, 'x.out')), 'con una clave incorrecta se rechaza y no deja archivo');
  const alt = path.join(dir, 'alt.cdibak'); const b = Buffer.from(fs.readFileSync(enc)); b[C.CAB + 5000] ^= 1; fs.writeFileSync(alt, b);
  let e2 = ''; try { await C.descifrarArchivo(alt, path.join(dir, 'y.out'), llave); } catch (e) { e2 = e.message; }
  ok(/dañado|alterado/.test(e2) && !fs.existsSync(path.join(dir, 'y.out')), 'un byte alterado en el respaldo se detecta y se descarta');
  const trunc = path.join(dir, 't.cdibak'); fs.writeFileSync(trunc, fs.readFileSync(enc).subarray(0, 100000));
  let e3 = ''; try { await C.descifrarArchivo(trunc, path.join(dir, 'z.out'), llave); } catch (e) { e3 = e.message; }
  ok(!!e3, 'un respaldo truncado se rechaza');
  const vacio = path.join(dir, 'v.dump'); fs.writeFileSync(vacio, ''); const venc = path.join(dir, 'v.cdibak'); await C.cifrarArchivo(vacio, venc, llave, sal);
  await C.descifrarArchivo(venc, path.join(dir, 'v.out'), llave); ok(fs.statSync(path.join(dir, 'v.out')).size === 0, 'un archivo vacío también hace el viaje de ida y vuelta');
  // sobre de claves
  const sobre = path.join(dir, 'config.mk'), cfg = { pgPass: 'p', appPass: 'a', jwt: 'j' };
  C.sobreEscribir(sobre, cfg, llave, sal);
  ok(JSON.stringify(C.sobreLeer(sobre, llave)) === JSON.stringify(cfg) && C.sobreSal(sobre).equals(sal), 'el sobre de claves se abre con la clave maestra correcta');
  let e4 = false; try { C.sobreLeer(sobre, otra); } catch { e4 = true; } ok(e4, 'el sobre no se abre con otra clave');
  ok(!fs.readFileSync(sobre).includes(Buffer.from('pgPass')), 'el sobre no contiene texto legible');
  // huella
  const h1 = C.huellaEquipo('AAA', 'U1'), h2 = C.huellaEquipo('AAA', 'U2'); ok(h1 !== h2 && h1 === C.huellaEquipo('aaa', 'u1') && /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(C.codigoEquipo(h1)), 'la huella cambia con el hardware y el código del equipo tiene formato legible');
  // borrado
  const d2 = path.join(dir, 'datos'); fs.mkdirSync(path.join(d2, 'sub'), { recursive: true }); fs.writeFileSync(path.join(d2, 'sub', 'f'), 'secreto'); fs.writeFileSync(path.join(d2, 'g'), 'x'.repeat(5000));
  C.borrarCarpetaSegura(d2); ok(!fs.existsSync(d2), 'el borrado seguro elimina la carpeta completa');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(fallos ? `\n${fallos} PRUEBA(S) FALLARON` : '\nTodas las pruebas de cifrado pasaron'); process.exit(fallos ? 1 : 0);
})();
