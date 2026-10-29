'use strict';
// ===== Farmacia CDI v1.0.3: formularios validados + usuarios, catálogo, importación, auditoría =====
const hoyISO=()=>new Date().toISOString().slice(0,10);
const cedN=v=>String(v).toUpperCase().replace(/[\s.\-]/g,'');
const NOM=/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ .'\-]+$/, MATR=/^[A-Za-z0-9.\-\/ ]{3,30}$/, USR=/^[A-Za-z0-9_.-]{3,30}$/;
const S=v=>String(v??'').trim();
const R={
  req:t=>v=>S(v)?'':t,
  txt:(t,min,max)=>v=>{v=S(v);return !v?t:v.length<min?`Mínimo ${min} caracteres`:v.length>max?`Máximo ${max} caracteres`:''},
  opt:(rx,t)=>v=>!S(v)||rx.test(S(v))?'':t,
  ced:v=>!S(v)?'La cédula es obligatoria':/^[VE]\d{6,9}$/.test(cedN(v))?'':'V o E y de 6 a 9 números (ej. V12345678)',
  nom:(t='El nombre es obligatorio')=>v=>{v=S(v).replace(/\s+/g,' ');return !v?t:!NOM.test(v)?'Solo letras y espacios':!/\s/.test(v)?'Escriba nombre y apellido':''},
  user:v=>!S(v)?'Escriba el usuario':USR.test(S(v))?'':'3 a 30 caracteres: letras, números, punto, guion o guion bajo',
  clave:v=>v.length<10?'Mínimo 10 caracteres':!/[a-z]/.test(v)?'Agregue una minúscula':!/[A-Z]/.test(v)?'Agregue una mayúscula':!/\d/.test(v)?'Agregue un número':v.length>128?'Máximo 128':'',
  ent:(min,max,t='La cantidad')=>v=>{v=S(v);return !v?`${t} es obligatoria`:!/^\d+$/.test(v)?'Solo números enteros':+v<min||+v>max?`Debe estar entre ${min} y ${max}`:''},
  venc:v=>!v?'Indique el vencimiento':v<hoyISO()?'El lote ya está vencido':v>'2100-01-01'?'Fecha no válida':'',
  lote:v=>/^[A-Za-z0-9._\/-]{1,60}$/.test(S(v))?'':'1 a 60 caracteres: letras, números, punto, guion o barra'
};
// ---- campos ----
function campoHTML(c){
  const a=`id="${c.id}" ${c.max?`maxlength="${c.max}"`:''} ${c.ph?`placeholder="${esc(c.ph)}"`:''} autocomplete="${c.auto||'off'}"`;let el;
  if(c.opts)el=`<select ${a}>${c.opts.map(o=>`<option value="${esc(o[0])}"${o[0]===c.value?' selected':''}>${esc(o[1])}</option>`).join('')}</select>`;
  else if(c.type==='check')return `<div class="fld"><label class="chk"><input type="checkbox" id="${c.id}"${c.value?' checked':''}> ${esc(c.label)}</label></div>`;
  else if(c.type==='area')el=`<textarea ${a} rows="3">${esc(c.value||'')}</textarea>`;
  else el=`<input ${a}${c.lista?` list="dl_${c.id}"`:''} type="${c.type||'text'}" value="${esc(c.value??'')}"${c.min!=null?` min="${c.min}"`:''}>${c.lista?`<datalist id="dl_${c.id}">${c.lista.map(x=>`<option value="${esc(x)}">`).join('')}</datalist>`:''}`;
  return `<div class="fld"><label for="${c.id}">${esc(c.label)}${c.opt?' <small>(opcional)</small>':''}</label>${el}<span class="err"></span>${c.hint?`<span class="h">${esc(c.hint)}</span>`:''}</div>`;
}
function enlazar(root,campos){
  const el=id=>root.querySelector('#'+id), get=id=>el(id).type==='checkbox'?el(id).checked:el(id).value;
  const chk=c=>{const e=el(c.id),m=c.regla?c.regla(e.value,get):'';e.closest('.fld').querySelector('.err').textContent=m;
    e.setAttribute('aria-invalid',m?'true':'false');e.classList.toggle('v',!m&&!!S(e.value));return !m};
  const deps=c=>(c.dep||[]).forEach(d=>{const x=campos.find(k=>k.id===d);if(x&&el(d).getAttribute('aria-invalid')==='true')chk(x)});
  campos.filter(c=>c.regla).forEach(c=>{const e=el(c.id);e.addEventListener('blur',()=>chk(c));
    e.addEventListener('input',()=>{if(c.norm)e.value=c.norm(e.value);if(e.getAttribute('aria-invalid')==='true')chk(c);deps(c)});
    if(e.tagName==='SELECT')e.addEventListener('change',()=>{chk(c);deps(c)})});
  return ()=>{const r=campos.filter(c=>c.regla).map(c=>[c,chk(c)]),mal=r.find(x=>!x[1]);
    if(mal){el(mal[0].id).focus();return null}return Object.fromEntries(campos.map(c=>[c.id,get(c.id)]))};
}
function modal(titulo,campos,{ok='Aceptar',nota='',cancelable=true,enviar,extra=[]}={}){
  return new Promise(res=>{
    const d=document.createElement('dialog');d.className='card md';
    d.innerHTML=`<form novalidate><h3>${esc(titulo)}</h3>${nota?`<p class="sub">${esc(nota)}</p>`:''}${campos.map(campoHTML).join('')}
      <div class="alert" role="alert"></div><div class="bt">${extra.map((x,i)=>`<button type="button" class="ex" data-i="${i}">${esc(x.t)}</button>`).join('')}${cancelable?'<button type="button" class="x">Cancelar</button>':''}<button class="pri" type="submit">${esc(ok)}</button></div></form>`;
    document.body.append(d);const f=d.querySelector('form'),val=enlazar(f,campos),fin=v=>{d.close();d.remove();res(v)};
    f.onsubmit=async e=>{e.preventDefault();const v=val();if(!v)return;if(!enviar)return fin(v);
      const b=f.querySelector('.pri'),al=f.querySelector('.alert');al.classList.remove('on');b.disabled=true;
      try{fin((await enviar(v))??true)}catch(er){al.textContent=er.message;al.classList.add('on');b.disabled=false}};
    d.querySelectorAll('.ex').forEach(b=>b.onclick=()=>extra[+b.dataset.i].fn(f,f.querySelector('.alert')));
    const x=d.querySelector('.x');if(x)x.onclick=()=>fin(null);
    d.addEventListener('cancel',e=>{e.preventDefault();if(cancelable)fin(null)});d.showModal();
  });
}
const confirmar=(t,n,ok='Sí, continuar')=>modal(t,[],{ok,nota:n});

