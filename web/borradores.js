'use strict';
// ===== Autoguardado de formularios (IndexedDB): sobrevive a cortes de luz =====
// Cada formulario se guarda unos instantes después de escribir. Si el programa se cerró de forma anormal (apagón),
// al volver a entrar se ofrece recuperar los datos. Las claves (campos de contraseña) NUNCA se guardan.
const Borr=(()=>{
  const ST='b',VIDA=3*864e5;let dbp=null,pend=null,prev=null;const timers={};
  const salidaLimpia=(()=>{try{const v=localStorage.cdiSalidaLimpia;localStorage.cdiSalidaLimpia='0';return v==='1'}catch{return false}})();
  addEventListener('pagehide',()=>{try{localStorage.cdiSalidaLimpia='1'}catch{}});
  const abrir=()=>dbp||(dbp=new Promise((ok,mal)=>{try{const r=indexedDB.open('cdi-borradores',1);r.onupgradeneeded=()=>r.result.createObjectStore(ST,{keyPath:'k'});r.onsuccess=()=>ok(r.result);r.onerror=()=>mal(r.error)}catch(e){mal(e)}}));
  const op=async(modo,f)=>{const db=await abrir();return new Promise((ok,mal)=>{const t=modo==='readwrite'?db.transaction(ST,modo,{durability:'strict'}):db.transaction(ST,modo),rq=f(t.objectStore(ST));t.oncomplete=()=>ok(rq&&rq.result);t.onerror=t.onabort=()=>mal(t.error)})};
  const uid=()=>{try{return JSON.parse(atob(T.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).id||'anon'}catch{return 'anon'}};
  const clave=v=>`${uid()}:${v}`;
  const guardar=(k,v)=>op('readwrite',s=>s.put({k,...v,t:Date.now()})).catch(()=>{});
  const borrar=k=>op('readwrite',s=>s.delete(k)).catch(()=>{});
  const todos=()=>op('readonly',s=>s.getAll()).then(x=>x||[]).catch(()=>[]);
  const hayExtra=e=>Object.values(e||{}).some(v=>Array.isArray(v)?v.length:!!v);
  const val=e=>e.type==='checkbox'?e.checked:e.value;

  function aplicar(raiz,d,o){
    Object.entries(d.campos||{}).forEach(([id,v])=>{const e=raiz.querySelector('#'+id);if(!e)return;
      if(e.type==='checkbox')e.checked=!!v;else{if(e.tagName==='SELECT'&&![...e.options].some(x=>x.value===v))return;e.value=v}
      e.dispatchEvent(new Event('input'))});
    if(o.aplicar)o.aplicar(d.extra||{});
    msg('Se recuperaron los datos que estaba escribiendo.');
  }
  // Se llama al final de cada vista con formulario. o.extra() devuelve lo que no está en campos (productos elegidos, lista de ítems…).
  function enlazar(vista,raiz,o={}){
    if(prev){raiz.removeEventListener('input',prev.prog);raiz.removeEventListener('change',prev.prog);clearTimeout(timers[prev.k])}
    const k=clave(vista);let escrito=false;
    const elegibles=()=>[...raiz.querySelectorAll('input,select,textarea')].filter(e=>e.id&&!['password','file','button','submit'].includes(e.type)&&!(o.excluir||[]).includes(e.id)&&e.id!=='fq');
    const ini=new Map(elegibles().map(e=>[e.id,val(e)]));
    const salvar=()=>{const campos={};let cambio=false;elegibles().forEach(e=>{campos[e.id]=val(e);if(val(e)!==ini.get(e.id))cambio=true});
      const extra=o.extra?o.extra():{};if(cambio||hayExtra(extra)){escrito=true;return guardar(k,{vista,campos,extra})}return escrito?(escrito=false,borrar(k)):undefined};
    const prog=()=>{clearTimeout(timers[k]);timers[k]=setTimeout(salvar,400)};
    raiz.addEventListener('input',prog);raiz.addEventListener('change',prog);prev={prog,k};
    if(pend&&pend.vista===vista){const d=pend;pend=null;aplicar(raiz,d,o)}
    return prog;
  }
  const limpiar=vista=>{const k=clave(vista);clearTimeout(timers[k]);return borrar(k)};
  const mias=async()=>(await todos()).filter(d=>d.k.startsWith(uid()+':'));

  function ofrecer(d){
    document.querySelector('.recuperar')?.remove();
    const min=Math.max(1,Math.round((Date.now()-d.t)/60000)),hace=min<90?`${min} min`:`${Math.round(min/60)} h`;
    const el=document.createElement('div');el.className='recuperar';el.setAttribute('role','alertdialog');
    el.innerHTML=`<b>¿Desea recuperar los datos anteriores?</b><p>Había un formulario sin terminar en «${esc(NOMBRES[d.vista]||d.vista)}» (hace ${hace}). Es posible que se haya ido la luz.</p>
      <div class="bt"><button type="button" class="x">Descartar</button><button type="button" class="pri ok">Aceptar</button></div>`;
    document.body.append(el);
    el.querySelector('.ok').onclick=()=>{el.remove();if(document.querySelector(`nav [data-v="${d.vista}"]`)){pend=d;mostrar(d.vista)}else borrar(d.k)};
    el.querySelector('.x').onclick=async()=>{el.remove();await borrar(d.k);const r=(await mias()).filter(x=>Date.now()-x.t<VIDA).sort((a,b)=>b.t-a.t);if(r.length)ofrecer(r[0])};
  }
  // Tras iniciar sesión: ¿quedó algo sin guardar por un corte de energía?
  async function revisar(){
    const ds=await mias(),vig=ds.filter(d=>Date.now()-d.t<VIDA);
    for(const d of ds)if(!vig.includes(d))await borrar(d.k);
    if(salidaLimpia){for(const d of vig)await borrar(d.k);return}      // el programa se cerró normalmente: no hay nada que recuperar
    if(vig.length)ofrecer(vig.sort((a,b)=>b.t-a.t)[0]);
  }
  return {enlazar,limpiar,revisar};
})();
