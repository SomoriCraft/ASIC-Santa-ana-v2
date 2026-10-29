const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let T=sessionStorage.t, ROL=sessionStorage.r;       // la sesión se cierra al cerrar el navegador
const CONTROLADOS=['CONTROLADO_PSICOTROPICO','ESTUPEFACIENTE'];
let CFG={institucion:'Mi institución',entidad:'',sistema:'Control de Inventario y Farmacia',logo:'logo.png'};
async function cargarConfig(){
  try{Object.assign(CFG,await (await fetch('config.json')).json())}catch{}
  document.title='Farmacia · '+CFG.institucion;$('#tt').textContent='Farmacia · '+CFG.institucion;
  $('#lg').src=CFG.logo;$('#lg').alt=CFG.entidad;
}

// ---------- Tema (Automático / Claro / Oscuro) ----------
const TEMAS=[['auto','Tema: automático'],['light','Tema: claro'],['dark','Tema: oscuro']];
function temaActual(){try{return localStorage.tema||'auto'}catch{return'auto'}}
function aplicarTema(t){const h=document.documentElement;t==='auto'?h.removeAttribute('data-theme'):h.dataset.theme=t;
  $('#tema').textContent=TEMAS.find(x=>x[0]===t)[1];const dark=t==='dark'||(t==='auto'&&matchMedia('(prefers-color-scheme:dark)').matches);
  document.querySelector('meta[name=theme-color]').content=dark?'#134e4a':'#0f766e'}
$('#tema').onclick=()=>{const n=TEMAS[(TEMAS.findIndex(x=>x[0]===temaActual())+1)%3][0];try{localStorage.tema=n}catch{}aplicarTema(n)};
aplicarTema(temaActual());
const msg=(t,bad)=>{$('#msg').textContent=t||'';$('#msg').className=bad?'bad':'ok'};

