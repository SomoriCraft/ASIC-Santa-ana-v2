'use strict';
const q = new URLSearchParams(location.search), $ = id => document.getElementById(id);
$('t').textContent = q.get('t') || 'Autorizar este equipo'; $('x').textContent = q.get('x') || ''; $('c').textContent = q.get('c') || '';
if (q.get('a') === '1') $('av').classList.add('on');
const intento = +q.get('i') || 0, max = +q.get('m') || 0;
$('i').textContent = max ? `Intento ${intento + 1} de ${max}.` : '';
if (q.get('e')) $('e').textContent = q.get('e');
$('f').onsubmit = async ev => { ev.preventDefault(); if (!$('m').value) { $('e').textContent = 'Escriba la clave maestra'; return; } $('o').disabled = true; await window.activar.enviar($('m').value); };
$('s').onclick = () => window.activar.cancelar();
