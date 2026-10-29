import express from 'express';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { verMaestra } from './maestra.js';
import { fileURLToPath } from 'url';
pg.types.setTypeParser(1082, v => v);   // las fechas (DATE) viajan como texto AAAA-MM-DD: sin corrimientos por zona horaria

pg.types.setTypeParser(1082, v => v);           // DATE como 'YYYY-MM-DD' (sin desfase de zona horaria)
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
pool.on('error', e => console.error('pg pool:', e.message));   // si PostgreSQL se cierra, que no tumbe el programa
const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 32) throw new Error('JWT_SECRET requerido (mínimo 32 caracteres)');

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  // Solo se atiende a la propia PC: evita ataques de "DNS rebinding" y peticiones desde páginas web de otros sitios
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(String(req.headers.host || ''))) return res.status(421).json({ error: 'Host no permitido' });
  const o = req.headers.origin; if (o && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(o)) return res.status(403).json({ error: 'Origen no permitido' });
  res.set({ 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' });
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
  next();
});
// Freno por ruta (en esta PC todos los pedidos llegan desde 127.0.0.1, así que es un tope global por minuto)
const topes = new Map();
const limite = (max, ventanaMs = 60e3) => (req, res, next) => {
  const k = req.method + req.baseUrl + req.path, t = Date.now(), v = (topes.get(k) || []).filter(x => t - x < ventanaMs);
  if (v.length >= max) return res.status(429).json({ error: 'Demasiados intentos seguidos. Espere un minuto.' });
  v.push(t); topes.set(k, v); next();
};
app.use(express.json({ limit: '1mb' }));
app.use('/api/login', limite(40));
app.use('/api/recuperar', limite(40));

class H extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const wrap = fn => (req, res) => fn(req, res).catch(e => {
  const negocio = ['P0001', '23514', '23505', '23503', '22P02'].includes(e.code);   // reglas de negocio / validación
  const status = e.status || (negocio ? 400 : 500);
  if (status === 500) console.error(e);
  res.status(status).json({ error: status === 500 ? 'Error interno' : e.message });
});
const tx = async fn => {
  const c = await pool.connect();
  try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
  catch (e) { await c.query('ROLLBACK'); throw e; }
  finally { c.release(); }
};

const ESCRIBE = ['FARMACEUTICO_REGENTE', 'ALMACENISTA'];
const REGENTE = ['FARMACEUTICO_REGENTE'];
const LEE = [...ESCRIBE, 'INSPECTOR_ASIC'];
const auth = (...roles) => async (req, res, next) => {
  try {
    const p = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), SECRET);
    const { rows: [u] } = await pool.query('SELECT rol, activo, bloqueado, clave_cambiada_en FROM usuarios WHERE id=$1', [p.id]);
    if (!u || !u.activo || u.bloqueado) return res.status(401).json({ error: 'Sesión no válida' });
    if (u.clave_cambiada_en && p.iat * 1000 < new Date(u.clave_cambiada_en).getTime() - 1500) return res.status(401).json({ error: 'Su clave cambió: inicie sesión de nuevo' });
    req.user = { ...p, rol: u.rol };                       // el rol vigente es el de la base de datos, no el del token
    if (roles.length && !roles.includes(req.user.rol)) return res.status(403).json({ error: 'Sin permiso' });
    next();
  } catch { res.status(401).json({ error: 'No autenticado' }); }
};
const fecha = v => { if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '')) throw new H(400, 'Fechas con formato AAAA-MM-DD'); return v; };
const csv = (cols, rows, cabecera = []) => '\ufeff' + [...cabecera, cols.join(';'),
  ...rows.map(r => cols.map(c => { const v = r[c] instanceof Date ? r[c].toISOString() : String(r[c] ?? '');
    return /^[=+\-@]/.test(v) ? `"'${v}"` : /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }).join(';'))].join('\r\n');
const enviar = (req, res, cols, rows, nombre, cab) => req.query.formato === 'csv'
  ? res.type('text/csv; charset=utf-8').attachment(nombre + '.csv').send(csv(cols, rows, cab))
  : res.json(rows);