// ---- selector con lector de código de barras (Enter selecciona directo) ----
picker=function(host,onPick,ruta,lab){
  host.innerHTML='<input placeholder="Buscar por nombre o escanear código de barras…" autocomplete="off"><div class="res"></div>';
  const i=host.querySelector('input'),r=host.querySelector('.res');let t,n=0;
  const buscar=async auto=>{const k=++n,q=i.value.trim();try{const d=await api(ruta+encodeURIComponent(q));if(k!==n)return;r.innerHTML='';
    const ex=d.find(x=>q&&[x.codigo_barras,x.codigo_interno].includes(q));
    if(auto&&(ex||d.length===1)){const x=ex||d[0];bip(true);onPick(x);i.value=lab(x);return}
    if(!d.length&&q){r.innerHTML='<div class="h">Sin resultados</div>';if(auto)bip(false)}
    d.forEach(x=>{const b=document.createElement('button');b.type='button';b.className='row';b.textContent=lab(x);b.onclick=()=>{onPick(x);r.innerHTML='';i.value=lab(x)};r.append(b)})}
    catch(e){msg(e.message,1)}};
  i.oninput=()=>{clearTimeout(t);t=setTimeout(()=>buscar(false),250)};
  i.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();clearTimeout(t);buscar(true)}};
};

// ---- navegación por rol ----
const NOMBRES={panel:'Panel',despacho:'Despacho',entrada:'Entrada',merma:'Merma',catalogo:'Catálogo',importar:'Importar',usuarios:'Usuarios',auditoria:'Auditoría',reportes:'Reportes'};
const ROLN={FARMACEUTICO_REGENTE:'Farmacéutico Regente',ALMACENISTA:'Almacenista',INSPECTOR_ASIC:'Inspector ASIC'};
const tabsDe=r=>r==='INSPECTOR_ASIC'?['panel','historial','inventario','consumo','cierre','auditoria','reportes','manual']
  :r==='ALMACENISTA'?['panel','despacho','historial','entrada','merma','inventario','importar','cierre','consumo','reportes','manual']
  :['panel','despacho','historial','entrada','merma','inventario','catalogo','importar','cierre','usuarios','consumo','auditoria','reportes','manual'];

