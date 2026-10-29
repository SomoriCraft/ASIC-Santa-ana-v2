'use strict';
// ===== Farmacia CDI v1.0.8: interfaz ágil (listas, ejemplos, lector, semáforo), comprobantes y consumo diario =====

// ---------- Ejemplos y listas desplegables por defecto (según el campo) ----------
const CARGOS=['Enfermera jefe','Enfermero/a','Médico/a','Auxiliar de enfermería','Coordinador/a del servicio','Odontólogo/a','Bioanalista','Radiólogo/a','Personal administrativo','Vocero/a comunitario'];
const PRESENT=['Tableta','Cápsula','Ampolla','Vial','Frasco','Jarabe','Suspensión','Gotas','Crema','Ungüento','Supositorio','Inhalador','Parche','Sobre','Solución inyectable','Unidad'];
const CONCEN=['5 mg','10 mg','20 mg','40 mg','100 mg','250 mg','500 mg','1 g','100 mg/5 mL','250 mg/5 mL','0,9 %','5 %'];
const PH={rc:'Ej. V-12345678',rn:'Ej. María Pérez',rg:'Ej. Enfermera jefe',lo:'Ej. Lote-A2026',ca:'Ej. 100',dc:'Ej. Factura 000123',de:'Ej. 5 ampollas rotas durante el traslado',au:'Ej. regente',
  paciente_cedula:'Ej. V-12345678',paciente_nombre:'Ej. Juan Rodríguez',medico_nombre:'Ej. Dra. Ana Torres',medico_matricula_mpps:'Ej. MPPS-12345',colegio_medicos_nro:'Ej. CM-4567',nro_recipe:'Ej. 0001234',
  codigo_barras:'Ej. 7591234567890',dci_principio_activo:'Ej. Acetaminofén',nombre_comercial:'Ej. Tempra',presentacion:'Ej. Tableta',concentracion:'Ej. 500 mg',registro_sanitario_inhrr:'Ej. E.F. 12345',
  stock_minimo:'Ej. 100',stock_maximo:'Ej. 500',nombre_completo:'Ej. María Pérez',cedula:'Ej. V-12345678',cargo:'Ej. Auxiliar de farmacia',matricula_mpps:'Ej. MPPS-12345',username:'Ej. mperez',
  ob:'Ej. Conteo realizado por dos personas',mo:'Ej. Error en la cantidad entregada',hq:'Ej. Acta 000123, servicio o receptor',au_:'Ej. regente',ac:'Ej. ANULAR_DESPACHO'};
const LISTAS={rg:CARGOS,cargo:CARGOS,presentacion:PRESENT,concentracion:CONCEN};
const campoHTML0=campoHTML;
campoHTML=function(c){
  if(c.opts||c.type==='check'||c.type==='area'||c.type==='date'||c.type==='password')return campoHTML0(c);
  return campoHTML0({...c,ph:c.ph||PH[c.id],lista:c.lista||LISTAS[c.id]});
};

// ---------- Pitido del lector ----------
function bip(ok=true){try{const c=bip.c||(bip.c=new (window.AudioContext||window.webkitAudioContext)()),o=c.createOscillator(),g=c.createGain();
  o.frequency.value=ok?1100:260;g.gain.value=.07;o.connect(g);g.connect(c.destination);o.start();o.stop(c.currentTime+(ok?.07:.25))}catch{}}
// El lector USB "escribe" rápido y termina con Enter: si el cursor no está en un campo, se envía al buscador de la pantalla
document.addEventListener('keydown',e=>{
  if(e.ctrlKey||e.altKey||e.metaKey||e.key.length!==1||document.querySelector('dialog[open]'))return;
  const t=e.target;if(t&&/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))return;
  const b=document.querySelector('#pk input')||document.querySelector('#fq');if(b)b.focus();
});