// ---------------- Cierre mensual obligatorio ----------------
const DIAS_GRACIA = 3;   // días del mes siguiente para hacer el conteo antes de bloquear la operación
async function estadoCierre() {
  const { rows: [r] } = await pool.query(`SELECT (SELECT periodo FROM conteos WHERE estado='ABIERTO' LIMIT 1) AS abierto,
    to_char(date_trunc('month',CURRENT_DATE) - interval '1 month','YYYY-MM') AS previo, to_char(CURRENT_DATE,'YYYY-MM') AS actual,
    EXISTS (SELECT 1 FROM conteos WHERE estado='CERRADO' AND periodo = to_char(date_trunc('month',CURRENT_DATE) - interval '1 month','YYYY-MM')) AS previo_cerrado,
    EXISTS (SELECT 1 FROM conteos WHERE estado='CERRADO' AND periodo = to_char(CURRENT_DATE,'YYYY-MM')) AS actual_cerrado,
    COALESCE((SELECT min(creado_en) FROM usuarios) < date_trunc('month',CURRENT_DATE), false) AS existia,
    EXTRACT(day FROM CURRENT_DATE)::int AS dia,
    ((date_trunc('month',CURRENT_DATE) + interval '1 month' - interval '1 day')::date - CURRENT_DATE)::int AS faltan`);
  const pendiente = r.existia && !r.previo_cerrado;
  return { abierto: r.abierto, previo: r.previo, actual: r.actual, pendiente: pendiente ? r.previo : null, enGracia: pendiente && r.dia <= DIAS_GRACIA,
    bloqueado: pendiente && r.dia > DIAS_GRACIA, diasGracia: DIAS_GRACIA, recordar: !r.actual_cerrado && r.faltan <= 3, faltan: r.faltan, actualCerrado: r.actual_cerrado };
}
const operativo = async (_req, res, next) => {
  try {
    const e = await estadoCierre();
    if (e.abierto) return res.status(423).json({ error: `Hay un conteo físico abierto (${e.abierto}). Termínelo o cancélelo para seguir operando.` });
    if (e.bloqueado) return res.status(423).json({ error: `Debe realizar el conteo físico y el cierre de ${e.pendiente} antes de seguir operando (menú «Cierre mensual»).` });
    next();
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error interno' }); }
};
// ---------------- Validaciones (las mismas reglas que la interfaz) ----------------
const RX = { user: /^[A-Za-z0-9_.-]{3,30}$/, ced: /^[VE]\d{6,9}$/, nom: /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ .'\-]+$/,
  lote: /^[A-Za-z0-9._\/-]{1,60}$/, uuid: /^[0-9a-f-]{36}$/i, cod: /^[A-Za-z0-9-]{4,50}$/ };
const ROLES = ['FARMACEUTICO_REGENTE', 'ALMACENISTA', 'INSPECTOR_ASIC'];
const CATS = ['MEDICAMENTO', 'MATERIAL_MEDICO_QUIRURGICO', 'SOLUCION', 'REACTIVO'];
const CTRL = ['LIBRE', 'RECETA', 'CONTROLADO_PSICOTROPICO', 'ESTUPEFACIENTE'], TEMP = ['AMBIENTE', 'CADENA_FRIO_2_8C'];
const tx_ = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const cedula = v => String(v ?? '').toUpperCase().replace(/[\s.\-]/g, '');
const clavOk = c => typeof c === 'string' && c.length >= 10 && c.length <= 128 && /[a-z]/.test(c) && /[A-Z]/.test(c) && /\d/.test(c);
const entero = (v, min, max) => Number.isInteger(+v) && +v >= min && +v <= max && String(v).trim() !== '';
const val = fn => (req, res, next) => { try { fn(req.body || {}, req); next(); } catch (e) { res.status(e.status || 400).json({ error: e.message }); } };
const bad = m => { throw new H(400, m); };

function normProducto(b, fila) {
  const e = [], n = {
    codigo_barras: tx_(b.codigo_barras, 50) || null, dci_principio_activo: tx_(b.dci_principio_activo, 200), nombre_comercial: tx_(b.nombre_comercial, 200) || null,
    presentacion: tx_(b.presentacion, 100), concentracion: tx_(b.concentracion, 60) || null, categoria: String(b.categoria || '').toUpperCase().trim(),
    registro_sanitario_inhrr: tx_(b.registro_sanitario_inhrr, 40) || null, tipo_control: String(b.tipo_control || 'LIBRE').toUpperCase().trim(),
    temperatura: String(b.temperatura || 'AMBIENTE').toUpperCase().trim(), stock_minimo: b.stock_minimo === '' || b.stock_minimo == null ? 0 : +b.stock_minimo,
    stock_maximo: b.stock_maximo === '' || b.stock_maximo == null ? 0 : +b.stock_maximo };
  const m = t => e.push((fila ? `Fila ${fila}: ` : '') + t);
  if (n.dci_principio_activo.length < 3) m('DCI / nombre genérico obligatorio (mínimo 3 letras)');
  if (!n.presentacion) m('Presentación obligatoria (tableta, ampolla, frasco…)');
  if (!CATS.includes(n.categoria)) m('Categoría inválida (' + CATS.join(', ') + ')');
  if (n.categoria === 'MEDICAMENTO' && !n.registro_sanitario_inhrr) m('Los medicamentos requieren Registro Sanitario INHRR');
  if (!CTRL.includes(n.tipo_control)) m('Control inválido (' + CTRL.join(', ') + ')');
  if (!TEMP.includes(n.temperatura)) m('Temperatura inválida (' + TEMP.join(', ') + ')');
  if (n.codigo_barras && !RX.cod.test(n.codigo_barras)) m('Código de barras: 4 a 50 letras, números o guion');
  if (!entero(n.stock_minimo, 0, 1e7) || !entero(n.stock_maximo, 0, 1e7)) m('Stock mínimo y máximo deben ser números enteros ≥ 0');
  else if (n.stock_maximo < n.stock_minimo) m('El stock máximo no puede ser menor que el mínimo');
  return { e, n };
}
const colsP = ['codigo_barras', 'dci_principio_activo', 'nombre_comercial', 'presentacion', 'concentracion', 'categoria', 'registro_sanitario_inhrr', 'tipo_control', 'temperatura', 'stock_minimo', 'stock_maximo'];
const aud = (c, uid, accion, tabla, rid, det) => c.query('INSERT INTO auditoria (usuario_id, accion, tabla, registro_id, detalle) VALUES ($1,$2,$3,$4,$5)', [uid, accion, tabla, rid || null, det ? JSON.stringify(det) : null]);

// Validación de formularios existentes (antes de llegar a la base de datos)
app.post('/api/entradas', auth(...ESCRIBE), operativo, val(b => {
  if (!RX.uuid.test(String(b.producto_id))) bad('Seleccione un producto');
  if (!RX.lote.test(String(b.numero_lote || '').trim())) bad('Lote: 1 a 60 caracteres (letras, números, punto, guion o barra)');
  if (!entero(b.cantidad, 1, 1e6)) bad('La cantidad debe ser un entero entre 1 y 1.000.000');
  if (fecha(b.fecha_vencimiento) < new Date().toISOString().slice(0, 10)) bad('No se puede recibir un lote vencido');
  if (String(b.documento || '').length > 60) bad('Documento: máximo 60 caracteres');
  b.numero_lote = String(b.numero_lote).trim();
}), (_q, _s, next) => next());
app.post('/api/despachos', auth(...ESCRIBE), operativo, val(b => {
  b.recibe_cedula = cedula(b.recibe_cedula); b.recibe_nombre = tx_(b.recibe_nombre, 150); b.recibe_cargo = tx_(b.recibe_cargo, 80);
  if (!RX.ced.test(b.recibe_cedula)) bad('Cédula de quien recibe: V o E y de 6 a 9 números');
  if (!RX.nom.test(b.recibe_nombre)) bad('Nombre de quien recibe: solo letras y espacios');
  if (b.recibe_cargo.length < 3) bad('Cargo de quien recibe: mínimo 3 caracteres');
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > 60) bad('Agregue al menos un producto al despacho');
  for (const i of b.items) {
    if (!RX.uuid.test(String(i.producto_id)) || !entero(i.cantidad, 1, 1e6)) bad('Hay un producto con cantidad inválida');
    if (i.paciente_cedula !== undefined) {
      i.paciente_cedula = cedula(i.paciente_cedula);
      if (!RX.ced.test(i.paciente_cedula)) bad('Cédula del paciente inválida (V o E y 6 a 9 números)');
      if (!RX.nom.test(tx_(i.paciente_nombre, 150))) bad('Nombre del paciente inválido');
      if (!RX.nom.test(tx_(i.medico_nombre, 150))) bad('Nombre del médico inválido');
      if (!/^[A-Za-z0-9.\-\/ ]{3,30}$/.test(tx_(i.medico_matricula_mpps, 30))) bad('Matrícula MPPS del médico inválida');
      if (tx_(i.nro_recipe, 30).length < 3) bad('Número de récipe obligatorio');
    }
  }
}), (_q, _s, next) => next());
app.post('/api/mermas', auth(...ESCRIBE), operativo, val(b => {
  if (!RX.uuid.test(String(b.lote_id))) bad('Seleccione el lote afectado');
  if (!entero(b.cantidad, 1, 1e6)) bad('La cantidad debe ser un entero mayor a cero');
  if (tx_(b.descripcion, 500).length < 10) bad('Describa lo ocurrido (mínimo 10 caracteres)');
  if (!RX.user.test(String(b.autoriza_username || '').trim())) bad('Usuario del Regente inválido');
  if (!b.autoriza_password) bad('Falta la clave del Regente');
  b.autoriza_username = String(b.autoriza_username).trim(); b.descripcion = tx_(b.descripcion, 500);
}), (_q, _s, next) => next());

// ---------------- Usuarios ----------------
app.get('/api/usuarios', auth(...REGENTE), wrap(async (_q, res) => res.json((await pool.query(
  `SELECT id, cedula, nombre_completo, cargo, matricula_mpps, rol, username, activo, creado_en, bloqueado, es_principal,
          (bloqueado_hasta IS NOT NULL AND bloqueado_hasta > now()) AS bloqueo_temporal, recuperacion_configurada, debe_cambiar_clave
   FROM usuarios ORDER BY activo DESC, nombre_completo`)).rows)));
