'use strict';
// ===== Farmacia CDI v1.0.4: Excel nativo, recuperación de clave, anulación, cierre mensual, configuración =====
const descargarBlob=(blob,nombre)=>{const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=nombre;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),4000)};

// ---------- Excel (.xlsx) sin librerías: lectura y escritura ----------
const u16=(d,o)=>d.getUint16(o,true),u32=(d,o)=>d.getUint32(o,true);
async function inflar(bytes){return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer())}
async function leerZip(buf){
  const b=new Uint8Array(buf),d=new DataView(buf);let e=-1;
  for(let i=b.length-22;i>=Math.max(0,b.length-65557);i--)if(u32(d,i)===0x06054b50){e=i;break}
  if(e<0)throw new Error('El archivo no es un Excel (.xlsx) válido');
  const n=u16(d,e+10),out={},td=new TextDecoder();let p=u32(d,e+16);
  for(let k=0;k<n;k++){
    if(u32(d,p)!==0x02014b50)throw new Error('El archivo Excel está dañado');
    const met=u16(d,p+10),cs=u32(d,p+20),nl=u16(d,p+28),el=u16(d,p+30),cl=u16(d,p+32),lo=u32(d,p+42),nom=td.decode(b.subarray(p+46,p+46+nl));
    p+=46+nl+el+cl;
    if(!/^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(nom))continue;
    const ini=lo+30+u16(d,lo+26)+u16(d,lo+28),dat=b.subarray(ini,ini+cs);
    if(met!==0&&met!==8)throw new Error('Compresión de Excel no soportada');
    if(u32(d,p-nl-el-cl-46+24)>30e6)throw new Error('El archivo Excel es demasiado grande');
    out[nom]=td.decode(met===0?dat:await inflar(dat));
  }
  return out;
}
const desX=s=>s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(m,g)=>g[0]==='#'?String.fromCodePoint(g[1].toLowerCase()==='x'?parseInt(g.slice(2),16):+g.slice(1)):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"})[g.toLowerCase()]);
const atr=(t,n)=>{const m=t.match(new RegExp('(?:^|[\\s<])'+n+'="([^"]*)"'));return m?desX(m[1]):''};
const colN=r=>{let n=0;for(const ch of r.replace(/\d/g,''))n=n*26+ch.charCodeAt(0)-64;return n-1};
const textoT=x=>desX((x.replace(/<rPh\b[\s\S]*?<\/rPh>/g,'').match(/<t\b[^>]*>[\s\S]*?<\/t>/g)||[]).map(t=>t.replace(/<[^>]+>/g,'')).join(''));
async function leerXLSX(buf){
  const z=await leerZip(buf);let hoja='';const wb=z['xl/workbook.xml']||'',rels=z['xl/_rels/workbook.xml.rels']||'',sh=wb.match(/<sheet\b[^>]*>/);
  if(sh){const rid=atr(sh[0],'r:id');for(const t of rels.match(/<Relationship\b[^>]*>/g)||[])if(atr(t,'Id')===rid)hoja='xl/'+atr(t,'Target').replace(/^\/?(xl\/)?/,'')}
  if(!z[hoja])hoja=Object.keys(z).filter(k=>/^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
  if(!hoja)throw new Error('No se encontró ninguna hoja en el archivo');
  const ss=(z['xl/sharedStrings.xml']||'').match(/<si\b(?:[^>]*\/>|[^>]*>[\s\S]*?<\/si>)/g)?.map(si=>/\/>$/.test(si.match(/^<si\b[^>]*>/)[0])?'':textoT(si))||[];
  const filas=[];
  for(const rw of z[hoja].match(/<row\b[\s\S]*?<\/row>/g)||[]){
    const fila=[];let idx=0;
    for(const m of rw.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)){
      const a=m[1],cuerpo=m[2]||'',t=atr(a,'t'),r=atr(a,'r'),i=r?colN(r):idx;idx=i+1;let v='';
      if(t==='inlineStr')v=textoT(cuerpo);
      else{const vv=cuerpo.match(/<v>([\s\S]*?)<\/v>/);if(vv){v=desX(vv[1]);if(t==='s')v=ss[+v]??'';else if(t==='b')v=v==='1'?'VERDADERO':'FALSO'}}
      fila[i]=v;
    }
    if(fila.some(x=>S(x)))filas.push(Array.from(fila,x=>x??''));
  }
  return filas;
}
const crcT=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})();
const crc32=b=>{let c=0xffffffff;for(const x of b)c=crcT[(c^x)&255]^(c>>>8);return (c^0xffffffff)>>>0};
function zipSin(archivos){
  const te=new TextEncoder(),partes=[],cen=[];let off=0;
  for(const f of archivos){
    const nom=te.encode(f.n),crc=crc32(f.d),h=new DataView(new ArrayBuffer(30));
    h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x0800,true);h.setUint16(12,0x21,true);h.setUint32(14,crc,true);h.setUint32(18,f.d.length,true);h.setUint32(22,f.d.length,true);h.setUint16(26,nom.length,true);
    partes.push(new Uint8Array(h.buffer),nom,f.d);
    const c=new DataView(new ArrayBuffer(46));c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x0800,true);c.setUint16(14,0x21,true);
    c.setUint32(16,crc,true);c.setUint32(20,f.d.length,true);c.setUint32(24,f.d.length,true);c.setUint16(28,nom.length,true);c.setUint32(42,off,true);
    cen.push(new Uint8Array(c.buffer),nom);off+=30+nom.length+f.d.length;
  }
  const tam=cen.reduce((s,x)=>s+x.length,0),e=new DataView(new ArrayBuffer(22));
  e.setUint32(0,0x06054b50,true);e.setUint16(8,archivos.length,true);e.setUint16(10,archivos.length,true);e.setUint32(12,tam,true);e.setUint32(16,off,true);
  return new Blob([...partes,...cen,new Uint8Array(e.buffer)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
const colL=i=>{let s='';for(i++;i>0;i=Math.floor((i-1)/26))s=String.fromCharCode(65+(i-1)%26)+s;return s};
const escX=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');
function crearXLSX(filas,hoja='Hoja1',anchos=[]){
  const te=new TextEncoder(),f=(n,t)=>({n,d:te.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+t)}),NS='http://schemas.openxmlformats.org/';
  const cols=anchos.length?`<cols>${anchos.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')}</cols>`:'';
  const rows=filas.map((r,i)=>`<row r="${i+1}">${r.map((v,j)=>typeof v==='number'?`<c r="${colL(j)}${i+1}"><v>${v}</v></c>`:`<c r="${colL(j)}${i+1}" t="inlineStr"><is><t xml:space="preserve">${escX(v)}</t></is></c>`).join('')}</row>`).join('');
  return zipSin([
    f('[Content_Types].xml',`<Types xmlns="${NS}package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
    f('_rels/.rels',`<Relationships xmlns="${NS}package/2006/relationships"><Relationship Id="rId1" Type="${NS}officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    f('xl/workbook.xml',`<workbook xmlns="${NS}spreadsheetml/2006/main" xmlns:r="${NS}officeDocument/2006/relationships"><sheets><sheet name="${escX(hoja).slice(0,31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    f('xl/_rels/workbook.xml.rels',`<Relationships xmlns="${NS}package/2006/relationships"><Relationship Id="rId1" Type="${NS}officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    f('xl/worksheets/sheet1.xml',`<worksheet xmlns="${NS}spreadsheetml/2006/main">${cols}<sheetData>${rows}</sheetData></worksheet>`)]);
}

// ---------- Recuperación de clave 100 % local ----------
// Preguntas de seguridad: 3 al azar de 5, con 4 oportunidades. Si se agotan, el usuario queda bloqueado hasta que lo restablezca el Regente.
async function recuperar(usr){
  if(!USR.test(usr)){const r=await modal('Recuperar acceso',[{id:'u',label:'Usuario',ph:'Ej. mperez',max:30,regla:R.user}],{ok:'Continuar'});if(!r)return;usr=S(r.u)}
  let d;try{d=await api('/recuperar/iniciar',{method:'POST',body:{username:usr}})}catch(e){await modal('No se pudo iniciar la recuperación',[],{ok:'Entendido',cancelable:false,nota:e.message});return}
  let aviso='Responda las 3 preguntas. Tiene 4 oportunidades; si se agotan, su usuario se bloquea.',fin=null;
  for(;;){
    const r=await modal('Preguntas de seguridad',d.preguntas.map((p,i)=>({id:'r'+i,label:p.texto,ph:'Su respuesta',max:60,regla:R.txt('Escriba su respuesta',3,60)})),
      {ok:'Verificar',nota:aviso,enviar:async v=>{try{return await api('/recuperar/responder',{method:'POST',body:{reto:d.reto,respuestas:[v.r0,v.r1,v.r2]}})}
        catch(e){const x=e.datos||{};if(x.bloqueado){fin=e.message;return {}}if(x.reto){d=x;aviso=e.message;return {reintento:true}}throw e}}});
    if(!r)return;
    if(fin){await modal('Usuario bloqueado',[],{ok:'Entendido',cancelable:false,nota:fin});return}
    if(r.reintento)continue;
    if(r.resetToken){
      const n=await modal('Cree su nueva clave',camposClave('Clave nueva'),{ok:'Guardar clave',enviar:v=>api('/recuperar/clave',{method:'POST',body:{resetToken:r.resetToken,clave:v.n}})});
      if(n)msg('Clave actualizada. Ya puede iniciar sesión.');
      return;
    }
  }
}
// Clave maestra: solo para restablecer la clave del usuario principal
async function recuperarMaestra(usr){
  const r=await modal('Usuario principal: clave maestra',[...(USR.test(usr)?[]:[{id:'u',label:'Usuario principal',ph:'Ej. regente',max:30,regla:R.user}]),
    {id:'m',label:'Clave maestra',type:'password',max:128,auto:'off',regla:R.req('Escriba la clave maestra')},...camposClave('Clave nueva')],
    {ok:'Restablecer',nota:'La clave maestra solo restablece la clave del usuario principal. Tras 5 fallos se frena 15 minutos.',
     enviar:v=>api('/recuperar/maestra',{method:'POST',body:{username:USR.test(usr)?usr:S(v.u),maestra:v.m,clave:v.n}})});
  if(r)msg('Clave del usuario principal restablecida. Ya puede iniciar sesión.');
}
// ---------- Mi seguridad (5 preguntas) ----------
const normR=s=>S(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ');
async function seguridad(forzado){
  const s=await api('/mi-seguridad'),ids=[0,1,2,3,4].map(i=>'q'+i);
  const campos=[...s.preguntas.map((t,i)=>({id:'q'+i,label:t,ph:'Su respuesta',max:60,dep:ids.filter(x=>x!=='q'+i),
      regla:(v,g)=>R.txt('Escriba su respuesta',3,60)(v)||(ids.some(x=>x!=='q'+i&&normR(g(x))===normR(v))?'Debe ser distinta a las otras respuestas':'')})),
    {id:'act',label:'Su clave actual (para confirmar)',type:'password',max:128,auto:'current-password',regla:R.req('Escriba su clave actual')}];
  const ok=await modal('Preguntas de seguridad',campos,{ok:'Guardar',cancelable:!forzado,
    nota:(forzado?'Configúrelas para continuar. ':'')+'Si olvida su clave, se le preguntarán 3 de estas 5 preguntas al azar (4 oportunidades). Anote las respuestas en un lugar seguro: no se pueden recuperar.',
    enviar:v=>api('/mi-seguridad',{method:'PUT',body:{respuestas:ids.map(i=>v[i]),actual:v.act}})});
  if(ok)msg('Preguntas de seguridad guardadas.');
}
async function posLogin(r){if(r.cambiar)await cambiarClave(true);if(r.configurar)await seguridad(true)}

// ---------- Historial de despachos y anulación ----------
async function imprimirActa(id){
  const a=await api('/actas/'+id);
  ventanaImpresion('Acta de Despacho '+a.nro_acta,`${a.anulacion?`<p style="border:2px solid #b91c1c;color:#b91c1c;padding:6px"><b>DESPACHO ANULADO</b> el ${esc(new Date(a.anulacion.fecha_hora).toLocaleString('es-VE'))} por ${esc(a.anulacion.por)}.<br>Motivo: ${esc(a.anulacion.motivo)}</p>`:''}
  <p>Fecha: ${esc(new Date(a.fecha_hora).toLocaleString('es-VE'))}<br>Destino: <b>${esc(a.servicio)}</b><br>
  Recibe: ${esc(a.recibe_nombre)} (C.I. ${esc(a.recibe_cedula)}) — ${esc(a.recibe_cargo)}<br>Entrega: ${esc(a.entrega_nombre)} (C.I. ${esc(a.entrega_cedula)})</p>
  <table><tr><th>Producto</th><th>Presentación</th><th>Lote</th><th>Vence</th><th>Cant.</th></tr>
  ${a.items.map(i=>`<tr><td>${esc(i.dci_principio_activo)} ${esc(i.concentracion||'')}</td><td>${esc(i.presentacion)}</td><td>${esc(i.numero_lote)}</td><td>${esc(i.fecha_vencimiento)}</td><td>${i.cantidad}</td></tr>`).join('')}</table>
  <br><br><br><table style="border:0"><tr><td style="border:0;border-top:1px solid #000;width:45%">Entrega (Farmacia)</td><td style="border:0"></td><td style="border:0;border-top:1px solid #000;width:45%">Recibe</td></tr></table>`);
}
async function historial(){
  const C=[{id:'hd',label:'Desde',type:'date'},{id:'hh',label:'Hasta',type:'date'},{id:'hq',label:'Buscar (acta, destino o receptor)',max:60,opt:true}],esR=ROL==='FARMACEUTICO_REGENTE';
  $('#v').innerHTML=`<h3>Historial de despachos</h3><div class="g2">${C.slice(0,2).map(campoHTML).join('')}</div>${campoHTML(C[2])}${selFormato()}<br><button class="pri" id="hb">Buscar</button><div id="hr"></div>`;
  const ver=run(async()=>{
    const d1=$('#hd').value,d2=$('#hh').value;if(d1&&d2&&d1>d2)throw new Error('La fecha «Desde» no puede ser posterior a «Hasta»');
    const p=new URLSearchParams();if(d1)p.set('desde',d1);if(d2)p.set('hasta',d2);if(S($('#hq').value))p.set('q',S($('#hq').value));
    const d=await api('/actas?'+p);
    $('#hr').innerHTML=`<p class="h">${d.length} despacho(s) (máximo 200, los más recientes)</p><div class="tw"><table><tr><th>Acta</th><th>Fecha</th><th>Destino</th><th>Recibe</th><th>Uni.</th><th>Estado</th><th></th></tr>
     ${d.map(a=>`<tr><td>${esc(a.nro_acta)}</td><td>${esc(new Date(a.fecha_hora).toLocaleString('es-VE'))}</td><td>${esc(a.servicio)}</td><td>${esc(a.recibe_nombre)}</td><td>${a.unidades}</td>
      <td class="${a.anulada?'bad':'ok'}">${a.anulada?'ANULADO':'Vigente'}${a.anulada?`<br><small>${esc(a.motivo_anulacion)}</small>`:''}</td>
      <td class="ac"><button data-k="p" data-i="${esc(a.id)}">Imprimir</button>${esR&&!a.anulada?` <button data-k="a" data-i="${esc(a.id)}" data-n="${esc(a.nro_acta)}">Anular</button>`:''}</td></tr>`).join('')||'<tr><td colspan="7">Sin despachos</td></tr>'}</table></div>`;
    document.querySelectorAll('#hr [data-k]').forEach(b=>b.onclick=run(async()=>{
      if(b.dataset.k==='p')return imprimirComprobante(b.dataset.i);
      const r=await modal('Anular despacho '+b.dataset.n,[{id:'mo',label:'Motivo de la anulación',type:'area',max:500,regla:R.txt('Explique el motivo',15,500),hint:'Quedará registrado en la auditoría y en el acta.'},
        {id:'pw',label:'Su clave de Regente',type:'password',max:128,auto:'current-password',regla:R.req('Escriba su clave')}],
        {ok:'Anular despacho',nota:'Las unidades regresan al inventario (a sus mismos lotes). El acta se conserva marcada como ANULADA.',
         enviar:v=>api(`/actas/${b.dataset.i}/anular`,{method:'POST',body:{motivo:S(v.mo),password:v.pw}})});
      if(r){await ver();msg(`Despacho anulado: se reintegraron ${r.reintegrados} movimiento(s) al inventario.`)}}));
  });
  $('#hb').onclick=ver;await ver();
}

// ---------- Cierre mensual (conteo físico) ----------
async function imprimirCierre(id){
  const c=await api('/conteos/'+id),dif=c.items.filter(x=>x.cantidad_fisica!==x.cantidad_sistema);
  ventanaImpresion('Acta de cierre mensual '+c.periodo,`<p>Mes: <b>${esc(c.periodo)}</b> · Iniciado por ${esc(c.iniciado_nombre)}<br>Cerrado por ${esc(c.cerrado_nombre||'—')} ${c.cerrado_en?'el '+esc(new Date(c.cerrado_en).toLocaleString('es-VE')):''}<br>
   Lotes contados: ${c.items.length} · Con diferencia: ${dif.length}${c.observaciones?'<br>Observaciones: '+esc(c.observaciones):''}</p>
   <table><tr><th>Producto</th><th>Lote</th><th>Vence</th><th>Sistema</th><th>Físico</th><th>Dif.</th><th>Motivo</th></tr>
   ${dif.length?dif.map(x=>`<tr><td>${esc(x.dci_principio_activo)} ${esc(x.concentracion||'')}</td><td>${esc(x.numero_lote)}</td><td>${esc(x.fecha_vencimiento)}</td><td>${x.cantidad_sistema}</td><td>${x.cantidad_fisica}</td><td>${x.cantidad_fisica-x.cantidad_sistema}</td><td>${esc(x.motivo||'')}</td></tr>`).join(''):'<tr><td colspan="7">Sin diferencias: el inventario coincide con el conteo físico.</td></tr>'}</table>
   <br><br><br><table style="border:0"><tr><td style="border:0;border-top:1px solid #000;width:45%">Farmacéutico Regente</td><td style="border:0"></td><td style="border:0;border-top:1px solid #000;width:45%">Responsable del conteo</td></tr></table>`,true);
}
async function cierre(){
  const [e,h]=await Promise.all([api('/cierre/estado'),api('/conteos')]),ab=h.find(c=>c.estado==='ABIERTO'),esR=ROL==='FARMACEUTICO_REGENTE';
  if(ab&&ROL!=='INSPECTOR_ASIC')return conteoAbierto(ab.id);
  const av=e.bloqueado?['bad',`La operación está BLOQUEADA hasta cerrar el mes ${e.pendiente}.`]:e.enGracia?['warn',`Debe cerrar ${e.pendiente} antes del día ${e.diasGracia+1}; después se bloquea la operación.`]
    :!e.actualCerrado&&e.recordar?['warn',`Faltan ${e.faltan} día(s) para fin de mes: realice el conteo físico de ${e.actual}.`]:['ok','Cierres al día.'];
  const opts=[[e.previo,`${e.previo} (mes anterior)`],[e.actual,`${e.actual} (mes actual)`]].filter(o=>!h.some(c=>c.periodo===o[0]));
  $('#v').innerHTML=`<h3>Cierre mensual</h3><div class="alerts"><div class="al ${av[0]}">${esc(av[1])}</div></div>
   <p class="h">Cada mes es obligatorio contar físicamente todos los lotes y cerrar el mes. Las diferencias se ajustan en el inventario y quedan en el kardex.</p>
   ${esR&&opts.length&&!ab?`<div class="g2">${campoHTML({id:'pe',label:'Mes a contar',opts})}</div><button class="pri" id="ic">Iniciar conteo físico</button>`:''}
   <h4>Historial de cierres</h4><div class="tw"><table><tr><th>Mes</th><th>Estado</th><th>Cerrado</th><th>Por</th><th>Lotes</th><th>Diferencias</th><th></th></tr>
   ${h.map(c=>`<tr><td>${esc(c.periodo)}</td><td class="${c.estado==='CERRADO'?'ok':'bad'}">${esc(c.estado)}</td><td>${c.cerrado_en?esc(new Date(c.cerrado_en).toLocaleString('es-VE')):''}</td><td>${esc(c.cerrado_por||'')}</td><td>${c.lotes}</td><td>${c.diferencias}</td>
    <td class="ac">${c.estado==='CERRADO'?`<button data-i="${esc(c.id)}">Imprimir acta</button>`:''}</td></tr>`).join('')||'<tr><td colspan="7">Aún no hay cierres</td></tr>'}</table></div>`;
  document.querySelectorAll('#v [data-i]').forEach(b=>b.onclick=run(()=>imprimirCierre(b.dataset.i)));
  if($('#ic'))$('#ic').onclick=run(async()=>{const per=$('#pe').value;
    if(!await confirmar(`¿Iniciar el conteo de ${per}?`,'Mientras dure el conteo se suspenden los despachos, entradas y mermas, hasta cerrarlo o cancelarlo.','Sí, iniciar'))return;
    const r=await api('/conteos',{method:'POST',body:{periodo:per}});await conteoAbierto(r.id)});
}
async function conteoAbierto(id){
  const c=await api('/conteos/'+id),esR=ROL==='FARMACEUTICO_REGENTE',dirty=new Set();
  $('#v').innerHTML=`<div class="bar2"><h3>Conteo físico ${esc(c.periodo)}</h3><div><button id="hx">Hoja de conteo (Excel)</button> ${esR?'<button id="cc">Cancelar conteo</button>':''}</div></div>
   <div class="alerts"><div class="al warn">Conteo en curso: despachos, entradas y mermas están suspendidos hasta cerrarlo.</div></div>
   <input id="fq" placeholder="Filtrar por producto, código o lote…"><p class="h" id="prog"></p>
   <div class="tw"><table class="cuenta"><tr><th>Producto</th><th>Lote</th><th>Vence</th><th>Sistema</th><th>Físico</th><th>Dif.</th><th>Motivo (si hay diferencia)</th></tr>
   ${c.items.map((x,i)=>`<tr data-i="${i}" data-t="${esc((x.dci_principio_activo+' '+x.codigo_interno+' '+(x.codigo_barras||'')+' '+x.numero_lote).toLowerCase())}"><td>${esc(x.dci_principio_activo)} ${esc(x.concentracion||'')}<br><small>${esc(x.presentacion)} · ${esc(x.codigo_interno)}</small></td>
    <td>${esc(x.numero_lote)}</td><td>${esc(x.fecha_vencimiento)}</td><td>${x.cantidad_sistema}</td><td><input class="nf" inputmode="numeric" maxlength="7" value="${x.cantidad_fisica??''}" aria-label="Cantidad física"></td><td class="df"></td>
    <td><input class="mo" maxlength="300" value="${esc(x.motivo||'')}" placeholder="Motivo"></td></tr>`).join('')||'<tr><td colspan="7">No hay lotes con existencia</td></tr>'}</table></div>
   <div class="bt"><button id="gd">Guardar avance</button>${esR?'<button class="pri" id="ce">Cerrar mes</button>':''}</div>`;
  const filas=[...document.querySelectorAll('#v tr[data-i]')],fis=tr=>S(tr.querySelector('.nf').value),it=tr=>c.items[+tr.dataset.i];
  const refrescar=()=>{let n=0;filas.forEach(tr=>{const f=fis(tr),ok=/^\d+$/.test(f),d=ok?+f-it(tr).cantidad_sistema:null;if(ok)n++;
    tr.querySelector('.df').textContent=d===null?'':(d>0?'+':'')+d;tr.classList.toggle('dif',!!d);tr.querySelector('.mo').style.visibility=d?'visible':'hidden'});
    $('#prog').textContent=`Contados ${n} de ${filas.length} lotes`};
  let auto;filas.forEach(tr=>tr.addEventListener('input',()=>{dirty.add(+tr.dataset.i);refrescar();clearTimeout(auto);
    auto=setTimeout(()=>guardar().then(n=>{if(n)$('#prog').textContent+=` · guardado automático ${new Date().toLocaleTimeString('es-VE')}`}).catch(()=>{}),6000)}));refrescar();
  $('#fq').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();const v=filas.filter(tr=>tr.style.display!=='none');if(v.length===1){bip(true);const i=v[0].querySelector('.nf');i.focus();i.select()}else bip(false)}};
  $('#fq').oninput=()=>{const q=$('#fq').value.toLowerCase().trim();filas.forEach(tr=>tr.style.display=tr.dataset.t.includes(q)?'':'none')};
  const guardar=async()=>{const out=[];
    for(const tr of filas){if(!dirty.has(+tr.dataset.i))continue;const f=fis(tr);
      if(f!==''&&!/^\d{1,7}$/.test(f)){tr.querySelector('.nf').focus();throw new Error('La cantidad física debe ser un número entero (0 o más)')}
      out.push({lote_id:it(tr).lote_id,cantidad_fisica:f,motivo:S(tr.querySelector('.mo').value)})}
    for(let k=0;k<out.length;k+=500)await api(`/conteos/${id}/items`,{method:'PUT',body:{items:out.slice(k,k+500)}});dirty.clear();return out.length};
  $('#gd').onclick=run(async()=>{const n=await guardar();msg(n?'Avance guardado.':'No hay cambios por guardar.')});
  $('#hx').onclick=()=>descargarBlob(crearXLSX([['Código','Producto','Presentación','Lote','Vence','Cantidad física'],...c.items.map(x=>[x.codigo_interno,`${x.dci_principio_activo} ${x.concentracion||''}`.trim(),x.presentacion,x.numero_lote,x.fecha_vencimiento,''])],'Conteo',[14,40,18,16,12,14]),`hoja_conteo_${c.periodo}.xlsx`);
  if(esR){
    $('#cc').onclick=run(async()=>{if(!await confirmar('¿Cancelar el conteo?','Se descartan los datos contados y se reanuda la operación.','Sí, cancelar'))return;
      await api('/conteos/'+id,{method:'DELETE'});msg('Conteo cancelado.');await cierre()});
    $('#ce').onclick=run(async()=>{await guardar();
      const falt=filas.filter(tr=>fis(tr)==='');if(falt.length){falt[0].scrollIntoView({block:'center'});falt[0].querySelector('.nf').focus();throw new Error(`Faltan ${falt.length} lote(s) por contar`)}
      for(const tr of filas){const d=+fis(tr)-it(tr).cantidad_sistema,mo=tr.querySelector('.mo');if(d&&S(mo.value).length<10){mo.scrollIntoView({block:'center'});mo.focus();throw new Error('Toda diferencia necesita un motivo de al menos 10 caracteres')}}
      const nd=filas.filter(tr=>+fis(tr)!==it(tr).cantidad_sistema).length;
      const r=await modal('Cerrar el mes '+c.periodo,[{id:'ob',label:'Observaciones',type:'area',max:500,opt:true},{id:'pw',label:'Su clave de Regente',type:'password',max:128,auto:'current-password',regla:R.req('Escriba su clave')}],
        {ok:'Cerrar mes',nota:`Se ajustarán ${nd} lote(s) con diferencia en el inventario. Esta acción no se puede deshacer.`,
         enviar:v=>api(`/conteos/${id}/cerrar`,{method:'POST',body:{password:v.pw,observaciones:S(v.ob)}})});
      if(r){msg(`Mes ${c.periodo} cerrado. Ajustes: ${r.ajustes} (sobrantes ${r.sobrantes}, faltantes ${r.faltantes}).`);await imprimirCierre(id);await cierre()}});
  }
}

// ---------- Alertas extra en el panel + navegación ----------
const panelPrev=VISTAS.panel;
async function panelV2(){
  await panelPrev();const a=[];
  try{const e=await api('/cierre/estado');
    if(e.abierto)a.push(['warn',`Conteo físico ${e.abierto} en curso: la operación está suspendida hasta cerrarlo.`]);
    else if(e.bloqueado)a.push(['bad',`Operación BLOQUEADA: falta el conteo físico y cierre de ${e.pendiente} (menú Cierre mensual).`]);
    else if(e.enGracia)a.push(['warn',`Falta el cierre de ${e.pendiente}: tiene hasta el día ${e.diasGracia} del mes.`]);
    else if(e.recordar&&!e.actualCerrado)a.push(['warn',`Faltan ${e.faltan} día(s) para fin de mes: prepare el conteo físico de ${e.actual}.`]);
  }catch{}
  if(a.length){let box=document.querySelector('#v .alerts');if(!box){$('#v').insertAdjacentHTML('afterbegin','<div class="alerts"></div>');box=document.querySelector('#v .alerts')}
    box.insertAdjacentHTML('beforeend',a.map(x=>`<div class="al ${x[0]}">⚠ ${esc(x[1])}</div>`).join(''))}
}
Object.assign(NOMBRES,{historial:'Despachos',cierre:'Cierre mensual'});
Object.assign(VISTAS,{panel:panelV2,historial,cierre});
