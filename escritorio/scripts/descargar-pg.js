// Descarga PostgreSQL portátil para Windows (binarios oficiales de EDB) y lo deja en recursos/pgsql
const https = require('https'), fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const VERSION = '16.15-3';   // Si la descarga da error 404, busque la versión vigente en enterprisedb.com/download-postgresql-binaries
const URL = `https://get.enterprisedb.com/postgresql/postgresql-${VERSION}-windows-x64-binaries.zip`;
const rec = path.join(__dirname, '..', 'recursos'), zip = path.join(rec, 'pg.zip');

function bajar(url, destino, saltos = 5) {
  return new Promise((ok, mal) => https.get(url, r => {
    if ([301, 302, 303, 307, 308].includes(r.statusCode) && saltos > 0) { r.resume(); return bajar(new globalThis.URL(r.headers.location, url).href, destino, saltos - 1).then(ok, mal); }
    if (r.statusCode !== 200) return mal(new Error('Descarga falló: HTTP ' + r.statusCode + ' ' + url));
    r.pipe(fs.createWriteStream(destino)).on('finish', ok).on('error', mal);
  }).on('error', mal));
}

(async () => {
  if (fs.existsSync(path.join(rec, 'pgsql', 'bin', 'postgres.exe'))) return console.log('PostgreSQL ya descargado');
  fs.mkdirSync(rec, { recursive: true });
  console.log('Descargando', URL);
  await bajar(URL, zip);
  console.log('Descomprimiendo...');
  execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Path '${zip}' -DestinationPath '${rec}' -Force`], { stdio: 'inherit' });
  fs.rmSync(zip, { force: true });
  for (const x of ['pgAdmin 4', 'doc', 'symbols', 'StackBuilder']) fs.rmSync(path.join(rec, 'pgsql', x), { recursive: true, force: true });  // reduce el tamaño
  if (!fs.existsSync(path.join(rec, 'pgsql', 'bin', 'postgres.exe'))) throw new Error('No se encontró pgsql/bin/postgres.exe tras descomprimir');
  console.log('Listo: recursos/pgsql');
})().catch(e => { console.error(e.message); process.exit(1); });