app.post('/api/usuarios', auth(...REGENTE), wrap(async (req, res) => {
  const b = req.body || {}, u = { nombre: tx_(b.nombre_completo, 150), ced: cedula(b.cedula), user: String(b.username || '').trim(), cargo: tx_(b.cargo, 80) || null, mat: tx_(b.matricula_mpps, 30) || null };
  if (!RX.nom.test(u.nombre)) bad('Nombre completo: solo letras y espacios');
  if (!RX.ced.test(u.ced)) bad('Cédula: V o E y de 6 a 9 números');
  if (!RX.user.test(u.user)) bad('Usuario: 3 a 30 caracteres (letras, números, punto, guion, guion bajo)');
  if (!ROLES.includes(b.rol)) bad('Rol inválido');
  if (u.mat && !/^[A-Za-z0-9.\-\/ ]{3,30}$/.test(u.mat)) bad('Matrícula inválida');
  // La clave inicial es la temporal del sistema: el usuario DEBE cambiarla en su primer inicio de sesión
  const hash = await bcrypt.hash(CLAVE_TEMPORAL, 12);
  const r = await tx(async c => {
    const { rows: [r] } = await c.query(`INSERT INTO usuarios (cedula,nombre_completo,cargo,matricula_mpps,rol,username,password_hash,debe_cambiar_clave)
      VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE) RETURNING id`, [u.ced, u.nombre, u.cargo, u.mat, b.rol, u.user, hash]);
    await aud(c, req.user.id, 'ALTA_USUARIO', 'usuarios', r.id, { username: u.user, rol: b.rol }); return r;
  }).catch(e => { throw e.code === '23505' ? new H(400, 'Ya existe un usuario con ese nombre de usuario o cédula') : e; });
  res.status(201).json(r);
}));
const datosUsuario = async id => (await pool.query('SELECT id, rol, es_principal FROM usuarios WHERE id=$1', [id])).rows[0];
app.patch('/api/usuarios/:id', auth(...REGENTE), wrap(async (req, res) => {
  const { id } = req.params; if (!RX.uuid.test(id)) bad('Usuario inválido');
  if (typeof req.body.activo !== 'boolean') bad('Indique activo true/false');
  const t = await datosUsuario(id); if (!t) throw new H(404, 'Usuario no encontrado');
  if (!req.body.activo && (id === req.user.id || t.es_principal)) bad('No se puede desactivar al usuario principal ni a uno mismo');
  await tx(async c => { await c.query('UPDATE usuarios SET activo=$2, actualizado_en=now() WHERE id=$1', [id, req.body.activo]);
    await aud(c, req.user.id, req.body.activo ? 'ACTIVAR_USUARIO' : 'DESACTIVAR_USUARIO', 'usuarios', id); });
  res.json({ ok: true });
}));
// Restablecer = clave temporal + desbloqueo total; el usuario debe cambiarla al entrar. Solo el principal puede tocar a otro Regente.
app.post('/api/usuarios/:id/clave', auth(...REGENTE), wrap(async (req, res) => {
  if (!RX.uuid.test(req.params.id)) bad('Usuario inválido');
  const t = await datosUsuario(req.params.id); if (!t) throw new H(404, 'Usuario no encontrado');
  const yo = await datosUsuario(req.user.id);
  if (t.id !== yo.id && (t.es_principal || t.rol === 'FARMACEUTICO_REGENTE') && !yo.es_principal) throw new H(403, 'Solo el usuario principal puede restablecer a otro Regente');
  if (t.id === yo.id) bad('Para cambiar su propia clave use «Mi clave»');
  const hash = await bcrypt.hash(CLAVE_TEMPORAL, 12);
  await tx(async c => { await c.query(`UPDATE usuarios SET password_hash=$2, clave_cambiada_en=now(), debe_cambiar_clave=TRUE, intentos_fallidos=0, intentos_preguntas=0, bloqueado=FALSE, bloqueado_hasta=NULL, actualizado_en=now() WHERE id=$1`, [t.id, hash]);
    await aud(c, req.user.id, 'RESET_CLAVE', 'usuarios', t.id); });
  res.json({ ok: true });
}));
app.post('/api/mi-clave', auth(), wrap(async (req, res) => {
  const { actual, nueva } = req.body || {};
  const { rows: [u] } = await pool.query('SELECT password_hash FROM usuarios WHERE id=$1 AND activo', [req.user.id]);
  if (!u || !(await bcrypt.compare(String(actual || ''), u.password_hash))) throw new H(401, 'La clave actual no es correcta');
  if (!clavOk(nueva)) bad('La nueva clave debe tener mínimo 10 caracteres con mayúscula, minúscula y número');
  if (nueva === actual) bad('La nueva clave debe ser distinta a la actual');
  if (nueva === CLAVE_TEMPORAL) bad('Elija una clave distinta a la temporal del sistema');
  const hash = await bcrypt.hash(nueva, 12);
  await tx(async c => { await c.query('UPDATE usuarios SET password_hash=$2, clave_cambiada_en=now(), debe_cambiar_clave=FALSE, actualizado_en=now() WHERE id=$1', [req.user.id, hash]);
    await aud(c, req.user.id, 'CAMBIO_CLAVE', 'usuarios', req.user.id); });
  res.json({ ok: true, token: jwt.sign({ id: req.user.id, rol: req.user.rol, nombre: req.user.nombre }, SECRET, { expiresIn: '10h' }) });
}));

// ---------------- Catálogo (alta, edición, importación CSV) ----------------
app.get('/api/catalogo', auth(...REGENTE), wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  res.json((await pool.query(`SELECT * FROM productos WHERE ($1='' OR codigo_barras=$1 OR codigo_interno=$1 OR dci_principio_activo ILIKE '%'||$1||'%'
    OR nombre_comercial ILIKE '%'||$1||'%') ORDER BY activo DESC, dci_principio_activo LIMIT 200`, [q])).rows);
}));
app.put('/api/productos/:id', auth(...REGENTE), wrap(async (req, res) => {
  if (!RX.uuid.test(req.params.id)) bad('Producto inválido');
  const { e, n } = normProducto(req.body); if (e.length) bad(e[0]);
  const activo = req.body.activo !== false;
  const p = await tx(async c => {
    const { rows: [ant] } = await c.query('SELECT * FROM productos WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!ant) throw new H(404, 'Producto no encontrado');
    const { rows: [p] } = await c.query(`UPDATE productos SET ${colsP.map((c, i) => `${c}=$${i + 2}`).join(',')}, activo=$${colsP.length + 2}, actualizado_en=now()
      WHERE id=$1 RETURNING *`, [req.params.id, ...colsP.map(k => n[k]), activo]);
    const cambios = {}; for (const k of [...colsP, 'activo']) if (String(ant[k] ?? '') !== String(p[k] ?? '')) cambios[k] = { antes: ant[k], despues: p[k] };
    await aud(c, req.user.id, 'EDITAR_PRODUCTO', 'productos', p.id, { cambios }); return p;
  });
  res.json(p);
}));
app.post('/api/productos/importar', auth(...REGENTE), wrap(async (req, res) => {
  const filas = req.body.filas; if (!Array.isArray(filas) || !filas.length || filas.length > 3000) bad('El archivo debe traer entre 1 y 3000 filas');
  const errores = [], ok = filas.map((f, i) => { const r = normProducto(f, i + 2); errores.push(...r.e); return r.n; });
  if (errores.length) return res.status(400).json({ error: `Nada se importó. ${errores.length} error(es):\n` + errores.slice(0, 25).join('\n') + (errores.length > 25 ? '\n…' : '') });
  await tx(async c => { for (const n of ok) await c.query(`INSERT INTO productos (${colsP.join(',')}) VALUES (${colsP.map((_, i) => '$' + (i + 1)).join(',')})`, colsP.map(k => n[k])); await aud(c, req.user.id, 'IMPORTAR_CATALOGO', 'productos', null, { filas: ok.length }); })
    .catch(e => { throw e.code === '23505' ? new H(400, 'Nada se importó: hay un código de barras repetido (en el archivo o ya registrado)') : e; });
  res.status(201).json({ importados: ok.length });
}));
app.post('/api/entradas/importar', auth(...ESCRIBE), operativo, wrap(async (req, res) => {
  const filas = req.body.filas; if (!Array.isArray(filas) || !filas.length || filas.length > 5000) bad('El archivo debe traer entre 1 y 5000 filas');
  const hoy = new Date().toISOString().slice(0, 10), errores = [], cache = new Map();
  const { rows: [prov] } = await pool.query('SELECT id FROM proveedores_origen ORDER BY nombre LIMIT 1');
  const items = [];
  for (const [i, f] of filas.entries()) {
    const m = t => errores.push(`Fila ${i + 2}: ${t}`), cod = tx_(f.codigo, 50), lote = tx_(f.lote, 60), ven = tx_(f.vencimiento, 10);
    if (!cache.has(cod)) cache.set(cod, (await pool.query('SELECT id FROM productos WHERE activo AND (codigo_barras=$1 OR codigo_interno=$1)', [cod])).rows[0]?.id);
    if (!cod || !cache.get(cod)) m(`producto «${cod}» no existe en el catálogo (use código de barras o INT-000000)`);
    if (!RX.lote.test(lote)) m('lote inválido');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ven) || ven < hoy) m('vencimiento inválido o vencido (formato AAAA-MM-DD)');
    if (!entero(f.cantidad, 1, 1e6)) m('cantidad debe ser un entero ≥ 1');
    items.push([cache.get(cod), lote, ven, +f.cantidad, tx_(f.documento, 60) || 'CARGA INICIAL']);
  }
  if (errores.length) return res.status(400).json({ error: `Nada se importó. ${errores.length} error(es):\n` + errores.slice(0, 25).join('\n') + (errores.length > 25 ? '\n…' : '') });
  await tx(async c => { for (const it of items) await c.query('SELECT fn_registrar_entrada($1,$2,$3,$4,$5,$6,$7)', [it[0], it[1], it[2], it[3], prov?.id || null, it[4], req.user.id]); });
  res.status(201).json({ importados: items.length });
}));