// ---- despacho ----
async function despachoV(){
  const [sv,rec]=await Promise.all([api('/servicios'),api('/receptores').catch(()=>[])]);items=[];
  const C=[{id:'sv',label:'Destino',opts:sv.map(s=>[s.id,`${s.nombre} (${s.tipo==='INTERNO_CDI'?'CDI':'Consultorio Popular'})`])},
   {id:'rc',label:'Cédula de quien recibe',ph:'V12345678',max:13,regla:R.ced,norm:v=>v.toUpperCase()},
   {id:'rn',label:'Nombre de quien recibe',max:150,regla:R.nom()},{id:'rg',label:'Rol / Cargo',max:80,regla:R.txt('El cargo es obligatorio',3,80)}];
  C[1].lista=rec.map(r=>r.recibe_cedula);
  $('#v').innerHTML=`<h3>Nuevo despacho</h3>${campoHTML(C[0])}<div class="g2">${campoHTML(C[1])}${campoHTML(C[2])}</div>${campoHTML(C[3])}
   <div class="fld"><label>Producto <small>(escriba o escanee el código de barras)</small></label><div id="pk"></div></div><div id="it"></div>
   <button class="pri" id="go">Despachar</button><div id="fin"></div>`;
  const val=enlazar($('#v'),C);
  Borr.enlazar('despacho',$('#v'),{extra:()=>({items}),aplicar:x=>{if(Array.isArray(x.items)){items=x.items;pintar()}}});
  $('#rc').addEventListener('change',()=>{const r=rec.find(x=>cedN(x.recibe_cedula)===cedN($('#rc').value));if(r){if(!S($('#rn').value))$('#rn').value=r.recibe_nombre;if(!S($('#rg').value))$('#rg').value=r.recibe_cargo}});
  picker($('#pk'),p=>run(async()=>{
    if(!(p.stock>0))throw new Error('Sin stock disponible de '+p.dci_principio_activo);
    const q=await modal(`${p.dci_principio_activo} ${p.concentracion||''}`,[{id:'q',label:`Cantidad (disponible: ${p.stock})`,max:7,auto:'off',
      regla:v=>!/^\d+$/.test(S(v))?'Escriba un número entero':+v<1?'Debe ser mayor a cero':+v>p.stock?`Solo hay ${p.stock} disponibles`:''}],{ok:'Agregar'});
    if(!q)return;const cant=+q.q,fefo=await api(`/fefo/${p.id}?cantidad=${cant}`);
    const it={producto_id:p.id,cantidad:cant,label:`${p.dci_principio_activo} ${p.concentracion||''}`,fefo};
    if(CONTROLADOS.includes(p.tipo_control)){
      const c=await modal('Medicamento controlado: datos del récipe',[
        {id:'paciente_cedula',label:'Cédula del paciente',max:13,regla:R.ced,norm:v=>v.toUpperCase()},
        {id:'paciente_nombre',label:'Nombre del paciente',max:150,regla:R.nom('El nombre del paciente es obligatorio')},
        {id:'medico_nombre',label:'Médico prescriptor',max:150,regla:R.nom('El nombre del médico es obligatorio')},
        {id:'medico_matricula_mpps',label:'Matrícula MPPS del médico',max:30,regla:v=>MATR.test(S(v))?'':'3 a 30 caracteres: letras, números, punto, guion o barra'},
        {id:'colegio_medicos_nro',label:'N.º Colegio de Médicos',max:30,opt:true},
        {id:'nro_recipe',label:'N.º de récipe / orden médica',max:30,regla:R.txt('El número de récipe es obligatorio',3,30)}],{ok:'Agregar'});
      if(!c)return;Object.keys(c).forEach(k=>it[k]=S(c[k]));it.paciente_cedula=cedN(it.paciente_cedula);
    }
    items.push(it);pintar();const pi=$('#pk input');pi.value='';pi.focus();
  })(),'/productos?q=',labProd);
  $('#go').onclick=run(async()=>{
    const v=val();if(!v)return;if(!items.length)throw new Error('Agregue al menos un producto al despacho');
    const r=await api('/despachos',{method:'POST',body:{servicio_id:v.sv,recibe_cedula:cedN(v.rc),recibe_nombre:S(v.rn),recibe_cargo:S(v.rg),
      items:items.map(({label,fefo,...x})=>x)}});
    Borr.limpiar('despacho');msg('Despacho registrado.');items=[];pintar();barraImpresion(r.acta_id);
  });
  pintar();
}
// ---- entrada ----
async function entradaV(){
  const pv=await api('/proveedores');let prod=null;
  const C=[{id:'lo',label:'Lote del fabricante',max:60,regla:R.lote},{id:'fv',label:'Vencimiento',type:'date',min:hoyISO(),regla:R.venc},
    {id:'ca',label:'Cantidad recibida',max:7,regla:R.ent(1,1e6,'La cantidad')},{id:'dc',label:'Factura / Guía de despacho',max:60,opt:true},
    {id:'pr',label:'Origen',opts:pv.map(p=>[p.id,p.nombre])}];
  $('#v').innerHTML=`<h3>Recepción de mercancía</h3><div class="fld"><label>Producto <small>(escriba o escanee el código de barras)</small></label><div id="pk"></div><span class="err" id="ep"></span></div>
   <p id="sel"><i>Seleccione un producto</i></p><div class="g2">${C.slice(0,4).map(campoHTML).join('')}</div>${campoHTML(C[4])}<button class="pri" id="go">Registrar entrada</button>`;
  const val=enlazar($('#v'),C);
  picker($('#pk'),p=>{prod=p;$('#ep').textContent='';$('#sel').textContent='Producto: '+labProd(p);$('#v').dispatchEvent(new Event('input'))},'/productos?q=',labProd);
  Borr.enlazar('entrada',$('#v'),{extra:()=>({prod}),aplicar:x=>{if(x.prod){prod=x.prod;$('#sel').textContent='Producto: '+labProd(prod)}}});
  $('#go').onclick=run(async()=>{
    const v=val();if(!prod){$('#ep').textContent='Seleccione un producto';$('#pk input').focus();return}if(!v)return;
    await api('/entradas',{method:'POST',body:{producto_id:prod.id,numero_lote:S(v.lo),fecha_vencimiento:v.fv,cantidad:S(v.ca),proveedor_id:v.pr||null,documento:S(v.dc)}});
    Borr.limpiar('entrada');await entradaV();msg('Entrada registrada.');
  });
}
// ---- merma ----
async function mermaV(){
  let lote=null;
  const C=[{id:'ca',label:'Cantidad',max:7,regla:v=>{const m=R.ent(1,1e6)(v);return m||(lote&&+v>lote.cantidad_actual?`El lote solo tiene ${lote.cantidad_actual} unidades`:'')}},
   {id:'mo',label:'Motivo',opts:[['ROTURA','Rotura'],['VENCIMIENTO','Vencimiento'],['CONTAMINACION','Contaminación'],['CADENA_FRIO_ROTA','Cadena de frío rota'],['OTRO','Otro']]},
   {id:'de',label:'Descripción de lo ocurrido',type:'area',max:500,regla:R.txt('Describa lo ocurrido',10,500)},
   {id:'au',label:'Usuario del Regente',max:30,regla:R.user},{id:'ap',label:'Clave del Regente',type:'password',max:128,regla:R.req('Falta la clave del Regente'),auto:'off'}];
  $('#v').innerHTML=`<h3>Merma / Desincorporación</h3><div class="fld"><label>Lote afectado</label><div id="pk"></div><span class="err" id="ep"></span></div><p id="sel"><i>Seleccione el lote afectado</i></p>
   <div class="g2">${campoHTML(C[0])}${campoHTML(C[1])}</div>${campoHTML(C[2])}<div class="box"><b>Autorización del Farmacéutico Regente</b><div class="g2">${campoHTML(C[3])}${campoHTML(C[4])}</div></div>
   <button class="pri" id="go">Registrar merma</button>`;
  const val=enlazar($('#v'),C);
  picker($('#pk'),l=>{lote=l;$('#ep').textContent='';$('#sel').textContent='Lote: '+labLote(l);$('#v').dispatchEvent(new Event('input'))},'/lotes?q=',labLote);
  Borr.enlazar('merma',$('#v'),{extra:()=>({lote}),aplicar:x=>{if(x.lote){lote=x.lote;$('#sel').textContent='Lote: '+labLote(lote)}}});
  $('#go').onclick=run(async()=>{
    if(!lote){$('#ep').textContent='Seleccione el lote afectado';$('#pk input').focus();return}const v=val();if(!v)return;
    await api('/mermas',{method:'POST',body:{lote_id:lote.id,cantidad:S(v.ca),motivo:v.mo,descripcion:S(v.de),autoriza_username:S(v.au),autoriza_password:v.ap}});
    Borr.limpiar('merma');await mermaV();msg('Merma registrada. Acta de desincorporación generada.');
  });
}