// ---------- Semáforo de lotes ----------
const semDias=f=>Math.round((new Date(String(f).slice(0,10)+'T00:00:00')-new Date(new Date().toDateString()))/864e5);
const semDe=f=>{const d=semDias(f);return d<=30?'rojo':d<=90?'ambar':'verde'};
const semPunto=f=>({rojo:'🔴',ambar:'🟡',verde:'🟢'})[semDe(f)];
const semTxt=f=>{const d=semDias(f);return d<=0?'VENCIDO':d===1?'vence mañana':`${d} días`};
const labProd0=labProd,labLote0=labLote;
labProd=p=>(p.proximo_vencimiento?semPunto(p.proximo_vencimiento)+' ':'')+labProd0(p)+(p.proximo_vencimiento?` · próx. vence ${p.proximo_vencimiento.slice(0,10)}`:'');
labLote=l=>semPunto(l.fecha_vencimiento)+' '+labLote0(l);
pintar=function(){
  $('#it').innerHTML=items.map((x,i)=>`<div class="box"><b>${esc(x.label)} × ${x.cantidad}</b> <button data-i="${i}">Quitar</button><br>
   <small>FEFO: ${x.fefo.map(f=>`${semPunto(f.fecha_vencimiento)} lote ${esc(f.numero_lote)} (vence ${esc(f.fecha_vencimiento)}) ×${f.tomar}`).join(' · ')}</small>
   ${x.nro_recipe?`<br><small>Controlado · récipe ${esc(x.nro_recipe)} · paciente ${esc(x.paciente_cedula)}</small>`:''}</div>`).join('');
  document.querySelectorAll('#it button').forEach(b=>b.onclick=()=>{items.splice(+b.dataset.i,1);pintar();document.querySelector('#v').dispatchEvent(new Event('input'))});
};
const semBadge=(s,t)=>`<span class="chip ${s}"><span class="sem ${s}"></span>${esc(t)}</span>`;
async function inventario(){
  let filtro='';
  $('#v').innerHTML=`<h3>Existencias por lote (semáforo)</h3><div class="tarjetas" id="rs"></div><input id="iq" placeholder="Buscar producto, lote o escanear código de barras…"><div id="il"></div>
   <p class="h"><span class="sem rojo"></span> vencido o ≤ 30 días · <span class="sem ambar"></span> 31–90 días · <span class="sem verde"></span> más de 90 días. Salen primero los lotes en rojo.</p>`;
  const ver=run(async()=>{
    const d=await api('/inventario?q='+encodeURIComponent($('#iq').value.trim())),m={ROJO:'rojo',AMARILLO:'ambar',VERDE:'verde'};
    $('#rs').innerHTML=['ROJO','AMARILLO','VERDE'].map(k=>`<button type="button" class="tarj ${m[k]}${filtro===k?' on':''}" data-f="${k}"><span class="sem ${m[k]}"></span><b>${d.resumen[k].lotes}</b> lotes<br><small>${d.resumen[k].unidades} unidades</small></button>`).join('');
    const filas=d.lotes.filter(l=>!filtro||l.semaforo===filtro);
    $('#il').innerHTML=`<div class="tw"><table><tr><th></th><th>Producto</th><th>Lote</th><th>Vence</th><th>Quedan</th><th>Existencia</th></tr>
     ${filas.map(l=>`<tr><td>${semBadge(m[l.semaforo],'')}</td><td>${esc(l.dci_principio_activo)} ${esc(l.concentracion||'')}<br><small>${esc(l.presentacion)} · ${esc(l.codigo_interno)}</small></td><td>${esc(l.numero_lote)}</td><td>${esc(String(l.fecha_vencimiento).slice(0,10))}</td>
      <td class="${l.semaforo==='ROJO'?'bad':''}">${esc(semTxt(l.fecha_vencimiento))}</td><td>${l.cantidad_actual}</td></tr>`).join('')||'<tr><td colspan="6">Sin lotes con existencia</td></tr>'}</table></div>`;
    document.querySelectorAll('#rs [data-f]').forEach(b=>b.onclick=()=>{filtro=filtro===b.dataset.f?'':b.dataset.f;ver()});
  });
  let t;$('#iq').oninput=()=>{clearTimeout(t);t=setTimeout(ver,250)};
  $('#iq').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();clearTimeout(t);ver()}};
  await ver();
}