// ---------------- Auditoría y estado de respaldos ----------------
app.get('/api/auditoria', auth(...REGENTE, 'INSPECTOR_ASIC'), wrap(async (req, res) => {
  const { desde, hasta, accion, usuario } = req.query, p = [];
  const w = [desde && (p.push(fecha(desde)), `a.fecha_hora >= $${p.length}`), hasta && (p.push(fecha(hasta)), `a.fecha_hora < ($${p.length}::date + 1)`),
    accion && (p.push(String(accion).slice(0, 60)), `a.accion = $${p.length}`), usuario && (p.push('%' + String(usuario).slice(0, 50) + '%'), `u.username ILIKE $${p.length}`)].filter(Boolean);
  const { rows } = await pool.query(`SELECT a.fecha_hora, COALESCE(u.username,'(sistema)') AS usuario, a.accion, a.tabla, a.detalle, host(a.ip) AS ip
    FROM auditoria a LEFT JOIN usuarios u ON u.id=a.usuario_id ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY a.id DESC LIMIT 500`, p);
  enviar(req, res, ['fecha_hora', 'usuario', 'accion', 'tabla', 'detalle', 'ip'], rows.map(r => ({ ...r, detalle: r.detalle ? JSON.stringify(r.detalle) : '' })), 'auditoria');
}));
app.get('/api/respaldos/estado', auth(...LEE), wrap(async (_q, res) => {
  const dir = process.env.RESPALDOS; let ult = null, n = 0;
  try { for (const f of fs.readdirSync(dir).filter(f => /\.(dump|cdibak)$/.test(f))) { n++; const t = fs.statSync(path.join(dir, f)).mtime; if (!ult || t > ult) ult = t; } } catch {}
  res.json({ ultimo: ult, dias: ult ? Math.floor((Date.now() - ult) / 864e5) : null, total: n });
}));


// ---------------- Seguridad local: clave temporal, preguntas de seguridad y clave maestra (sin correo ni internet) ----------------
const CLAVE_TEMPORAL = 'Farmacia1234.';          // clave inicial de usuarios nuevos o restablecidos; obliga a cambiarla
const MAX_LOGIN = 5, MIN_BLOQUEO = 15, MAX_PREGUNTAS = 4;
const fallosMaestra = [];   // freno global: 5 fallos en 15 minutos
const maestraFrenada = () => { const t = Date.now(); while (fallosMaestra.length && t - fallosMaestra[0] > 15 * 60e3) fallosMaestra.shift(); return fallosMaestra.length >= 5; };
const MSG_DURO = 'Su usuario quedó bloqueado por demasiados intentos. Pida al Farmacéutico Regente que lo restablezca (si usted es el usuario principal, use «Soy el usuario principal»).';
const PREGUNTAS = ['¿Cómo se llamaba su primera mascota?', '¿En qué ciudad nació su madre?', '¿Cómo se llamaba su escuela primaria?',
  '¿Cuál es el segundo nombre de su padre o de su madre?', '¿Cómo se llamaba su mejor amigo de la infancia?'];