// ---- mi clave ----
async function cambiarClave(obligatorio){
  const ok=await modal('Cambiar mi clave',[{id:'a',label:'Clave actual',type:'password',max:128,regla:R.req('Escriba su clave actual'),auto:'current-password'},
    {id:'n',label:'Clave nueva',type:'password',max:128,regla:R.clave,auto:'new-password',dep:['r'],hint:'Mínimo 10 caracteres con mayúscula, minúscula y número'},
    {id:'r',label:'Repita la clave nueva',type:'password',max:128,auto:'new-password',regla:(v,g)=>v!==g('n')?'Las claves no coinciden':''}],
    {ok:'Guardar clave',cancelable:!obligatorio,nota:obligatorio?'Su clave es temporal: debe cambiarla para continuar.':'',
     enviar:v=>api('/mi-clave',{method:'POST',body:{actual:v.a,nueva:v.n}})});
  if(ok){if(ok.token)T=sessionStorage.t=ok.token;msg('Clave actualizada.')}
}
// ---- usuarios ----
const camposClave=(t='Clave')=>[{id:'n',label:t,type:'password',max:128,regla:R.clave,auto:'new-password',dep:['r'],hint:'Mínimo 10 caracteres con mayúscula, minúscula y número'},
  {id:'r',label:'Repita la clave',type:'password',max:128,auto:'new-password',regla:(v,g)=>v!==g('n')?'Las claves no coinciden':''}];