// ---------- Comprobantes: ticket térmico (80 / 58 mm) o carta ----------
const prefFmt=()=>{try{return localStorage.ticketFmt||'ticket80'}catch{return'ticket80'}};
const prefAuto=()=>{try{return localStorage.ticketAuto==='1'}catch{return false}};
document.addEventListener('change',e=>{try{if(e.target.id==='fmt')localStorage.ticketFmt=e.target.value;if(e.target.id==='fauto')localStorage.ticketAuto=e.target.checked?'1':'0'}catch{}});
const selFormato=()=>`<label class="fmt">Formato del comprobante <select id="fmt"><option value="ticket80"${prefFmt()==='ticket80'?' selected':''}>Ticket térmico 80 mm</option><option value="ticket58"${prefFmt()==='ticket58'?' selected':''}>Ticket térmico 58 mm</option><option value="carta"${prefFmt()==='carta'?' selected':''}>Carta / A4 (acta completa)</option></select></label>`;
function ticketHTML(a,ancho){
  const w=ancho==='58'?'48mm':'72mm',f=d=>new Date(d).toLocaleString('es-VE'),total=a.items.reduce((t,i)=>t+i.cantidad,0);
  const lineas=a.items.map(i=>`<div class="it"><b>${esc(i.dci_principio_activo)} ${esc(i.concentracion||'')}</b><br>${esc(i.presentacion)}<br>Lote: ${esc(i.numero_lote)}<br>Vence: ${esc(String(i.fecha_vencimiento).slice(0,10))}<br><span class="q">Cantidad: ${i.cantidad}</span>
    ${i.nro_recipe?`<br>PACIENTE: ${esc(i.paciente_nombre)}<br>C.I. ${esc(i.paciente_cedula)}<br>Médico: ${esc(i.medico_nombre)}<br>MPPS: ${esc(i.medico_matricula_mpps)}<br>Récipe N.º ${esc(i.nro_recipe)}`:''}</div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Comprobante ${esc(a.nro_acta)}</title><style>
   @page{size:${ancho==='58'?'58mm':'80mm'} auto;margin:2mm}*{box-sizing:border-box}body{width:${w};margin:0 auto;font:11px/1.3 "Courier New",monospace;color:#000}
   h1{font-size:13px;text-align:center;margin:0 0 2px}.c{text-align:center}.it{border-top:1px dashed #000;padding:4px 0}.q{font-weight:bold}.tot{border-top:2px solid #000;margin-top:4px;padding-top:4px;font-weight:bold}
   .firma{margin-top:26px;border-top:1px solid #000;text-align:center;font-size:10px}.anu{border:2px solid #000;text-align:center;font-weight:bold;margin:4px 0;padding:2px}</style></head><body>
   <h1>${esc(CFG.institucion)}</h1><div class="c">${esc(CFG.entidad)}<br>FARMACIA · COMPROBANTE DE ENTREGA</div>${a.anulacion?'<div class="anu">*** DESPACHO ANULADO ***</div>':''}
   <p>Acta N.º: <b>${esc(a.nro_acta)}</b><br>Fecha: ${esc(f(a.fecha_hora))}<br>Destino: ${esc(a.servicio)}<br>Recibe: ${esc(a.recibe_nombre)}<br>C.I.: ${esc(a.recibe_cedula)}<br>Cargo: ${esc(a.recibe_cargo)}<br>Entrega: ${esc(a.entrega_nombre)}</p>
   ${lineas}<div class="tot">TOTAL UNIDADES: ${total}</div><div class="firma">Firma de quien recibe</div><p class="c">Conserve este comprobante.<br>${esc(CFG.sistema)}</p></body></html>`;
}
function abrirImpresion(html){const w=window.open('','_blank');if(!w){msg('Permita ventanas emergentes para imprimir',1);return}w.document.write(html);w.document.close();setTimeout(()=>{w.focus();w.print()},300)}
async function imprimirComprobante(id){
  const f=prefFmt();if(f==='carta')return imprimirActa(id);
  abrirImpresion(ticketHTML(await api('/actas/'+id),f==='ticket58'?'58':'80'));
}
function barraImpresion(id){
  $('#fin').innerHTML=`<div class="box">${selFormato()}<label class="chk"><input type="checkbox" id="fauto"${prefAuto()?' checked':''}> Imprimir automáticamente al despachar</label><button class="pri" id="pr">Imprimir comprobante</button></div>`;
  $('#pr').onclick=run(()=>imprimirComprobante(id));
  if(prefAuto())imprimirComprobante(id).catch(e=>msg(e.message,1));
}

// ---------- Consumo diario (Sala Situacional / ASIC) ----------
async function consumo(){
  const h=hoyISO();
  $('#v').innerHTML=`<h3>Consumo diario para el ASIC</h3><div class="g2">${campoHTML({id:'cd',label:'Desde',type:'date',value:h})}${campoHTML({id:'ch',label:'Hasta',type:'date',value:h})}</div>
   <div class="bt" style="justify-content:flex-start"><button class="pri" id="cb">Consultar</button><button id="cx" disabled>Exportar a Excel</button><button id="ci" disabled>Imprimir</button></div><div id="cr"></div>`;
  let datos=null;
  const cargar=run(async()=>{
    const d1=$('#cd').value,d2=$('#ch').value;if(!d1||!d2)throw new Error('Elija las fechas');if(d1>d2)throw new Error('La fecha «Desde» no puede ser posterior a «Hasta»');
    datos=await api(`/reportes/consumo-diario?desde=${d1}&hasta=${d2}`);
    const por={};datos.filas.forEach(r=>{(por[r.servicio]=por[r.servicio]||{n:0,f:[]}).f.push(r);por[r.servicio].n+=r.unidades});
    $('#cr').innerHTML=`<p class="h">Del ${esc(datos.desde)} al ${esc(datos.hasta)} · <b>${datos.total_unidades}</b> unidades despachadas (no incluye despachos anulados).</p>`+
      (Object.entries(por).map(([s,x])=>`<h4>${esc(s)} — ${x.n} unidades</h4><div class="tw"><table><tr><th>Fecha</th><th>Producto</th><th>Presentación</th><th>Unidades</th><th>Despachos</th></tr>
       ${x.f.map(r=>`<tr><td>${esc(String(r.fecha).slice(0,10))}</td><td>${esc(r.dci)} ${esc(r.concentracion||'')}</td><td>${esc(r.presentacion)}</td><td>${r.unidades}</td><td>${r.despachos}</td></tr>`).join('')}</table></div>`).join('')||'<p>Sin despachos en ese período.</p>');
    $('#cx').disabled=$('#ci').disabled=!datos.filas.length;
  });
  $('#cb').onclick=cargar;
  $('#cx').onclick=()=>{const fila=['Fecha','Servicio','Tipo','Medicamento / insumo','Concentración','Presentación','Categoría','Unidades','N.º despachos'];
    descargarBlob(crearXLSX([[`${CFG.institucion} — Consumo ${datos.desde} al ${datos.hasta}`],[],fila,...datos.filas.map(r=>[String(r.fecha).slice(0,10),r.servicio,r.tipo,r.dci,r.concentracion||'',r.presentacion,r.categoria,r.unidades,r.despachos]),[],['','','','','','','TOTAL',datos.total_unidades,'']],'Consumo',[12,30,16,34,14,16,24,10,12]),`consumo_${datos.desde}_${datos.hasta}.xlsx`)};
  $('#ci').onclick=()=>ventanaImpresion(`Consumo diario ${datos.desde} al ${datos.hasta}`,`<table><tr><th>Fecha</th><th>Servicio</th><th>Producto</th><th>Presentación</th><th>Unidades</th><th>Despachos</th></tr>
    ${datos.filas.map(r=>`<tr><td>${esc(String(r.fecha).slice(0,10))}</td><td>${esc(r.servicio)}</td><td>${esc(r.dci)} ${esc(r.concentracion||'')}</td><td>${esc(r.presentacion)}</td><td>${r.unidades}</td><td>${r.despachos}</td></tr>`).join('')}
    <tr><th colspan="4">TOTAL</th><th>${datos.total_unidades}</th><th></th></tr></table>`,true);
  await cargar();
}

document.addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('[data-ir]');if(b)mostrar(b.dataset.ir)});
// ---------- Panel: resumen del semáforo + navegación ----------
const panelPrev3=VISTAS.panel;
async function panelV3(){
  await panelPrev3();
  try{const d=await api('/inventario'),m={ROJO:['rojo','Rojo (≤ 30 días o vencido)'],AMARILLO:['ambar','Amarillo (31–90 días)'],VERDE:['verde','Verde (> 90 días)']};
    $('#v').insertAdjacentHTML('afterbegin',`<div class="tarjetas">${Object.entries(m).map(([k,[c,t]])=>`<button type="button" class="tarj ${c}" data-ir="inventario"><span class="sem ${c}"></span><b>${d.resumen[k].lotes}</b> lotes<br><small>${esc(t)}</small></button>`).join('')}</div>`)}catch{}
}
Object.assign(NOMBRES,{inventario:'Existencias',consumo:'Consumo diario',manual:'Manual'});
Object.assign(VISTAS,{panel:panelV3,inventario,consumo});

// ---------- Cierre de sesión por inactividad (15 min): evita que alguien use la sesión de otra persona ----------
(function(){const MIN=15;let h;const reiniciar=()=>{clearTimeout(h);if(!T)return;h=setTimeout(()=>{if(T){salir();msg('Sesión cerrada por 15 minutos de inactividad. Sus datos sin guardar se conservan como borrador.',1)}},MIN*60e3)};
  ['click','keydown','mousemove','touchstart'].forEach(ev=>document.addEventListener(ev,reiniciar,{passive:true}));reiniciar()})();