const normResp = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const claveNuevaOk = c => { if (!clavOk(c)) bad('La clave debe tener mínimo 10 caracteres con mayúscula, minúscula y número'); if (c === CLAVE_TEMPORAL) bad('Elija una clave distinta a la temporal del sistema'); };
app.get('/api/mi-seguridad', auth(), wrap(async (req, res) => {
  const { rows: [u] } = await pool.query('SELECT recuperacion_configurada FROM usuarios WHERE id=$1', [req.user.id]);
  res.json({ configurada: u.recuperacion_configurada, preguntas: PREGUNTAS });
}));
app.put('/api/mi-seguridad', auth(), wrap(async (req, res) => {
  const { respuestas, actual } = req.body || {};
  if (!Array.isArray(respuestas) || respuestas.length !== 5) bad('Responda las 5 preguntas de seguridad');
  const rs = respuestas.map(normResp);
  if (rs.some(r => r.length < 3 || r.length > 60)) bad('Cada respuesta debe tener entre 3 y 60 caracteres');
  if (new Set(rs).size !== 5) bad('Las 5 respuestas deben ser distintas entre sí');
  const { rows: [u] } = await pool.query('SELECT password_hash FROM usuarios WHERE id=$1', [req.user.id]);
  if (!(await bcrypt.compare(String(actual || ''), u.password_hash))) throw new H(401, 'Su clave actual no es correcta');
  const hs = await Promise.all(rs.map(r => bcrypt.hash(r, 10)));
  await tx(async c => {
    await c.query('DELETE FROM seguridad_respuestas WHERE usuario_id=$1', [req.user.id]);
    for (const [i, h] of hs.entries()) await c.query('INSERT INTO seguridad_respuestas (usuario_id, pregunta_id, respuesta_hash) VALUES ($1,$2,$3)', [req.user.id, i + 1, h]);
    await c.query('UPDATE usuarios SET recuperacion_configurada=TRUE, actualizado_en=now() WHERE id=$1', [req.user.id]);
    await aud(c, req.user.id, 'CONFIG_RECUPERACION', 'usuarios', req.user.id);
  });
  res.json({ ok: true });
}));
const retoPreguntas = uid => {      // 3 preguntas al azar de las 5
  const ids = [1, 2, 3, 4, 5]; for (let i = 4; i > 0; i--) { const j = crypto.randomInt(0, i + 1); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  const tres = ids.slice(0, 3);
  return { reto: jwt.sign({ p: 'rec', uid, ids: tres }, SECRET, { expiresIn: '10m' }), preguntas: tres.map(i => ({ id: i, texto: PREGUNTAS[i - 1] })) };
};
app.post('/api/recuperar/iniciar', wrap(async (req, res) => {
  const username = String(req.body?.username || '').trim();
  if (!RX.user.test(username)) bad('Escriba su usuario');
  const { rows: [u] } = await pool.query('SELECT id, bloqueado, recuperacion_configurada FROM usuarios WHERE username=$1 AND activo', [username]);
  if (!u) bad('No fue posible iniciar la recuperación para ese usuario');
  if (u.bloqueado) return res.status(423).json({ error: MSG_DURO, bloqueado: true });
  if (!u.recuperacion_configurada) bad('Este usuario no configuró sus preguntas de seguridad. Pida al Farmacéutico Regente que restablezca su clave.');
  res.json(retoPreguntas(u.id));
}));
app.post('/api/recuperar/responder', wrap(async (req, res) => {
  let r; try { r = jwt.verify(String(req.body?.reto || ''), SECRET); } catch { bad('La verificación venció. Vuelva a empezar.'); }
  if (r.p !== 'rec') bad('Solicitud inválida');
  const resp = req.body.respuestas; if (!Array.isArray(resp) || resp.length !== 3) bad('Responda las 3 preguntas');
  const { rows: [u] } = await pool.query('SELECT bloqueado FROM usuarios WHERE id=$1 AND activo', [r.uid]);
  if (!u) bad('Usuario no disponible'); if (u.bloqueado) return res.status(423).json({ error: MSG_DURO, bloqueado: true });
  const { rows: hs } = await pool.query('SELECT pregunta_id, respuesta_hash FROM seguridad_respuestas WHERE usuario_id=$1 AND pregunta_id = ANY($2)', [r.uid, r.ids]);
  let ok = hs.length === 3;
  for (let i = 0; i < 3; i++) { const h = hs.find(x => x.pregunta_id === r.ids[i]); if (!h || !(await bcrypt.compare(normResp(resp[i]), h.respuesta_hash))) ok = false; }
  if (ok) { await pool.query('UPDATE usuarios SET intentos_preguntas=0 WHERE id=$1', [r.uid]); await aud(pool, r.uid, 'RECUPERACION_PREGUNTAS_OK', 'usuarios', r.uid);
    return res.json({ resetToken: jwt.sign({ p: 'reset', uid: r.uid }, SECRET, { expiresIn: '10m' }) }); }
  const { rows: [x] } = await pool.query('UPDATE usuarios SET intentos_preguntas = intentos_preguntas + 1 WHERE id=$1 RETURNING intentos_preguntas', [r.uid]);
  await aud(pool, r.uid, 'RECUPERACION_RESPUESTA_FALLIDA', 'usuarios', r.uid, { intento: x.intentos_preguntas });
  if (x.intentos_preguntas >= MAX_PREGUNTAS) {
    await pool.query('UPDATE usuarios SET bloqueado=TRUE WHERE id=$1', [r.uid]); await aud(pool, r.uid, 'BLOQUEO_PREGUNTAS_FALLIDAS', 'usuarios', r.uid);
    return res.status(423).json({ error: 'Respuestas incorrectas. ' + MSG_DURO, bloqueado: true });
  }
  const quedan = MAX_PREGUNTAS - x.intentos_preguntas;       // se devuelven 3 preguntas nuevas al azar para el siguiente intento
  res.status(400).json({ error: `Respuestas incorrectas. Le quedan ${quedan} intento(s).`, quedan, ...retoPreguntas(r.uid) });
}));
app.post('/api/recuperar/clave', wrap(async (req, res) => {
  let r; try { r = jwt.verify(String(req.body?.resetToken || ''), SECRET); } catch { bad('La autorización venció. Vuelva a empezar.'); }
  if (r.p !== 'reset') bad('Solicitud inválida');
  claveNuevaOk(req.body.clave);
  const hash = await bcrypt.hash(req.body.clave, 12);
  await tx(async c => { await c.query('UPDATE usuarios SET password_hash=$2, clave_cambiada_en=now(), intentos_fallidos=0, intentos_preguntas=0, bloqueado=FALSE, bloqueado_hasta=NULL, debe_cambiar_clave=FALSE, actualizado_en=now() WHERE id=$1 AND NOT bloqueado', [r.uid, hash]);
    await aud(c, r.uid, 'RECUPERACION_CLAVE', 'usuarios', r.uid); });
  res.json({ ok: true });
}));
// Clave maestra: SOLO restablece la clave del usuario principal (no sirve para iniciar sesión ni para otros usuarios)
app.post('/api/recuperar/maestra', wrap(async (req, res) => {
  if (maestraFrenada()) throw new H(429, 'Demasiados intentos con la clave maestra. Espere 15 minutos.');
  const { username, maestra, clave } = req.body || {};
  const { rows: [u] } = await pool.query('SELECT id FROM usuarios WHERE username=$1 AND activo AND es_principal', [String(username || '').trim()]);
  if (!u || !verMaestra(maestra)) { fallosMaestra.push(Date.now()); throw new H(400, 'Usuario o clave maestra incorrectos'); }
  claveNuevaOk(clave);
  const hash = await bcrypt.hash(clave, 12);
  await tx(async c => { await c.query('UPDATE usuarios SET password_hash=$2, clave_cambiada_en=now(), intentos_fallidos=0, intentos_preguntas=0, bloqueado=FALSE, bloqueado_hasta=NULL, debe_cambiar_clave=FALSE, actualizado_en=now() WHERE id=$1', [u.id, hash]);
    await aud(c, u.id, 'RECUPERACION_CLAVE_MAESTRA', 'usuarios', u.id); });
  res.json({ ok: true });
}));

app.get('/api/version', (_q, res) => res.json({ version: process.env.APP_VERSION || '' }));

// ---------------- Semáforo de lotes, receptores frecuentes, consumo diario y verificación de auditoría ----------------
const SEMAFORO_SQL = `CASE WHEN l.fecha_vencimiento <= CURRENT_DATE THEN 'ROJO' WHEN l.fecha_vencimiento <= CURRENT_DATE + 30 THEN 'ROJO'
  WHEN l.fecha_vencimiento <= CURRENT_DATE + 90 THEN 'AMARILLO' ELSE 'VERDE' END`;     // rojo: vencido o ≤ 30 días · amarillo: 31–90 · verde: más de 90
app.get('/api/inventario', auth(...LEE), wrap(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 60);
  const { rows } = await pool.query(`SELECT l.id, p.dci_principio_activo, p.concentracion, p.presentacion, p.codigo_interno, p.codigo_barras, l.numero_lote, l.fecha_vencimiento, l.cantidad_actual,
      (l.fecha_vencimiento - CURRENT_DATE) AS dias, ${SEMAFORO_SQL} AS semaforo, (l.fecha_vencimiento <= CURRENT_DATE) AS vencido
    FROM lotes l JOIN productos p ON p.id=l.producto_id
    WHERE l.cantidad_actual > 0 AND ($1='' OR p.dci_principio_activo ILIKE '%'||$1||'%' OR p.nombre_comercial ILIKE '%'||$1||'%' OR p.codigo_barras=$1 OR p.codigo_interno=$1 OR l.numero_lote ILIKE $1||'%')
    ORDER BY l.fecha_vencimiento, p.dci_principio_activo LIMIT 1000`, [q]);
  const resumen = { ROJO: { lotes: 0, unidades: 0 }, AMARILLO: { lotes: 0, unidades: 0 }, VERDE: { lotes: 0, unidades: 0 } };
  for (const r of (await pool.query(`SELECT ${SEMAFORO_SQL} AS s, count(*)::int AS n, sum(l.cantidad_actual)::int AS u FROM lotes l WHERE l.cantidad_actual > 0 GROUP BY 1`)).rows) { resumen[r.s].lotes = r.n; resumen[r.s].unidades = r.u; }
  res.json({ resumen, lotes: rows });
}));
app.get('/api/receptores', auth(...ESCRIBE), wrap(async (_q, res) => res.json((await pool.query(
  `SELECT DISTINCT ON (recibe_cedula) recibe_cedula, recibe_nombre, recibe_cargo FROM actas_despacho ORDER BY recibe_cedula, fecha_hora DESC LIMIT 200`)).rows)));