async function usuarios(){
  const us=await api('/usuarios');
  const est=u=>u.bloqueado?['bad','Bloqueado']:u.bloqueo_temporal?['bad','Bloqueo temporal']:u.activo?['ok','Activo']:['bad','Inactivo'];
  $('#v').innerHTML=`<div class="bar2"><h3>Usuarios del sistema</h3><button class="pri" id="nu">+ Nuevo usuario</button></div><div class="tw"><table><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Estado</th><th></th></tr>
   ${us.map(u=>`<tr><td>${esc(u.username)}${u.es_principal?'<br><small>Usuario principal</small>':''}</td><td>${esc(u.nombre_completo)}<br><small>${esc(u.cedula)}</small></td><td>${esc(ROLN[u.rol])}</td>
   <td class="${est(u)[0]}">${est(u)[1]}${u.debe_cambiar_clave?'<br><small>Debe cambiar su clave</small>':''}${u.recuperacion_configurada?'':'<br><small>Sin preguntas de seguridad</small>'}</td>
   <td class="ac"><button data-k="cl" data-i="${esc(u.id)}" data-n="${esc(u.username)}">Restablecer clave</button>
   ${u.es_principal?'':`<button data-k="ac" data-i="${esc(u.id)}" data-n="${esc(u.username)}" data-a="${u.activo?0:1}">${u.activo?'Desactivar':'Activar'}</button>`}</td></tr>`).join('')}</table></div>`;
  $('#nu').onclick=async()=>{
    const r=await modal('Nuevo usuario',[{id:'nombre_completo',label:'Nombre completo',ph:'Ej. María Pérez',max:150,regla:R.nom()},{id:'cedula',label:'Cédula',ph:'Ej. V-12345678',max:13,regla:R.ced,norm:v=>v.toUpperCase()},
      {id:'cargo',label:'Cargo',ph:'Ej. Auxiliar de farmacia',max:80,opt:true},{id:'matricula_mpps',label:'Matrícula MPPS',ph:'Ej. MPPS-12345',max:30,opt:true,regla:R.opt(MATR,'3 a 30 caracteres: letras, números, punto, guion o barra')},
      {id:'rol',label:'Rol',opts:Object.entries(ROLN)},{id:'username',label:'Usuario',ph:'Ej. mperez',max:30,regla:R.user,hint:'Letras y números, sin espacios'}],
      {ok:'Crear usuario',nota:'Se le asignará la clave temporal del sistema (consúltela con su responsable). En su primer inicio de sesión estará obligado a cambiarla.',
      enviar:v=>api('/usuarios',{method:'POST',body:{nombre_completo:S(v.nombre_completo).replace(/\s+/g,' '),cedula:cedN(v.cedula),cargo:S(v.cargo),matricula_mpps:S(v.matricula_mpps),rol:v.rol,username:S(v.username)}})});
    if(r){await usuarios();msg('Usuario creado con la clave temporal del sistema.')}};
  document.querySelectorAll('#v [data-k]').forEach(b=>b.onclick=run(async()=>{
    const id=b.dataset.i;
    if(b.dataset.k==='cl'){if(!await confirmar('Restablecer la clave de '+b.dataset.n,'Se le asignará la clave temporal del sistema, se desbloqueará su cuenta y deberá cambiarla al entrar.','Sí, restablecer'))return;
      await api(`/usuarios/${id}/clave`,{method:'POST',body:{}});await usuarios();msg('Clave restablecida a la temporal del sistema.')}
    else{const act=b.dataset.a==='1';if(!await confirmar(`${act?'Activar':'Desactivar'} a ${b.dataset.n}`,act?'Podrá volver a entrar al sistema.':'Ya no podrá entrar al sistema. Su historial se conserva.'))return;
      await api('/usuarios/'+id,{method:'PATCH',body:{activo:act}});await usuarios();msg('Listo.')}
  }));
}
// ---- catálogo ----
const CATO=[['MEDICAMENTO','Medicamento'],['MATERIAL_MEDICO_QUIRURGICO','Material médico-quirúrgico'],['SOLUCION','Solución'],['REACTIVO','Reactivo']];
const CTRLO=[['LIBRE','Libre'],['RECETA','Con récipe'],['CONTROLADO_PSICOTROPICO','Controlado psicotrópico'],['ESTUPEFACIENTE','Estupefaciente']];
async function formProducto(p){
  const e=!!p;p=p||{};
  const r=await modal(e?'Editar producto':'Nuevo producto',[
    {id:'codigo_barras',label:'Código de barras',max:50,opt:true,value:p.codigo_barras,regla:R.opt(/^[A-Za-z0-9-]{4,50}$/,'4 a 50 letras, números o guion')},
    {id:'dci_principio_activo',label:'DCI / principio activo',max:200,value:p.dci_principio_activo,regla:R.txt('Obligatorio',3,200)},
    {id:'nombre_comercial',label:'Nombre comercial',max:200,opt:true,value:p.nombre_comercial},
    {id:'presentacion',label:'Presentación (tableta, ampolla, frasco…)',max:100,value:p.presentacion,regla:R.req('La presentación es obligatoria')},
    {id:'concentracion',label:'Concentración',max:60,opt:true,value:p.concentracion},
    {id:'categoria',label:'Categoría',opts:CATO,value:p.categoria,dep:['registro_sanitario_inhrr'],regla:R.req('Elija la categoría')},
    {id:'registro_sanitario_inhrr',label:'Registro Sanitario INHRR',max:40,value:p.registro_sanitario_inhrr,regla:(v,g)=>g('categoria')==='MEDICAMENTO'&&!S(v)?'Obligatorio para medicamentos':''},
    {id:'tipo_control',label:'Control',opts:CTRLO,value:p.tipo_control||'LIBRE'},
    {id:'temperatura',label:'Almacenamiento',opts:[['AMBIENTE','Ambiente'],['CADENA_FRIO_2_8C','Cadena de frío 2–8 °C']],value:p.temperatura||'AMBIENTE'},
    {id:'stock_minimo',label:'Stock mínimo',max:7,value:p.stock_minimo??0,dep:['stock_maximo'],regla:R.ent(0,1e7,'El stock mínimo')},
    {id:'stock_maximo',label:'Stock máximo',max:7,value:p.stock_maximo??0,regla:(v,g)=>R.ent(0,1e7,'El stock máximo')(v)||(+v<+g('stock_minimo')?'No puede ser menor que el mínimo':'')},
    ...(e?[{id:'activo',label:'Producto activo',type:'check',value:p.activo}]:[])],
    {ok:'Guardar',enviar:v=>api(e?'/productos/'+p.id:'/productos',{method:e?'PUT':'POST',body:{...v,stock_minimo:+v.stock_minimo,stock_maximo:+v.stock_maximo}})});
  return r;
}
async function catalogo(){
  $('#v').innerHTML=`<div class="bar2"><h3>Catálogo de productos</h3><div><button id="im">Importar desde Excel</button> <button class="pri" id="np">+ Nuevo producto</button></div></div>
   <input id="bq" placeholder="Buscar por nombre, código de barras o código interno…"><div id="lst"></div>`;
  const cargar=run(async()=>{const d=await api('/catalogo?q='+encodeURIComponent($('#bq').value.trim()));
    $('#lst').innerHTML=`<div class="tw"><table><tr><th>Código</th><th>Producto</th><th>Presentación</th><th>Control</th><th>Mín / Máx</th><th>Estado</th><th></th></tr>
     ${d.length?d.map((p,i)=>`<tr><td>${esc(p.codigo_interno)}<br><small>${esc(p.codigo_barras||'')}</small></td><td>${esc(p.dci_principio_activo)} ${esc(p.concentracion||'')}<br><small>${esc(p.nombre_comercial||'')}</small></td>
     <td>${esc(p.presentacion)}</td><td>${esc((CTRLO.find(c=>c[0]===p.tipo_control)||[])[1]||'')}</td><td>${p.stock_minimo} / ${p.stock_maximo}</td><td class="${p.activo?'ok':'bad'}">${p.activo?'Activo':'Inactivo'}</td>
     <td class="ac"><button data-i="${i}">Editar</button></td></tr>`).join(''):'<tr><td colspan="7">Sin productos</td></tr>'}</table></div>`;
    document.querySelectorAll('#lst [data-i]').forEach(b=>b.onclick=run(async()=>{if(await formProducto(d[+b.dataset.i])){await cargar();msg('Producto actualizado.')}}));});
  let t;$('#bq').oninput=()=>{clearTimeout(t);t=setTimeout(cargar,250)};
  $('#np').onclick=run(async()=>{if(await formProducto()){await cargar();msg('Producto creado.')}});
  $('#im').onclick=()=>mostrar('importar');
  await cargar();
}
// ---- importación CSV (Excel → Guardar como CSV) ----
function parseCSV(txt){
  txt=txt.replace(/^\ufeff/,'');const l=txt.split(/\r?\n/)[0]||'',sep=(l.match(/;/g)||[]).length>=(l.match(/,/g)||[]).length?';':',',rows=[];let r=[],c='',q=false;
  const fin=()=>{r.push(c);c='';if(r.some(x=>x.trim()))rows.push(r);r=[]};
  for(let i=0;i<txt.length;i++){const ch=txt[i];
    if(q){if(ch==='"'){if(txt[i+1]==='"'){c+='"';i++}else q=false}else c+=ch}
    else if(ch==='"')q=true;else if(ch===sep){r.push(c);c=''}else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&txt[i+1]==='\n')i++;fin()}else c+=ch}
  fin();return rows;
}
const normK=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
function aObjetos(txt,alias){return aObjetosT(parseCSV(txt),alias)}
function aObjetosT(t,alias){if(t.length<2)throw new Error('El archivo no tiene filas de datos');
  const h=t[0].map(x=>alias[normK(x)]||normK(x));return t.slice(1).map(f=>Object.fromEntries(h.map((k,i)=>[k,S(f[i])])))}
