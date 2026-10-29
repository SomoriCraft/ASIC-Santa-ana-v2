// Copia la API, la interfaz web y los SQL del proyecto dentro de escritorio/app-src
const fs = require('fs'), path = require('path');
const raiz = path.join(__dirname, '..', '..'), dest = path.join(__dirname, '..', 'app-src');
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(path.join(dest, 'api'), { recursive: true });
for (const f of fs.readdirSync(path.join(raiz, 'api')).filter(f => f.endsWith('.js'))) fs.copyFileSync(path.join(raiz, 'api', f), path.join(dest, 'api', f));   // server.js, correo.js…
fs.writeFileSync(path.join(dest, 'api', 'package.json'), '{"type":"module"}');   // server.js usa módulos ES
fs.cpSync(path.join(raiz, 'web'), path.join(dest, 'web'), { recursive: true });
fs.cpSync(path.join(raiz, 'db'), path.join(dest, 'db'), { recursive: true, filter: s => !s.includes(path.sep + 'tests') });
fs.mkdirSync(path.join(__dirname, '..', 'build'), { recursive: true });
fs.copyFileSync(path.join(raiz, 'web', 'icon-512.png'), path.join(__dirname, '..', 'build', 'icon.png'));
console.log('app-src preparado');