app.get('/api/reportes/consumo-diario', auth(...LEE), wrap(async (req, res) => {
  const hoy = new Date().toISOString().slice(0, 10), desde = req.query.desde ? fecha(req.query.desde) : hoy, hasta = req.query.hasta ? fecha(req.query.hasta) : desde;
  if (desde > hasta) bad('La fecha «Desde» no puede ser posterior a «Hasta»');
  const { rows } = await pool.query(`SELECT k.fecha_hora::date AS fecha, s.nombre AS servicio, s.tipo, p.dci_principio_activo AS dci, p.concentracion, p.presentacion, p.categoria,
      SUM(k.cantidad)::int AS unidades, count(DISTINCT k.acta_id)::int AS despachos
    FROM movimientos_kardex k JOIN servicios_cdi_asic s ON s.id=k.servicio_id JOIN productos p ON p.id=k.producto_id
    WHERE k.tipo='SALIDA' AND k.fecha_hora >= $1::date AND k.fecha_hora < $2::date + 1
      AND NOT EXISTS (SELECT 1 FROM anulaciones_despacho an WHERE an.acta_id = k.acta_id)
    GROUP BY 1, s.nombre, s.tipo, p.dci_principio_activo, p.concentracion, p.presentacion, p.categoria ORDER BY 1, s.nombre, p.dci_principio_activo`, [desde, hasta]);
  res.json({ desde, hasta, filas: rows, total_unidades: rows.reduce((t, r) => t + r.unidades, 0) });
}));
app.get('/api/auditoria/integridad', auth(...REGENTE, 'INSPECTOR_ASIC'), wrap(async (_q, res) => {
  const { rows: [r] } = await pool.query('SELECT total::int, primer_error::int FROM fn_verificar_auditoria()'); res.json(r);
}));

// ---------------- Anulación de despachos ----------------
app.get('/api/actas', auth(...LEE), wrap(async (req, res) => {
  const { desde, hasta, q } = req.query, p = [], w = [];
  if (desde) { p.push(fecha(desde)); w.push(`a.fecha_hora >= $${p.length}`); }
  if (hasta) { p.push(fecha(hasta)); w.push(`a.fecha_hora < ($${p.length}::date + 1)`); }
  if (q) { p.push('%' + String(q).slice(0, 60) + '%'); w.push(`(a.nro_acta ILIKE $${p.length} OR a.recibe_nombre ILIKE $${p.length} OR s.nombre ILIKE $${p.length})`); }
  const { rows } = await pool.query(`SELECT a.id, a.nro_acta, a.fecha_hora, s.nombre AS servicio, a.recibe_nombre, u.nombre_completo AS entrega,
      (an.id IS NOT NULL) AS anulada, an.motivo AS motivo_anulacion,
      (SELECT COALESCE(SUM(k.cantidad),0)::int FROM movimientos_kardex k WHERE k.acta_id=a.id AND k.tipo='SALIDA') AS unidades
    FROM actas_despacho a JOIN servicios_cdi_asic s ON s.id=a.servicio_id JOIN usuarios u ON u.id=a.entrega_usuario
    LEFT JOIN anulaciones_despacho an ON an.acta_id=a.id ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY a.fecha_hora DESC LIMIT 200`, p);
  res.json(rows);
}));
app.post('/api/actas/:id/anular', auth(...REGENTE), operativo, wrap(async (req, res) => {
  if (!RX.uuid.test(req.params.id)) bad('Acta inválida');
  const motivo = tx_(req.body?.motivo, 500); if (motivo.length < 15) bad('Explique el motivo de la anulación (mínimo 15 caracteres)');
  const { rows: [u] } = await pool.query('SELECT password_hash FROM usuarios WHERE id=$1', [req.user.id]);
  if (!(await bcrypt.compare(String(req.body?.password || ''), u.password_hash))) throw new H(401, 'Su clave no es correcta');
  const { rows: [r] } = await pool.query('SELECT fn_anular_despacho($1,$2,$3) AS n', [req.params.id, motivo, req.user.id]);
  res.json({ ok: true, reintegrados: r.n });
}));

// ---------------- Conteo físico y cierre mensual ----------------
app.get('/api/cierre/estado', auth(...LEE), wrap(async (_q, res) => res.json(await estadoCierre())));
app.get('/api/conteos', auth(...LEE), wrap(async (_q, res) => res.json((await pool.query(`SELECT c.id, c.periodo, c.estado, c.iniciado_en, c.cerrado_en, c.observaciones, ui.nombre_completo AS iniciado_por, uc.nombre_completo AS cerrado_por,
  (SELECT count(*)::int FROM conteo_items i WHERE i.conteo_id=c.id) AS lotes, (SELECT count(*)::int FROM conteo_items i WHERE i.conteo_id=c.id AND i.cantidad_fisica <> i.cantidad_sistema) AS diferencias
  FROM conteos c JOIN usuarios ui ON ui.id=c.iniciado_por LEFT JOIN usuarios uc ON uc.id=c.cerrado_por ORDER BY c.periodo DESC LIMIT 36`)).rows)));
app.post('/api/conteos', auth(...REGENTE), wrap(async (req, res) => {
  const e = await estadoCierre(), per = String(req.body?.periodo || '');
  if (![e.previo, e.actual].includes(per)) bad(`Solo puede contar el mes anterior (${e.previo}) o el actual (${e.actual})`);
  const { rows: [r] } = await pool.query('SELECT fn_iniciar_conteo($1,$2) AS id', [per, req.user.id]);
  res.status(201).json(r);
}));
app.get('/api/conteos/:id', auth(...LEE), wrap(async (req, res) => {
  if (!RX.uuid.test(req.params.id)) bad('Conteo inválido');
  const { rows: [c] } = await pool.query('SELECT c.*, ui.nombre_completo AS iniciado_nombre, uc.nombre_completo AS cerrado_nombre FROM conteos c JOIN usuarios ui ON ui.id=c.iniciado_por LEFT JOIN usuarios uc ON uc.id=c.cerrado_por WHERE c.id=$1', [req.params.id]);
  if (!c) throw new H(404, 'Conteo no encontrado');
  c.items = (await pool.query(`SELECT i.lote_id, i.cantidad_sistema, i.cantidad_fisica, i.motivo, l.numero_lote, l.fecha_vencimiento, p.dci_principio_activo, p.concentracion, p.presentacion, p.codigo_interno, p.codigo_barras
    FROM conteo_items i JOIN lotes l ON l.id=i.lote_id JOIN productos p ON p.id=l.producto_id WHERE i.conteo_id=$1 ORDER BY p.dci_principio_activo, l.fecha_vencimiento`, [req.params.id])).rows;
  res.json(c);
}));
app.put('/api/conteos/:id/items', auth(...ESCRIBE), wrap(async (req, res) => {
  const it = req.body?.items; if (!RX.uuid.test(req.params.id) || !Array.isArray(it) || it.length > 5000) bad('Datos inválidos');
  const items = it.map(x => {
    if (!RX.uuid.test(String(x.lote_id))) bad('Lote inválido');
    const f = x.cantidad_fisica === '' || x.cantidad_fisica == null ? '' : x.cantidad_fisica;
    if (f !== '' && !entero(f, 0, 1e7)) bad('Las cantidades físicas deben ser enteros ≥ 0');
    return { lote_id: x.lote_id, cantidad_fisica: String(f), motivo: tx_(x.motivo, 300) };
  });
  const { rows: [r] } = await pool.query('SELECT fn_guardar_conteo($1,$2::jsonb,$3) AS n', [req.params.id, JSON.stringify(items), req.user.id]);
  res.json({ guardados: r.n });
}));
app.post('/api/conteos/:id/cerrar', auth(...REGENTE), wrap(async (req, res) => {
  if (!RX.uuid.test(req.params.id)) bad('Conteo inválido');
  const { rows: [u] } = await pool.query('SELECT password_hash FROM usuarios WHERE id=$1', [req.user.id]);
  if (!(await bcrypt.compare(String(req.body?.password || ''), u.password_hash))) throw new H(401, 'Su clave no es correcta');
  const { rows: [r] } = await pool.query('SELECT fn_cerrar_conteo($1,$2,$3) AS r', [req.params.id, req.user.id, tx_(req.body?.observaciones, 500)]);
  res.json(r.r);
}));
app.delete('/api/conteos/:id', auth(...REGENTE), wrap(async (req, res) => {
  if (!RX.uuid.test(req.params.id)) bad('Conteo inválido');
  await pool.query('SELECT fn_cancelar_conteo($1,$2)', [req.params.id, req.user.id]); res.json({ ok: true });
}));