async function api(p,o={}){
  const r=await fetch('/api'+p,{method:o.method||'GET',headers:{'Content-Type':'application/json',...(T&&{Authorization:'Bearer '+T})},
    body:o.body&&JSON.stringify(o.body)});
  const j=await r.json().catch(()=>({}));
  if(r.status===401&&T&&p!=='/login'){salir();throw new Error('Sesión vencida')}
  if(!r.ok){const e=new Error(j.error||'Error '+r.status);e.datos=j;throw e}
  return j;
}
async function bajar(ruta,nombre){
  const r=await fetch('/api'+ruta,{headers:{Authorization:'Bearer '+T}});
  if(!r.ok)return msg((await r.json()).error,1);
  const a=document.createElement('a');a.href=URL.createObjectURL(await r.blob());a.download=nombre;a.click();
}
const tabla=(h,f)=>`<div class="tw"><table><tr>${h.map(x=>`<th>${esc(x)}</th>`).join('')}</tr>${
  f.length?f.map(r=>`<tr>${r.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${h.length}">Sin registros</td></tr>`}</table></div>`;
const run=(fn)=>async()=>{try{msg('');await fn()}catch(e){msg(e.message,1)}};

// Buscador genérico (usa textContent: sin riesgo de inyección)
function picker(host,onPick,ruta,lab){
  host.innerHTML='<input placeholder="Buscar…" autocomplete="off"><div class="res"></div>';
  const i=host.querySelector('input'),r=host.querySelector('.res');let t;
  i.oninput=()=>{clearTimeout(t);t=setTimeout(run(async()=>{
    const d=await api(ruta+encodeURIComponent(i.value));r.innerHTML='';
    d.forEach(x=>{const b=document.createElement('button');b.className='row';b.textContent=lab(x);
      b.onclick=()=>{onPick(x);r.innerHTML='';i.value=lab(x)};r.append(b)});
  }),250)};
}
let labProd=p=>`${p.dci_principio_activo} ${p.concentracion||''} · ${p.presentacion}${p.nombre_comercial?' ('+p.nombre_comercial+')':''} · stock ${p.stock??'-'}${CONTROLADOS.includes(p.tipo_control)?' · CONTROLADO':''}`;
let labLote=l=>`${l.dci_principio_activo} ${l.concentracion||''} · lote ${l.numero_lote} · vence ${l.fecha_vencimiento} · ${l.cantidad_actual} u · ${l.estado}`;

// ---------- Login ----------
const VAL={
  u:v=>!v.trim()?'Escriba su usuario':!/^[A-Za-z0-9_.-]{3,50}$/.test(v.trim())?'3 a 50 caracteres: letras, números, punto, guion o guion bajo (sin espacios)':'',
  p:v=>!v?'Escriba su clave':v.length>128?'La clave es demasiado larga (máximo 128)':''
};
function login(){
  $('#nav').innerHTML='';msg('');
  $('#v').innerHTML=`<div class="auth"><form class="card" id="f" novalidate><img class="lgl" src="${esc(CFG.logo)}" alt="">
  <h2>${esc(CFG.sistema)}</h2><p class="sub">${esc(CFG.institucion)}</p>
  <div class="fld"><label for="u">Usuario</label><input id="u" autocomplete="username" placeholder="Ej. mperez" maxlength="50" autocapitalize="off" spellcheck="false" aria-describedby="eu" autofocus><span class="err" id="eu"></span></div>
  <div class="fld"><label for="p">Clave</label><div class="in"><input id="p" type="password" autocomplete="current-password" maxlength="128" aria-describedby="ep"><button type="button" id="ver" aria-label="Mostrar u ocultar la clave">Mostrar</button></div>
  <span class="err" id="ep"></span><span class="hint" id="cap"></span></div>
  <div class="alert" id="le" role="alert"></div><button class="pri" id="go" type="submit">Entrar</button>
  <p class="lnks"><button type="button" class="lk" id="ol">¿Olvidó su clave?</button><button type="button" class="lk" id="mp">Soy el usuario principal (clave maestra)</button></p></form></div>`;
  const campo=k=>{const i=$('#'+k),e=$('#e'+k),m=VAL[k](i.value);e.textContent=m;i.setAttribute('aria-invalid',m?'true':'false');i.classList.toggle('v',!m&&!!i.value);return !m};
  ['u','p'].forEach(k=>{const i=$('#'+k);i.addEventListener('blur',()=>campo(k));i.addEventListener('input',()=>{$('#le').classList.remove('on');if(i.getAttribute('aria-invalid')==='true')campo(k)})});
  $('#ol').onclick=()=>recuperar($('#u').value.trim());$('#mp').onclick=()=>recuperarMaestra($('#u').value.trim());
  $('#ver').onclick=()=>{const i=$('#p'),o=i.type==='password';i.type=o?'text':'password';$('#ver').textContent=o?'Ocultar':'Mostrar'};
  $('#p').addEventListener('keyup',e=>{$('#cap').textContent=e.getModifierState&&e.getModifierState('CapsLock')?'⚠ Bloq Mayús está activado':''});
  $('#f').onsubmit=async ev=>{ev.preventDefault();
    const bien=['u','p'].map(campo);if(bien.includes(false)){$('#'+(bien[0]?'p':'u')).focus();return}
    const b=$('#go');b.disabled=true;b.textContent='Verificando…';
    try{const r=await api('/login',{method:'POST',body:{username:$('#u').value.trim(),password:$('#p').value}});
      T=sessionStorage.t=r.token;ROL=sessionStorage.r=r.rol;arrancar();setTimeout(async()=>{await posLogin(r);Borr.revisar()},300)}
    catch(e){const l=$('#le');l.textContent=e.message;l.classList.add('on');const d=e.datos||{},u=$('#u').value.trim();if(d.recuperar)recuperar(u);else $('#p').select()}
    finally{if($('#go')){b.disabled=false;b.textContent='Entrar'}}};
}
function salir(){sessionStorage.clear();T=ROL=null;login()}

// ---------- Panel ----------
async function panel(){
  const d=await api('/dashboard');
  $('#v').innerHTML=`<div class="cards">
   <div class="c bad"><b>${d.vencidos}</b>Lotes vencidos con stock</div><div class="c bad"><b>${d.v30}</b>Vencen ≤ 30 días</div>
   <div class="c warn"><b>${d.v60}</b>31–60 días</div><div class="c"><b>${d.v90}</b>61–90 días</div>
   <div class="c"><b>${d.despachos_hoy}</b>Despachos hoy</div></div>
   <h3>Stock crítico</h3>${tabla(['Producto','Stock','Mínimo'],d.criticos.map(x=>[x.dci_principio_activo,x.stock_actual,x.stock_minimo]))}
   <h3>Lotes por vencer (90 días)</h3>${tabla(['Producto','Lote','Vence','Cantidad'],
     d.por_vencer.map(x=>[`${x.dci_principio_activo} ${x.concentracion||''}`,x.numero_lote,x.fecha_vencimiento,x.cantidad_actual]))}`;
}

// ---------- Despacho ----------
let items=[];
async function despacho(){
  const sv=await api('/servicios');items=[];
  $('#v').innerHTML=`<h3>Nuevo despacho</h3>
  <label>Destino<select id="sv">${sv.map(s=>`<option value="${esc(s.id)}">${esc(s.nombre)} (${s.tipo==='INTERNO_CDI'?'CDI':'Consultorio Popular'})</option>`).join('')}</select></label>
  <div class="g2"><label>Cédula de quien recibe<input id="rc"></label><label>Nombre de quien recibe<input id="rn"></label></div>
  <label>Rol / Cargo<input id="rg"></label>
  <div id="pk"></div><div id="it"></div><button class="pri" id="go">Despachar</button><div id="fin"></div>`;
  picker($('#pk'),p=>run(async()=>{
    const q=+prompt(`Cantidad de ${p.dci_principio_activo} (stock ${p.stock})`);
    if(!q||q<=0)return;
    const fefo=await api(`/fefo/${p.id}?cantidad=${q}`);          // valida stock y muestra lotes FEFO
    const it={producto_id:p.id,cantidad:q,label:`${p.dci_principio_activo} ${p.concentracion||''}`,fefo};
    if(CONTROLADOS.includes(p.tipo_control)){
      for(const [k,t] of [['paciente_cedula','Cédula del paciente'],['paciente_nombre','Nombre del paciente'],
        ['medico_nombre','Médico prescriptor'],['medico_matricula_mpps','Matrícula MPPS'],
        ['colegio_medicos_nro','N.º Colegio de Médicos (opcional)'],['nro_recipe','N.º de récipe / orden médica']]){
        const v=prompt(t);if(v===null)return;it[k]=v.trim();}
    }
    items.push(it);pintar();
  })(),'/productos?q=',labProd);
  $('#go').onclick=run(async()=>{
    const body={servicio_id:$('#sv').value,recibe_cedula:$('#rc').value,recibe_nombre:$('#rn').value,recibe_cargo:$('#rg').value,
      items:items.map(({label,fefo,...r})=>r)};
    const r=await api('/despachos',{method:'POST',body});
    msg('Despacho registrado.');items=[];pintar();
    $('#fin').innerHTML='<button id="pr">Imprimir acta (doble firma)</button>';
    $('#pr').onclick=run(()=>imprimirActa(r.acta_id));
  });
  pintar();
}
function pintar(){
  $('#it').innerHTML=items.map((x,i)=>`<div class="box"><b>${esc(x.label)} × ${x.cantidad}</b> <button data-i="${i}">Quitar</button><br>
   <small>FEFO: ${x.fefo.map(f=>`lote ${esc(f.numero_lote)} (vence ${esc(f.fecha_vencimiento)}) ×${f.tomar}`).join(' · ')}</small>
   ${x.nro_recipe?`<br><small>Controlado · récipe ${esc(x.nro_recipe)} · paciente ${esc(x.paciente_cedula)}</small>`:''}</div>`).join('');
  document.querySelectorAll('#it button').forEach(b=>b.onclick=()=>{items.splice(+b.dataset.i,1);pintar()});
}
function ventanaImpresion(titulo,cuerpo,horizontal){
  const w=window.open('','_blank');
  if(!w){msg('Permita ventanas emergentes para imprimir',1);return}
  w.document.write(`<html><head><title>${esc(titulo)}</title><style>
   @page{size:${horizontal?'landscape':'portrait'};margin:14mm}body{font-family:sans-serif;font-size:12px;color:#000}
   .cab{display:flex;align-items:center;gap:14px;border-bottom:2px solid #0f766e;padding-bottom:8px;margin-bottom:12px}
   .cab img{width:80px;height:80px}.cab h2{margin:0;font-size:17px}.cab small{color:#444}
   table{border-collapse:collapse;width:100%}th,td{border:1px solid #444;padding:4px 6px;text-align:left;font-size:11px}th{background:#e8f1f0}
   .pie{margin-top:14px;font-size:10px;color:#555}</style></head><body>
   <div class="cab"><img src="${esc(new URL(CFG.logo,location.href).href)}" alt=""><div><h2>${esc(titulo)}</h2>
   <small>${esc(CFG.entidad)} · ${esc(CFG.institucion)} — Farmacia hospitalaria<br>Emitido: ${esc(new Date().toLocaleString('es-VE'))}</small></div></div>
   ${cuerpo}<div class="pie">Documento generado por el sistema ${esc(CFG.sistema)} — ${esc(CFG.institucion)}</div></body></html>`);
  w.document.close();
  let ok=false;const ir=()=>{if(!ok){ok=true;w.focus();w.print()}};
  const im=w.document.querySelector('img');
  im.onload=im.onerror=ir;if(im.complete)ir();
}
async function imprimirActa(id){
  const a=await api('/actas/'+id);
  ventanaImpresion('Acta de Despacho '+a.nro_acta,`
  <p>Fecha: ${esc(new Date(a.fecha_hora).toLocaleString('es-VE'))}<br>Destino: <b>${esc(a.servicio)}</b><br>
  Recibe: ${esc(a.recibe_nombre)} (C.I. ${esc(a.recibe_cedula)}) — ${esc(a.recibe_cargo)}<br>Entrega: ${esc(a.entrega_nombre)} (C.I. ${esc(a.entrega_cedula)})</p>
  <table><tr><th>Producto</th><th>Presentación</th><th>Lote</th><th>Vence</th><th>Cant.</th></tr>
  ${a.items.map(i=>`<tr><td>${esc(i.dci_principio_activo)} ${esc(i.concentracion||'')}</td><td>${esc(i.presentacion)}</td><td>${esc(i.numero_lote)}</td><td>${esc(i.fecha_vencimiento)}</td><td>${i.cantidad}</td></tr>`).join('')}</table>
  <br><br><br><table style="border:0"><tr><td style="border:0;border-top:1px solid #000;width:45%">Entrega (Farmacia)</td><td style="border:0"></td><td style="border:0;border-top:1px solid #000;width:45%">Recibe</td></tr></table>`);
}
async function imprimirReporte(ruta,titulo,cols){
  const rows=await api(ruta),f=(k,v)=>/^fecha_(hora|firma)$/.test(k)&&v?new Date(v).toLocaleString('es-VE'):v;
  ventanaImpresion(titulo,`<table><tr>${cols.map(c=>`<th>${esc(c[1])}</th>`).join('')}</tr>${
    rows.length?rows.map(r=>`<tr>${cols.map(c=>`<td>${esc(f(c[0],r[c[0]]))}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${cols.length}">Sin registros en el periodo</td></tr>`}</table>`,true);
}
const COLS={
 kardex:[['fecha_hora','Fecha'],['tipo','Movimiento'],['numero_lote','Lote'],['fecha_vencimiento','Vence'],['entrada','Entrada'],['salida','Salida'],['saldo_producto','Saldo'],['documento_ref','Documento'],['origen_destino','Origen/Destino'],['responsable','Responsable']],
 consolidado:[['destino','Destino'],['dci','Principio activo'],['presentacion','Presentación'],['concentracion','Concentración'],['total_despachado','Total despachado']],
 libro:[['folio','Folio'],['fecha_hora','Fecha'],['dci_principio_activo','Principio activo'],['concentracion','Conc.'],['numero_lote','Lote'],['cantidad','Cant.'],['paciente_cedula','C.I. paciente'],['paciente_nombre','Paciente'],['medico_nombre','Médico'],['medico_matricula_mpps','Matrícula MPPS'],['nro_recipe','Récipe'],['farmaceutico','Farmacéutico'],['firmado_por','Firmado por']]};

// ---------- Entrada ----------
async function entrada(){
  const pv=await api('/proveedores');let prod=null;
  $('#v').innerHTML=`<h3>Recepción de mercancía</h3><div id="pk"></div><p id="sel"><i>Seleccione un producto</i></p>
  <div class="g2"><label>Lote del fabricante<input id="lo"></label><label>Vencimiento<input id="fv" type="date"></label>
  <label>Cantidad recibida<input id="ca" type="number" min="1"></label><label>Factura / Guía de despacho<input id="dc"></label></div>
  <label>Origen<select id="pr">${pv.map(p=>`<option value="${esc(p.id)}">${esc(p.nombre)}</option>`).join('')}</select></label>
  <button class="pri" id="go">Registrar entrada</button>`;
  picker($('#pk'),p=>{prod=p;$('#sel').textContent='Producto: '+labProd(p)},'/productos?q=',labProd);
  $('#go').onclick=run(async()=>{
    if(!prod)throw new Error('Seleccione un producto');
    await api('/entradas',{method:'POST',body:{producto_id:prod.id,numero_lote:$('#lo').value,fecha_vencimiento:$('#fv').value,
      cantidad:$('#ca').value,proveedor_id:$('#pr').value,documento:$('#dc').value}});
    msg('Entrada registrada.');
  });
}

// ---------- Merma ----------
async function merma(){
  let lote=null;
  $('#v').innerHTML=`<h3>Merma / Desincorporación</h3><div id="pk"></div><p id="sel"><i>Seleccione el lote afectado</i></p>
  <div class="g2"><label>Cantidad<input id="ca" type="number" min="1"></label>
  <label>Motivo<select id="mo"><option value="ROTURA">Rotura</option><option value="VENCIMIENTO">Vencimiento</option>
  <option value="CONTAMINACION">Contaminación</option><option value="CADENA_FRIO_ROTA">Cadena de frío rota</option><option value="OTRO">Otro</option></select></label></div>
  <label>Descripción de lo ocurrido<textarea id="de" rows="3"></textarea></label>
  <div class="box"><b>Autorización del Farmacéutico Regente</b><div class="g2">
  <label>Usuario<input id="au" autocomplete="off"></label><label>Clave<input id="ap" type="password" autocomplete="off"></label></div></div>
  <button class="pri" id="go">Registrar merma</button>`;
  picker($('#pk'),l=>{lote=l;$('#sel').textContent='Lote: '+labLote(l)},'/lotes?q=',labLote);
  $('#go').onclick=run(async()=>{
    if(!lote)throw new Error('Seleccione un lote');
    await api('/mermas',{method:'POST',body:{lote_id:lote.id,cantidad:$('#ca').value,motivo:$('#mo').value,descripcion:$('#de').value,
      autoriza_username:$('#au').value,autoriza_password:$('#ap').value}});
    $('#ap').value='';msg('Merma registrada. Acta de desincorporación generada.');
  });
}

// ---------- Reportes ----------
async function reportes(){
  let prod=null;const hoy=new Date().toISOString().slice(0,10),ini=hoy.slice(0,8)+'01';
  $('#v').innerHTML=`<h3>Reportes</h3><div class="g2"><label>Desde<input id="d1" type="date" value="${ini}"></label>
  <label>Hasta<input id="d2" type="date" value="${hoy}"></label></div>
  <div class="box"><b>Kardex sanitario por producto</b><div id="pk"></div><p id="sel"><i>Seleccione un producto</i></p>
  <button id="k">Descargar Kardex (CSV)</button> <button id="kp">Imprimir Kardex</button></div>
  <div class="box"><button id="c">Consolidado por destino (CSV)</button> <button id="cp">Imprimir consolidado</button></div>
  ${ROL!=='ALMACENISTA'?`<div class="box"><button id="l">Libro Folia (CSV)</button> <button id="lp">Imprimir Libro Folia</button>
  <button id="vf">Verificar integridad del Libro Folia</button></div>`:''}`;
  const per=()=>`desde=${$('#d1').value}&hasta=${$('#d2').value}`,q=()=>per()+'&formato=csv';
  picker($('#pk'),p=>{prod=p;$('#sel').textContent=labProd(p)},'/productos?q=',labProd);
  $('#k').onclick=run(async()=>{if(!prod)throw new Error('Seleccione un producto');await bajar(`/reportes/kardex?producto=${prod.id}&${q()}`,'kardex.csv')});
  $('#kp').onclick=run(async()=>{if(!prod)throw new Error('Seleccione un producto');await imprimirReporte(`/reportes/kardex?producto=${prod.id}&${per()}`,'Kardex sanitario — '+prod.dci_principio_activo+' '+(prod.concentracion||'')+` (${$('#d1').value} a ${$('#d2').value})`,COLS.kardex)});
  $('#c').onclick=run(()=>bajar('/reportes/consolidado?'+q(),'consolidado_asic.csv'));
  $('#cp').onclick=run(()=>imprimirReporte('/reportes/consolidado?'+per(),`Consolidado de despachos (${$('#d1').value} a ${$('#d2').value})`,COLS.consolidado));
  if($('#l')){
    $('#l').onclick=run(()=>bajar('/reportes/libro-folia?'+q(),'libro_folia.csv'));
    $('#lp').onclick=run(()=>imprimirReporte('/reportes/libro-folia?'+per(),`Libro Folia — estupefacientes y psicotrópicos (${$('#d1').value} a ${$('#d2').value})`,COLS.libro));
    $('#vf').onclick=run(async()=>{const r=await api('/libro/verificar');
      r.anomalias.length?msg(`ATENCIÓN: ${r.anomalias.length} anomalías (folios: ${r.anomalias.map(a=>a.folio+' '+a.estado).join(', ')})`,1)
                       :msg(`Libro íntegro: ${r.total} folios verificados.`)});
  }
}

// ---------- Navegación ----------
const VISTAS={panel,despacho,entrada,merma,reportes};
function arrancar(){
  const tabs=tabsDe(ROL);
  $('#nav').innerHTML=tabs.map(t=>`<button data-v="${t}">${NOMBRES[t]||t}</button>`).join('')+'<button id="mc">Mi clave</button><button id="sgr">Mi seguridad</button><button id="out">Salir</button>';
  $('#out').onclick=salir;$('#mc').onclick=()=>cambiarClave(false);$('#sgr').onclick=()=>seguridad(false);
  document.querySelectorAll('nav [data-v]').forEach(b=>b.onclick=()=>{
    document.querySelectorAll('nav button').forEach(x=>x.classList.remove('on'));b.classList.add('on');msg('');run(VISTAS[b.dataset.v])()});
  document.querySelector('nav [data-v=panel]').click();
}
const net=()=>{$('#net').textContent=navigator.onLine?'● Red local conectada':'○ Sin conexión con el servidor del CDI'};
addEventListener('online',net);addEventListener('offline',net);net();
if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js');
cargarConfig().then(()=>T?arrancar():login());

const mostrar=k=>{const b=document.querySelector(`nav [data-v="${k}"]`);if(b)b.click()}
