'use strict';
// ===== Manual de usuario integrado: se muestra dentro del sistema, adaptado al rol de quien lo abre =====
// REGLA DE SEGURIDAD: este texto nunca debe contener claves, contraseñas ni credenciales (hay una prueba automática que lo verifica).
const R_REG='FARMACEUTICO_REGENTE',R_ALM='ALMACENISTA',R_INS='INSPECTOR_ASIC',TODOS=[R_REG,R_ALM,R_INS],OPER=[R_REG,R_ALM];
const MANUAL=[
 {id:'inicio',t:'1. Primeros pasos e inicio de sesión',roles:TODOS,h:`
  <p>Al abrir el sistema escriba su <b>usuario</b> y su <b>clave</b> y pulse <b>Entrar</b>. Los campos se marcan en rojo si falta algo o el formato es incorrecto.</p>
  <ul><li><b>Primer ingreso:</b> si su usuario es nuevo, el sistema le exige cambiar la clave temporal que le entregó su responsable. Elija una clave de 10 o más caracteres con mayúscula, minúscula y número.</li>
  <li><b>Preguntas de seguridad:</b> también debe responder 5 preguntas. Si algún día olvida su clave, se le harán 3 de ellas al azar. Anote sus respuestas en un lugar seguro: el sistema no las muestra.</li>
  <li><b>Intentos fallidos:</b> con 5 claves incorrectas seguidas la cuenta se bloquea 15 minutos. Durante ese tiempo puede recuperar el acceso respondiendo las preguntas de seguridad (tiene 4 oportunidades).</li>
  <li><b>Si agota las 4 oportunidades</b> el usuario queda bloqueado hasta que el Farmacéutico Regente lo restablezca.</li>
  <li><b>Cambiar su clave</b> en cualquier momento: botón <b>Mi clave</b> (arriba). Para cambiar sus respuestas de seguridad use <b>Mi seguridad</b>.</li>
  <li><b>Tema:</b> el botón superior alterna entre automático, claro y oscuro.</li></ul>
  <div class="aviso">Nunca comparta su clave ni la anote en el equipo. Cierre la sesión con <b>Salir</b> al retirarse del puesto.</div>`},
 {id:'panel',t:'2. Panel y semáforo de lotes',roles:TODOS,h:`
  <p>El <b>Panel</b> muestra el resumen del día y las alertas: lotes vencidos o por vencer, productos bajo el mínimo, conteo mensual pendiente y respaldos.</p>
  <p>El <b>semáforo de lotes</b> prioriza qué sacar primero:</p>
  <ul><li><span class="sem rojo"></span> <b>Rojo:</b> vencido o vence en 30 días o menos. Salida prioritaria o retiro.</li>
  <li><span class="sem ambar"></span> <b>Amarillo:</b> vence entre 31 y 90 días. Úselo pronto.</li>
  <li><span class="sem verde"></span> <b>Verde:</b> vence en más de 90 días.</li></ul>
  <p>La pestaña <b>Existencias</b> lista todos los lotes ordenados por fecha de vencimiento, con filtro por color y búsqueda.</p>`},
 {id:'lector',t:'3. Búsqueda y lector de código de barras',roles:OPER.concat([R_INS]),h:`
  <p>En cualquier selector de producto puede <b>escribir parte del nombre</b> o <b>escanear el código de barras</b> con el lector USB. Al escanear, el producto se elige solo y suena un pitido corto (si no existe, el pitido es grave).</p>
  <p>Con el cursor fuera de un campo, basta con escanear: el sistema coloca el código en el buscador de la pantalla. Los campos con lista (cargo, presentación) ofrecen sugerencias mientras escribe; también puede escribir un valor distinto.</p>`},
 {id:'despacho',t:'4. Despachar medicamentos e insumos',roles:OPER,h:`
  <ol><li>Abra <b>Despacho</b> y elija el <b>destino</b> (servicio del CDI o consultorio popular).</li>
  <li>Escriba la <b>cédula</b> de quien recibe (Ej. V-12345678). Si ya recibió antes, el sistema completa nombre y cargo.</li>
  <li>Busque o escanee el producto y escriba la cantidad. El sistema reparte la salida por <b>FEFO</b>: primero los lotes que vencen antes.</li>
  <li>Si el producto es <b>controlado</b>, el sistema pide los datos del paciente, del médico y el número de récipe.</li>
  <li>Pulse <b>Despachar</b>. Se genera el acta y puede imprimir el <b>comprobante</b> (ticket térmico de 80 o 58 mm, o carta/A4).</li></ol>
  <div class="aviso">El sistema no deja despachar más de lo disponible ni lotes vencidos. Si se va la luz mientras escribe, al volver se le ofrece recuperar lo que tenía en pantalla.</div>`},
 {id:'comprobantes',t:'5. Comprobantes e historial de despachos',roles:TODOS,h:`
  <p>En <b>Despachos</b> puede buscar por fecha, número de acta, destino o receptor, y reimprimir cualquier comprobante. Elija el formato (ticket 80 mm, 58 mm o carta) y quedará recordado en este equipo. Los despachos anulados se muestran marcados como <b>ANULADO</b> con su motivo.</p>`},
 {id:'entrada',t:'6. Recepción de mercancía (entradas)',roles:OPER,h:`
  <ol><li>Abra <b>Entrada</b>, busque o escanee el producto.</li>
  <li>Escriba el <b>lote</b> del fabricante (Ej. Lote-A2026), la <b>fecha de vencimiento</b>, la cantidad y la factura o guía.</li>
  <li>Pulse <b>Registrar entrada</b>. No se aceptan lotes ya vencidos.</li></ol>
  <p>Para cargar muchos productos a la vez use <b>Importar</b> con la plantilla de Excel.</p>`},
 {id:'merma',t:'7. Mermas y desincorporaciones',roles:OPER,h:`
  <p>Use <b>Merma</b> para dar de baja unidades dañadas, vencidas o contaminadas. Seleccione el lote, la cantidad, el motivo y describa lo ocurrido. <b>Toda merma requiere la autorización del Farmacéutico Regente</b>, que escribe su usuario y su clave en el momento. Queda un acta de desincorporación.</p>`},
 {id:'importar',t:'8. Importar desde Excel',roles:OPER,h:`
  <p>En <b>Importar</b> descargue la plantilla (.xlsx), llénela y súbala. Se aceptan archivos de Excel (.xlsx) y CSV. El sistema revisa todas las filas: si hay errores <b>no importa nada</b> y le indica qué fila corregir.</p>`},
 {id:'cierre',t:'9. Conteo físico y cierre mensual (obligatorio)',roles:OPER,h:`
  <p>Cada mes es <b>obligatorio</b> contar físicamente todos los lotes y cerrar el mes. Si pasan 3 días del mes siguiente sin cierre, el sistema bloquea despachos, entradas y mermas hasta hacerlo.</p>
  <ol><li>En <b>Cierre mensual</b> descargue la <b>hoja de conteo</b> (Excel) para contar sin ver las cantidades del sistema.</li>
  <li>Escriba la cantidad física de cada lote. Se guarda automáticamente cada pocos segundos.</li>
  <li>Si hay diferencia, escriba el <b>motivo</b> (mínimo 10 caracteres).</li>
  ${'${REGENTE_CIERRE}'}</ol>
  <div class="aviso">Mientras hay un conteo abierto, despachos, entradas y mermas están suspendidos para que las cifras coincidan.</div>`},
 {id:'catalogo',t:'10. Catálogo de productos',roles:[R_REG],h:`
  <p>En <b>Catálogo</b> cree y edite productos: DCI, presentación (lista desplegable), concentración, categoría, control, temperatura y stock mínimo y máximo. Los medicamentos exigen registro sanitario INHRR. Un producto desactivado deja de aparecer en despachos y entradas, pero su historial se conserva. Todo cambio queda en la auditoría con el valor anterior y el nuevo.</p>`},
 {id:'usuarios',t:'11. Usuarios y roles',roles:[R_REG],h:`
  <ul><li><b>Nuevo usuario:</b> elija el rol. El usuario recibe la clave temporal del sistema y <b>debe cambiarla en su primer ingreso</b>. Comuníquesela en persona.</li>
  <li><b>Restablecer clave:</b> vuelve a asignar la clave temporal, desbloquea la cuenta y obliga a cambiarla.</li>
  <li><b>Desactivar:</b> impide el ingreso sin borrar el historial. No se puede desactivar al usuario principal.</li>
  <li><b>Usuario principal:</b> es el primer Regente registrado. Solo él puede restablecer a otros Regentes. Si olvida su clave y sus preguntas de seguridad no le sirven, puede restablecerla con la <b>clave maestra</b> que guarda el responsable de la institución (enlace «Soy el usuario principal» en la pantalla de ingreso).</li></ul>`},
 {id:'anulacion',t:'12. Anular un despacho',roles:[R_REG],h:`
  <p>Solo el Regente puede anular. En <b>Despachos</b> pulse <b>Anular</b>, escriba el motivo (mínimo 15 caracteres) y confirme con su clave. Las unidades regresan a sus lotes, el acta queda marcada como ANULADA y el consolidado ASIC no la cuenta. <b>No se puede anular un despacho de un mes ya cerrado.</b> Cada anulación queda en el kardex y en la auditoría.</p>`},
 {id:'auditoria',t:'13. Auditoría e integridad',roles:[R_REG,R_INS],h:`
  <p>La pestaña <b>Auditoría</b> muestra quién hizo qué y cuándo: ingresos, altas, cambios, anulaciones, ajustes de conteo y bloqueos. Puede filtrar por fecha, usuario y acción, y exportar a CSV. Cada registro está encadenado al anterior y no se puede modificar ni borrar; el botón <b>Verificar integridad</b> comprueba que la cadena esté intacta.</p>`},
 {id:'consumo',t:'14. Reportes y consumo diario para el ASIC',roles:TODOS,h:`
  <p>En <b>Consumo diario</b> elija una fecha (o un rango) y obtendrá el total despachado por servicio y producto, listo para la Sala Situacional o la red comunitaria. Puede exportarlo a Excel o imprimirlo. Los despachos anulados no se cuentan. En <b>Reportes</b> están el kardex sanitario y el consolidado por período.</p>`},
 {id:'respaldos',t:'15. Respaldos y cortes de luz',roles:TODOS,h:`
  <ul><li>El sistema guarda <b>borradores</b> de lo que escribe. Si se va la luz, al volver a entrar aparece <b>«¿Desea recuperar los datos anteriores?»</b>: Aceptar rellena los campos; Descartar los elimina.</li>
  <li>Cada operación se guarda completa o no se guarda (no quedan datos a medias).</li>
  <li>Se hace un <b>respaldo comprimido y cifrado</b> (archivos .cdibak) automático al cerrar el programa y al final del día, y se copia a una <b>USB</b> conectada o a la carpeta adicional elegida. Un respaldo cifrado no se puede leer sin la clave maestra del usuario principal.</li>
  <li>Cierre siempre el programa con el botón de cerrar de la ventana, no apagando la PC.</li></ul>
  ${'${REGENTE_RESPALDO}'}`},
 {id:'seguridad',t:'16. Seguridad de la información',roles:TODOS,h:`
  <ul><li><b>Sesión:</b> por seguridad, el sistema cierra la sesión tras 15 minutos sin uso. Lo que tenía escrito queda como borrador.</li>
  <li><b>Equipo autorizado:</b> el programa y sus datos solo funcionan en la computadora autorizada por el usuario principal. Si se copian a otro equipo, no abren y, tras intentos fallidos de autorización, la información copiada se elimina automáticamente.</li>
  <li><b>No copie</b> carpetas del programa ni de los datos a una USB. Para llevar una copia de seguridad use únicamente los respaldos cifrados que genera el sistema.</li>
  <li><b>USB desconocidas:</b> no conecte unidades de origen desconocido en el equipo de la farmacia.</li>
  <li><b>Recomendado:</b> tener activado el cifrado de disco de Windows (BitLocker o «Cifrado de dispositivo») y bloquear la pantalla (tecla Windows + L) al ausentarse.</li>
  <li>Cada acción importante queda registrada en la auditoría con su fecha y su usuario.</li></ul>`},
 {id:'soporte',t:'17. Problemas frecuentes',roles:TODOS,h:`
  <ul><li><b>«Cuenta bloqueada temporalmente»:</b> espere 15 minutos o responda las preguntas de seguridad.</li>
  <li><b>«Operación bloqueada por cierre mensual»:</b> el Regente debe hacer el conteo físico y cerrar el mes anterior.</li>
  <li><b>El lector no escribe nada:</b> haga clic en el buscador del producto y vuelva a escanear.</li>
  <li><b>No se imprime el ticket:</b> verifique la impresora predeterminada y el formato elegido (80 mm, 58 mm o carta).</li></ul>`}
];
const MANUAL_REG_CIERRE='<li>El <b>Farmacéutico Regente</b> pulsa <b>Cerrar mes</b> y confirma con su propia clave. El inventario se ajusta solo, cada diferencia queda en el kardex y en la auditoría, y se imprime el acta de cierre. También puede <b>Cancelar conteo</b> si debe reiniciarlo.</li>';
const MANUAL_REG_RESP='<p><b>Para el Regente:</b> en el menú <b>Archivo</b> están <b>Respaldo ahora</b>, <b>Restaurar respaldo…</b> (antes de restaurar se guarda una copia de los datos actuales), <b>Copiar respaldos a USB / otra carpeta…</b> y <b>Carpeta de respaldo adicional…</b>. Verifique de vez en cuando que haya copias recientes en la USB.</p>';
const ROL_NOMBRE={FARMACEUTICO_REGENTE:'Farmacéutico Regente (administrador)',ALMACENISTA:'Almacenista (operador)',INSPECTOR_ASIC:'Inspector ASIC (consulta)'};
function manualSecciones(rol){
  return MANUAL.filter(s=>s.roles.includes(rol)).map(s=>({...s,h:s.h.replace('${REGENTE_CIERRE}',rol===R_REG?MANUAL_REG_CIERRE:'').replace('${REGENTE_RESPALDO}',rol===R_REG?MANUAL_REG_RESP:'')}));
}
const MANUAL_CSS='body{font-family:"Segoe UI",Arial,sans-serif;font-size:13px;color:#111;line-height:1.5}h1{color:#0f766e;font-size:20px;margin:0 0 4px}h2{font-size:15px;color:#0f766e;border-bottom:1px solid #bbb;padding-bottom:3px;margin:16px 0 6px}.aviso{border-left:4px solid #b45309;background:#fef3c7;padding:6px 10px;margin:8px 0}.sem{display:inline-block;width:11px;height:11px;border-radius:50%;vertical-align:middle}.rojo{background:#dc2626}.ambar{background:#f59e0b}.verde{background:#16a34a}p,li{margin:4px 0}';
function manualDocumento(rol,version){
  const sec=manualSecciones(rol);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Manual de usuario</title><style>@page{margin:16mm}${MANUAL_CSS}</style></head><body><h1>Manual de usuario — Farmacia CDI</h1>
   <p><b>Perfil:</b> ${ROL_NOMBRE[rol]||rol} · <b>Versión del sistema:</b> ${version||''}</p>${sec.map(s=>`<h2>${s.t}</h2>${s.h}`).join('')}</body></html>`;
}
async function manualV(){
  const sec=manualSecciones(ROL);let ver='';try{ver=(await fetch('/api/version').then(r=>r.json())).version||''}catch{}
  $('#v').innerHTML=`<div class="bar2"><h3>Manual de usuario</h3><div><button id="mx">Expandir todo</button> <button id="mc2">Contraer todo</button> <button id="mi">Imprimir</button> <button class="pri" id="mp2">Guardar como PDF</button></div></div>
   <p class="h">Perfil: <b>${esc(ROL_NOMBRE[ROL]||ROL)}</b>${ver?` · Versión del sistema ${esc(ver)}`:''}. El manual muestra solo lo que corresponde a su rol.</p>
   <input id="mq" placeholder="Buscar en el manual… Ej. anular, respaldo, lector"><div id="mb">
   ${sec.map((s,i)=>`<details class="man" ${i===0?'open':''} data-t="${esc((s.t+' '+s.h.replace(/<[^>]+>/g,' ')).toLowerCase())}"><summary>${esc(s.t)}</summary><div class="mc">${s.h}</div></details>`).join('')}</div><p class="h" id="mn" style="display:none">Sin resultados.</p>`;
  const ds=()=>[...document.querySelectorAll('#mb details')];
  $('#mx').onclick=()=>ds().forEach(d=>d.open=true);$('#mc2').onclick=()=>ds().forEach(d=>d.open=false);
  $('#mq').oninput=()=>{const q=$('#mq').value.toLowerCase().trim();let n=0;ds().forEach(d=>{const ok=!q||d.dataset.t.includes(q);d.style.display=ok?'':'none';if(q&&ok){d.open=true;n++}});$('#mn').style.display=q&&!n?'':'none'};
  $('#mi').onclick=()=>{const w=window.open('','_blank');if(!w){msg('Permita ventanas emergentes para imprimir',1);return}w.document.write(manualDocumento(ROL,ver));w.document.close();setTimeout(()=>{w.focus();w.print()},250)};
  $('#mp2').onclick=run(async()=>{
    const nombre=`Manual_Farmacia_CDI_${ROL==='FARMACEUTICO_REGENTE'?'Regente':ROL==='ALMACENISTA'?'Almacenista':'Inspector'}.pdf`;
    if(window.cdi&&window.cdi.guardarPDF){const f=await window.cdi.guardarPDF(manualDocumento(ROL,ver),nombre);if(f)msg('Manual guardado en: '+f)}
    else $('#mi').click();      // fuera de la aplicación de escritorio: en el diálogo de impresión elija «Guardar como PDF»
  });
}
VISTAS.manual=manualV;