// ---------------- Autenticación ----------------
const fallos = new Map();
app.post('/api/login', wrap(async (req, res) => {
  const { username, password } = req.body || {};
  const { rows: [u] } = await pool.query('SELECT * FROM usuarios WHERE username=$1 AND activo', [String(username || '').slice(0, 60)]);
  if (!u) throw new H(401, 'Credenciales inválidas');
  if (u.bloqueado) return res.status(423).json({ error: MSG_DURO, bloqueado: true });
  if (u.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date()) {
    const min = Math.ceil((new Date(u.bloqueado_hasta) - Date.now()) / 60000);
    return res.status(423).json({ error: `Cuenta bloqueada temporalmente por intentos fallidos. Intente de nuevo en ${min} minuto(s) o recupere el acceso con las preguntas de seguridad.`, recuperar: true, bloqueoTemporal: true });
  }
  if (!(await bcrypt.compare(String(password || ''), u.password_hash))) {
    const { rows: [x] } = await pool.query('UPDATE usuarios SET intentos_fallidos = intentos_fallidos + 1 WHERE id=$1 RETURNING intentos_fallidos', [u.id]);
    await aud(pool, u.id, 'LOGIN_FALLIDO', 'usuarios', u.id, { intento: x.intentos_fallidos });
    if (x.intentos_fallidos >= MAX_LOGIN) {
      await pool.query(`UPDATE usuarios SET bloqueado_hasta = now() + interval '${MIN_BLOQUEO} minutes', intentos_fallidos = 0 WHERE id=$1`, [u.id]);
      await aud(pool, u.id, 'BLOQUEO_TEMPORAL', 'usuarios', u.id, { minutos: MIN_BLOQUEO });
      return res.status(423).json({ error: `Clave incorrecta. Se alcanzaron ${MAX_LOGIN} intentos: la cuenta se bloqueó ${MIN_BLOQUEO} minutos. Puede recuperar el acceso con las preguntas de seguridad.`, recuperar: true, bloqueoTemporal: true });
    }
    throw new H(401, `Credenciales inválidas. Le quedan ${MAX_LOGIN - x.intentos_fallidos} intento(s).`);
  }
  if (u.intentos_fallidos || u.bloqueado_hasta) await pool.query('UPDATE usuarios SET intentos_fallidos=0, bloqueado_hasta=NULL WHERE id=$1', [u.id]);
  await pool.query("INSERT INTO auditoria (usuario_id, accion, ip) VALUES ($1,'LOGIN',$2)", [u.id, req.ip]);
  res.json({ token: jwt.sign({ id: u.id, rol: u.rol, nombre: u.nombre_completo }, SECRET, { expiresIn: '10h' }),
             rol: u.rol, nombre: u.nombre_completo, cambiar: u.debe_cambiar_clave, configurar: !u.recuperacion_configurada });
}));

// ---------------- Catálogo ----------------
app.get('/api/productos', auth(...LEE), wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const { rows } = await pool.query(`
    SELECT p.*, COALESCE(SUM(l.cantidad_actual) FILTER (WHERE l.estado='ACTIVO' AND l.fecha_vencimiento>CURRENT_DATE),0)::int AS stock,
           MIN(l.fecha_vencimiento) FILTER (WHERE l.estado='ACTIVO' AND l.cantidad_actual>0 AND l.fecha_vencimiento>CURRENT_DATE) AS proximo_vencimiento
    FROM productos p LEFT JOIN lotes l ON l.producto_id=p.id
    WHERE p.activo AND ($1='' OR p.codigo_barras=$1 OR p.codigo_interno=$1
          OR p.dci_principio_activo ILIKE '%'||$1||'%' OR p.nombre_comercial ILIKE '%'||$1||'%')
    GROUP BY p.id ORDER BY p.dci_principio_activo LIMIT 50`, [q]);
  res.json(rows);
}));
app.get('/api/productos/:id/equivalentes', auth(...LEE), wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM v_equivalentes WHERE producto_id=$1 ORDER BY stock DESC', [req.params.id]);
  res.json(rows);
}));
app.post('/api/productos', auth(...REGENTE), wrap(async (req, res) => {
  const { e, n } = normProducto(req.body); if (e.length) bad(e[0]);
  const p = await tx(async c => {
    const { rows: [p] } = await c.query(`INSERT INTO productos (${colsP.join(',')}) VALUES (${colsP.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`, colsP.map(k => n[k]));
    await aud(c, req.user.id, 'ALTA_PRODUCTO', 'productos', p.id, { dci: p.dci_principio_activo }); return p;
  }).catch(x => { throw x.code === '23505' ? new H(400, 'Ya existe un producto con ese código de barras') : x; });
  res.status(201).json(p);
}));
app.get('/api/servicios', auth(...LEE), wrap(async (_q, res) =>
  res.json((await pool.query('SELECT id, nombre, tipo FROM servicios_cdi_asic WHERE activo ORDER BY tipo, nombre')).rows)));
app.get('/api/proveedores', auth(...LEE), wrap(async (_q, res) =>
  res.json((await pool.query('SELECT id, nombre, tipo FROM proveedores_origen WHERE activo ORDER BY nombre')).rows)));