function fechaISO(v){v=S(v);let m;if(/^\d{4}-\d{2}-\d{2}$/.test(v))return v;
  if(m=v.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/))return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  if(/^\d{5}$/.test(v))return new Date((+v-25569)*864e5).toISOString().slice(0,10);return v}
const IMP={
  productos:{t:'Catálogo de productos',ruta:'/productos/importar',roles:['FARMACEUTICO_REGENTE'],
    alias:{dci:'dci_principio_activo',principio_activo:'dci_principio_activo',nombre:'dci_principio_activo',registro_sanitario:'registro_sanitario_inhrr',registro:'registro_sanitario_inhrr',control:'tipo_control',codigo:'codigo_barras',minimo:'stock_minimo',maximo:'stock_maximo'},
    cab:'codigo_barras;dci_principio_activo;nombre_comercial;presentacion;concentracion;categoria;registro_sanitario_inhrr;tipo_control;temperatura;stock_minimo;stock_maximo',
    ej:'7591234567890;Acetaminofén;Tempra;Tableta;500 mg;MEDICAMENTO;E.F. 12345;LIBRE;AMBIENTE;100;500',
    ayuda:'categoria: MEDICAMENTO, MATERIAL_MEDICO_QUIRURGICO, SOLUCION o REACTIVO · tipo_control: LIBRE, RECETA, CONTROLADO_PSICOTROPICO o ESTUPEFACIENTE · temperatura: AMBIENTE o CADENA_FRIO_2_8C'},
  inventario:{t:'Inventario inicial (lotes)',ruta:'/entradas/importar',roles:['FARMACEUTICO_REGENTE','ALMACENISTA'],
    alias:{codigo_de_barras:'codigo',codigo_interno:'codigo',numero_lote:'lote',fecha_vencimiento:'vencimiento',vence:'vencimiento',factura:'documento',guia:'documento'},
    cab:'codigo;lote;vencimiento;cantidad;documento',ej:'7591234567890;LT-2025-01;2027-06-30;250;CARGA INICIAL',
    ayuda:'codigo: código de barras o código interno (INT-000001) · vencimiento: AAAA-MM-DD o DD/MM/AAAA · el producto debe existir en el catálogo'}
};
function importar(){
  const tipos=Object.entries(IMP).filter(([,x])=>x.roles.includes(ROL));
  $('#v').innerHTML=`<h3>Importar desde Excel</h3><p class="sub" style="text-align:left">Suba su archivo de <b>Excel (.xlsx)</b> o CSV; descargue la plantilla para ver las columnas. Si hay un error en cualquier fila no se importa nada, y se le indica cuál corregir.</p>
   ${tipos.map(([k,x])=>`<div class="card imp" id="c_${k}"><h4>${x.t}</h4><p class="h">${esc(x.ayuda)}</p>
    <button type="button" data-pl="${k}">Descargar plantilla</button> <input type="file" accept=".xlsx,.csv,text/csv,.txt" data-f="${k}">
    <div class="h" id="n_${k}"></div><div class="alert" id="e_${k}" style="white-space:pre-wrap"></div><button class="pri" id="b_${k}" disabled>Importar</button></div>`).join('')}`;
  tipos.forEach(([k,x])=>{let filas=null;const n=$('#n_'+k),e=$('#e_'+k),b=$('#b_'+k);
    document.querySelector(`[data-pl="${k}"]`).onclick=()=>descargarBlob(crearXLSX([x.cab.split(';'),x.ej.split(';')],'Plantilla',x.cab.split(';').map(()=>24)),`plantilla_${k}.xlsx`);
    document.querySelector(`[data-f="${k}"]`).onchange=async ev=>{e.classList.remove('on');b.disabled=true;filas=null;const f=ev.target.files[0];if(!f)return;
      try{if(f.size>5e6)throw new Error('El archivo es demasiado grande (máximo 5 MB)');filas=/\.xlsx$/i.test(f.name)?aObjetosT(await leerXLSX(await f.arrayBuffer()),x.alias):aObjetos(await f.text(),x.alias);
        if(k==='inventario')filas.forEach(r=>r.vencimiento=fechaISO(r.vencimiento));n.textContent=`${filas.length} fila(s) listas para importar.`;b.disabled=false}
      catch(er){n.textContent='';e.textContent=er.message;e.classList.add('on')}};
    b.onclick=async()=>{if(!filas)return;b.disabled=true;e.classList.remove('on');
      try{const r=await api(x.ruta,{method:'POST',body:{filas}});n.textContent='';msg(`Se importaron ${r.importados} registro(s).`);filas=null}
      catch(er){e.textContent=er.message;e.classList.add('on');b.disabled=false}};
  });
}
// ---- auditoría ----
async function auditoria(){
  $('#v').innerHTML=`<h3>Registro de auditoría</h3><div class="g2">${campoHTML({id:'ad',label:'Desde',type:'date'})}${campoHTML({id:'ah',label:'Hasta',type:'date'})}
   ${campoHTML({id:'au',label:'Usuario',max:30,opt:true})}${campoHTML({id:'ac',label:'Acción (ej. LOGIN, ALTA_USUARIO)',max:60,opt:true})}</div>
   <button class="pri" id="bs">Buscar</button> <button id="bx">Exportar CSV</button> <button id="bv">Verificar integridad</button><div id="res2"></div>`;
  const qs=()=>{const p=new URLSearchParams();[['desde','ad'],['hasta','ah'],['usuario','au'],['accion','ac']].forEach(([k,i])=>{const v=S($('#'+i).value);if(v)p.set(k,k==='accion'?v.toUpperCase():v)});return p};
  const ver=run(async()=>{if($('#ad').value&&$('#ah').value&&$('#ad').value>$('#ah').value)throw new Error('La fecha «Desde» no puede ser posterior a «Hasta»');
    const d=await api('/auditoria?'+qs());$('#res2').innerHTML=`<p class="h">${d.length} registro(s) (máximo 500, los más recientes)</p>`+
      tabla(['Fecha','Usuario','Acción','Tabla','Detalle'],d.map(r=>[new Date(r.fecha_hora).toLocaleString('es-VE'),r.usuario,r.accion,r.tabla||'',r.detalle||'']))});
  $('#bv').onclick=run(async()=>{const r=await api('/auditoria/integridad');msg(r.primer_error?`⚠ La cadena de auditoría está alterada desde el registro ${r.primer_error}`:`✔ Auditoría íntegra: ${r.total} registros verificados`,!!r.primer_error)});
  $('#bs').onclick=ver;$('#bx').onclick=run(()=>{const p=qs();p.set('formato','csv');return bajar('/auditoria?'+p,'auditoria.csv')});await ver();
}
// ---- panel: alertas al abrir ----
const panelOrig=VISTAS.panel;
async function panelV(){
  await panelOrig();
  const [d,rs]=await Promise.all([api('/dashboard'),api('/respaldos/estado')]),a=[];
  if(d.vencidos>0)a.push(['bad',`${d.vencidos} lote(s) vencido(s) con existencia: retírelos y regístrelos como merma.`]);
  if(d.v30>0)a.push(['warn',`${d.v30} lote(s) vencen en 30 días o menos.`]);
  if(d.criticos&&d.criticos.length)a.push(['warn',`${d.criticos.length} producto(s) por debajo del stock mínimo.`]);
  if(rs.dias===null)a.push(['bad','Todavía no hay respaldos. Use Archivo → Respaldo ahora.']);
  else if(rs.dias>=7)a.push(['warn',`El último respaldo fue hace ${rs.dias} días. Haga uno (Archivo → Respaldo ahora) y cópielo a una USB.`]);
  if(a.length)$('#v').insertAdjacentHTML('afterbegin',`<div class="alerts">${a.map(x=>`<div class="al ${x[0]}">⚠ ${esc(x[1])}</div>`).join('')}</div>`);
}
Object.assign(VISTAS,{panel:panelV,despacho:despachoV,entrada:entradaV,merma:mermaV,catalogo,importar,usuarios,auditoria});