app.get('/api/lotes', auth(...ESCRIBE), wrap(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT l.id, l.numero_lote, l.fecha_vencimiento, l.cantidad_actual, l.estado, p.dci_principio_activo, p.concentracion
    FROM lotes l JOIN productos p ON p.id=l.producto_id
    WHERE l.cantidad_actual>0 AND ($1='' OR p.dci_principio_activo ILIKE '%'||$1||'%' OR p.nombre_comercial ILIKE '%'||$1||'%' OR l.numero_lote ILIKE $1||'%')
    ORDER BY l.fecha_vencimiento LIMIT 50`, [String(req.query.q || '').trim()]);
  res.json(rows);
}));

// ---------------- Operaciones (el usuario SIEMPRE sale del token, nunca del cuerpo) ----------------
app.post('/api/entradas', auth(...ESCRIBE), wrap(async (req, res) => {
  const b = req.body;
  const { rows: [r] } = await pool.query('SELECT fn_registrar_entrada($1,$2,$3,$4,$5,$6,$7) AS lote_id',
    [b.producto_id, b.numero_lote, fecha(b.fecha_vencimiento), +b.cantidad, b.proveedor_id || null, b.documento || null, req.user.id]);
  res.status(201).json(r);
}));

app.get('/api/fefo/:id', auth(...ESCRIBE), wrap(async (req, res) => {       // vista previa (no descuenta)
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    res.json((await c.query('SELECT * FROM fn_asignar_fefo($1,$2)', [req.params.id, +req.query.cantidad])).rows);
  } finally { await c.query('ROLLBACK').catch(() => {}); c.release(); }
}));

app.post('/api/despachos', auth(...ESCRIBE), wrap(async (req, res) => {
  const b = req.body;
  if (!b.recibe_cedula || !b.recibe_nombre || !b.recibe_cargo) throw new H(400, 'Faltan los datos de quien recibe');
  const { rows: [r] } = await pool.query('SELECT fn_despachar($1,$2,$3,$4,$5,$6::jsonb,$7) AS acta_id',
    [b.servicio_id, b.recibe_cedula, b.recibe_nombre, b.recibe_cargo, req.user.id, JSON.stringify(b.items || []), b.observaciones || null]);
  res.status(201).json(r);
}));
app.get('/api/actas/:id', auth(...LEE), wrap(async (req, res) => {
  const { rows: [a] } = await pool.query(`
    SELECT a.*, s.nombre AS servicio, u.nombre_completo AS entrega_nombre, u.cedula AS entrega_cedula
    FROM actas_despacho a JOIN servicios_cdi_asic s ON s.id=a.servicio_id JOIN usuarios u ON u.id=a.entrega_usuario WHERE a.id=$1`, [req.params.id]);
  if (!a) throw new H(404, 'Acta no encontrada');
  a.items = (await pool.query(`
    SELECT p.dci_principio_activo, p.nombre_comercial, p.presentacion, p.concentracion, l.numero_lote, l.fecha_vencimiento, k.cantidad,
           dc.folio, dc.paciente_cedula, dc.paciente_nombre, dc.medico_nombre, dc.medico_matricula_mpps, dc.nro_recipe
    FROM movimientos_kardex k JOIN productos p ON p.id=k.producto_id JOIN lotes l ON l.id=k.lote_id
    LEFT JOIN dispensacion_controlados dc ON dc.movimiento_id=k.id
    WHERE k.acta_id=$1 AND k.tipo='SALIDA' ORDER BY p.dci_principio_activo, l.fecha_vencimiento`, [req.params.id])).rows;
  a.anulacion = (await pool.query(`SELECT an.motivo, an.fecha_hora, u.nombre_completo AS por FROM anulaciones_despacho an JOIN usuarios u ON u.id=an.anulado_por WHERE an.acta_id=$1`, [req.params.id])).rows[0] || null;
  res.json(a);
}));

app.post('/api/mermas', auth(...ESCRIBE), wrap(async (req, res) => {
  const b = req.body;
  const { rows: [a] } = await pool.query("SELECT * FROM usuarios WHERE username=$1 AND activo AND rol='FARMACEUTICO_REGENTE'", [b.autoriza_username]);
  if (!a || !(await bcrypt.compare(String(b.autoriza_password || ''), a.password_hash)))
    throw new H(401, 'Credenciales del Regente autorizador inválidas');
  const { rows: [r] } = await pool.query('SELECT fn_registrar_merma($1,$2,$3,$4,$5,$6,$7) AS merma_id',
    [b.lote_id, +b.cantidad, b.motivo, b.descripcion, req.user.id, a.id, b.evidencia_url || null]);
  res.status(201).json(r);
}));

app.post('/api/libro/:folio/firmar', auth(...REGENTE), wrap(async (req, res) => {
  await pool.query('SELECT fn_firmar_libro($1,$2)', [req.params.folio, req.user.id]);
  res.json({ ok: true });
}));

// ---------------- Dashboard y reportes ----------------
app.get('/api/dashboard', auth(...LEE), wrap(async (_q, res) => {
  const [v, crit, pv, hoy] = await Promise.all([
    pool.query(`SELECT count(*) FILTER (WHERE fecha_vencimiento<=CURRENT_DATE)::int AS vencidos,
        count(*) FILTER (WHERE fecha_vencimiento>CURRENT_DATE AND fecha_vencimiento<=CURRENT_DATE+30)::int AS v30,
        count(*) FILTER (WHERE fecha_vencimiento>CURRENT_DATE+30 AND fecha_vencimiento<=CURRENT_DATE+60)::int AS v60,
        count(*) FILTER (WHERE fecha_vencimiento>CURRENT_DATE+60 AND fecha_vencimiento<=CURRENT_DATE+90)::int AS v90
        FROM lotes WHERE cantidad_actual>0 AND estado IN ('ACTIVO','VENCIDO')`),
    pool.query('SELECT dci_principio_activo, stock_minimo, stock_actual FROM v_stock_critico ORDER BY stock_actual LIMIT 30'),
    pool.query(`SELECT p.dci_principio_activo, p.concentracion, l.numero_lote, l.fecha_vencimiento, l.cantidad_actual
        FROM lotes l JOIN productos p ON p.id=l.producto_id
        WHERE l.cantidad_actual>0 AND l.estado IN ('ACTIVO','VENCIDO') AND l.fecha_vencimiento<=CURRENT_DATE+90
        ORDER BY l.fecha_vencimiento LIMIT 20`),
    pool.query("SELECT count(*)::int AS n FROM actas_despacho WHERE fecha_hora::date=CURRENT_DATE")]);
  res.json({ ...v.rows[0], criticos: crit.rows, por_vencer: pv.rows, despachos_hoy: hoy.rows[0].n });
}));

app.get('/api/reportes/kardex', auth(...LEE), wrap(async (req, res) => {
  const { rows: [p] } = await pool.query('SELECT * FROM productos WHERE id=$1', [req.query.producto]);
  if (!p) throw new H(404, 'Producto no encontrado');
  const { rows } = await pool.query('SELECT * FROM fn_kardex_sanitario($1,$2,$3)',
    [p.id, fecha(req.query.desde), fecha(req.query.hasta)]);
  enviar(req, res, ['fecha_hora', 'tipo', 'numero_lote', 'fecha_vencimiento', 'entrada', 'salida', 'saldo_producto',
    'documento_ref', 'origen_destino', 'responsable'], rows, 'kardex_' + p.codigo_interno,
    [`${process.env.INSTITUCION || 'Mi institución'} - Kardex;${p.dci_principio_activo} ${p.concentracion || ''} ${p.presentacion};Reg. Sanitario INHRR: ${p.registro_sanitario_inhrr || 'N/A'}`,
     `Periodo;${req.query.desde};${req.query.hasta}`]);
}));
app.get('/api/reportes/libro-folia', auth(...REGENTE, 'INSPECTOR_ASIC'), wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM v_libro_folia WHERE fecha_hora>=$1 AND fecha_hora<$2::date+1 ORDER BY folio',
    [fecha(req.query.desde), fecha(req.query.hasta)]);
  enviar(req, res, ['folio', 'fecha_hora', 'dci_principio_activo', 'nombre_comercial', 'concentracion', 'numero_lote', 'cantidad',
    'paciente_cedula', 'paciente_nombre', 'medico_nombre', 'medico_matricula_mpps', 'colegio_medicos_nro', 'nro_recipe',
    'farmaceutico', 'firmado_por', 'fecha_firma'], rows, 'libro_folia');
}));
app.get('/api/reportes/consolidado', auth(...LEE), wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM fn_consolidado_asic($1,$2)', [fecha(req.query.desde), fecha(req.query.hasta)]);
  enviar(req, res, ['destino', 'tipo_destino', 'dci', 'presentacion', 'concentracion', 'total_despachado'], rows, 'consolidado_asic');
}));
app.get('/api/libro/verificar', auth(...REGENTE, 'INSPECTOR_ASIC'), wrap(async (_q, res) => {
  const { rows } = await pool.query('SELECT * FROM fn_verificar_libro_folia()');
  res.json({ total: rows.length, anomalias: rows.filter(r => r.estado !== 'OK') });
}));

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '../web');
// Nombre de la institución configurable por variables de entorno (INSTITUCION / ENTIDAD)
app.get('/config.json', (_q, res) => {
  const c = JSON.parse(fs.readFileSync(path.join(WEB, 'config.json'), 'utf8'));
  if (process.env.INSTITUCION) c.institucion = process.env.INSTITUCION;
  if (process.env.ENTIDAD !== undefined) c.entidad = process.env.ENTIDAD;
  res.json(c);
});
app.use(express.static(WEB, { dotfiles: 'ignore', index: 'index.html' }));

// Marcar lotes vencidos al arrancar y cada hora
const venc = () => pool.query('SELECT fn_marcar_vencidos()').catch(e => console.error('vencidos:', e.message));
venc(); setInterval(venc, 3600e3);

app.use((err, req, res, _next) => {
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'El archivo es demasiado grande' });
  if (err && err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: 'Solicitud inválida' });
  console.error(err); res.status(500).json({ error: 'Error interno' });
});
app.listen(process.env.PORT || 3000, process.env.HOST || '127.0.0.1', () => console.log('Farmacia hospitalaria en puerto', process.env.PORT || 3000));
