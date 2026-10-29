# Cambios 1.0.1 (arreglo: "se queda en Iniciando el sistema…")

No se pudo probar en Windows desde aquí, así que esta versión se centró en (1) quitar causas probables de bloqueo y
(2) que, si algo falla, **la pantalla diga exactamente en qué paso está** y quede un registro claro.

- La ventana de inicio muestra el paso actual y los segundos transcurridos.
- Instancia única corregida: una 2.ª copia ya no sigue ejecutando el arranque y pisando la base de datos.
- Al arrancar se cierran restos (postgres.exe / initdb.exe) de intentos anteriores que bloqueaban la carpeta de datos.
- `initdb` con 7 min de margen y `--no-sync` (mucho más rápido con antivirus); al vencer un plazo se mata todo el árbol de procesos.
- Si un paso tarda, ya no se cierra: avisa y permite "Seguir esperando / Abrir registro / Cerrar".
- Mensajes claros para: falta Visual C++ Redistributable, antivirus que borró archivos, clave interna perdida.
- Todo (salida de initdb, errores no controlados, últimas líneas de postgres.log) queda en `%APPDATA%\Farmacia CDI\arranque.log`.
- El instalador ya no abre el programa como administrador al terminar (`runAfterFinish: false`).
- Empaquetado sin asar (`"asar": false`) para evitar problemas de módulos ES dentro del .asar.
- La API ya no se cae si PostgreSQL se cierra (`pool.on('error')`).
- Nuevo `escritorio/DIAGNOSTICO.bat`: genera un informe en el Escritorio, sin necesidad de reconstruir nada.

# 1.0.3
- Usuarios (alta, activar/desactivar, restablecer clave, clave temporal con cambio obligatorio), «Mi clave».
- Catálogo con edición + importación CSV de productos y de inventario inicial (todo-o-nada, con lista de errores por fila).
- Auditoría consultable y exportable. Alertas al abrir (vencidos, por vencer, stock bajo, respaldo atrasado).
- Despacho, entrada y merma con validación por campo (cliente y servidor). El despacho usaba prompt(), que Electron no soporta: reemplazado.
- Lector de código de barras (Enter selecciona directo). Menú Archivo: Restaurar respaldo, Copiar respaldos a USB.
- Migraciones automáticas de base de datos (db/migraciones) que también se aplican a instalaciones existentes.

# 1.0.4
- **Recuperación de clave:** a los 3 intentos fallidos se piden 3 de 5 preguntas de seguridad al azar. Si falla alguna, el usuario se bloquea y se envía por correo un código de 6 dígitos (vale 15 minutos, máx. 5 intentos, máx. 3 códigos por hora). Requiere configurar el correo (menú Configuración) y que cada usuario registre su correo y respuestas (se le exige al entrar).
- **Anulación de despachos** (menú Despachos): solo el Regente, con motivo (≥15 caracteres) y su clave. Reintegra las unidades a sus lotes, deja el movimiento en el kardex, marca el acta como ANULADA y no cuenta en el consolidado ASIC. No se puede anular en un mes ya cerrado.
- **Conteo físico y cierre mensual obligatorio** (menú Cierre mensual): hoja de conteo en Excel, diferencias con motivo, ajuste automático del inventario y acta imprimible. Se avisa al acercarse fin de mes; pasados 3 días del mes siguiente sin cierre, la operación se bloquea (constante DIAS_GRACIA en api/server.js). Mientras hay un conteo abierto, despachos/entradas/mermas se suspenden.
- **Excel nativo:** importación de catálogo e inventario desde .xlsx (y CSV), plantillas en .xlsx, sin librerías externas.
- **Actualizaciones automáticas:** el programa consulta las Releases de GitHub (al abrir y cada 6 h, o en Archivo → Buscar actualizaciones). Para activarlas: escriba "usuario/repositorio" en escritorio/actualizaciones.json y publique cada versión subiendo una etiqueta (por ejemplo v1.0.5); el workflow crea la Release con el instalador. Antes de instalar se hace un respaldo; si falla, no se actualiza.
- Corregido: scripts/preparar.js solo copiaba server.js; ahora copia todos los .js de api/ (necesario para correo.js).
- CI: aplica las migraciones y ejecuta db/tests/02_anulacion_cierre.sql en un PostgreSQL real.

# 1.0.7 — Módulo 1: autenticación y seguridad local (100 % sin internet)
- Eliminada la recuperación por correo: se borró api/correo.js, la pantalla Configuración y los códigos; la migración 003 elimina la tabla de códigos, la configuración SMTP guardada y la columna email.
- Bloqueo temporal: 5 intentos fallidos de clave bloquean la cuenta 15 minutos (MAX_LOGIN / MIN_BLOQUEO en api/server.js).
- Preguntas de seguridad: 3 al azar de 5, con 4 oportunidades (cada intento fallido muestra 3 preguntas nuevas). Al agotarlas, el usuario queda bloqueado hasta que el Regente lo restablezca.
- Clave temporal: todo usuario nuevo o restablecido recibe la clave temporal del sistema y está obligado a cambiarla en su primer inicio de sesión (no puede volver a usar la temporal). Ya no se escribe una clave al crear usuarios.
- Clave maestra: pertenece solo al usuario principal (el primer Regente) y solo sirve para restablecer SU clave (no inicia sesión). En el código solo existe su hash (scrypt), nunca el texto. Freno: 5 fallos en 15 minutos.
- Solo el usuario principal puede restablecer a otro Regente; el principal no se puede desactivar.
- Pruebas SQL nuevas (db/tests/03) en el CI.

# 1.0.8 — Módulos 2, 3, 4 y 5 en una sola entrega
**Manual integrado (módulo 2):** pestaña «Manual» dentro del sistema, adaptada al rol (Regente 16 secciones, Almacenista 12, Inspector 8); buscador, expandir/contraer, Imprimir y «Guardar como PDF» (diálogo de guardado nativo). Sin claves ni credenciales: lo verifica una prueba automática (pruebas/manual.test.js, también en el CI).
**Resistencia a apagones (módulo 3):**
- Autoguardado en IndexedDB (despacho, entrada, merma) con guardado «estricto»; tras un corte de luz aparece «¿Desea recuperar los datos anteriores? [Aceptar] [Descartar]». Nunca se guardan campos de contraseña. Si el programa se cerró normalmente, los borradores se descartan solos. El conteo mensual se autoguarda en el servidor cada 6 s.
- Respaldo comprimido (-Z 6) verificado con pg_restore -l (si sale dañado se descarta); al cerrar, a las 17:00 si sigue encendida la PC, y al detectar corte de energía (equipos con batería). Se copia solo a toda USB conectada y a una carpeta adicional (Archivo → Carpeta de respaldo adicional). Al conectar una USB se le copia el último respaldo.
- PostgreSQL arranca con fsync, synchronous_commit y full_page_writes activos; al apagar Windows se detiene limpiamente.
- Todas las operaciones críticas (alta/edición de productos, usuarios, cambios de clave, recuperaciones) ahora guardan la operación y su auditoría en UNA transacción (BEGIN/COMMIT/ROLLBACK).
**Interfaz (módulo 4):** ejemplos en los campos (Ej. V-12345678, Ej. Lote-A2026…), listas desplegables con sugerencias (cargos, presentaciones, concentraciones), cédulas de receptores frecuentes con autocompletado de nombre y cargo, pitido del lector (agudo = encontrado, grave = no existe), el lector funciona aunque el cursor no esté en un campo, semáforo de lotes (rojo ≤30 días o vencido, amarillo 31–90, verde >90) en Panel, Existencias, selectores y FEFO. Fechas sin corrimiento de zona horaria.
**Comprobantes, auditoría y reportes (módulo 5):**
- Ticket térmico 80 mm / 58 mm o acta carta/A4, con receptor, fármaco, lote, vencimiento y —en controlados— paciente, médico y récipe; opción de impresión automática al despachar.
- Auditoría encadenada con hash (cada registro depende del anterior), inmutable (no se puede modificar ni borrar) y con botón «Verificar integridad». Cada ajuste del conteo mensual deja su propio registro (antes/después/motivo); las ediciones de producto guardan el cambio campo por campo.
- «Consumo diario» para Salas Situacionales/ASIC: por fecha o rango, por servicio y producto, sin despachos anulados, exportable a Excel e imprimible.
- Pruebas: db/tests/04_auditoria.sql (cadena, inmutabilidad, huella de ajustes).

# 1.0.9 — Seguridad: protección contra copia, fugas y ataques
- **Autorización por equipo (clave maestra):** cada instalación se ata al hardware y a la cuenta de Windows. Una copia llevada a otra PC no abre; tras 5 claves maestras incorrectas se elimina la base de datos, las claves, los respaldos y el programa de esa copia. Cancelar no borra. Un equipo legítimo (misma Windows) que solo olvidó la clave NO se borra. Se pide la clave maestra una sola vez (también al actualizar desde 1.0.8).
- **Respaldos cifrados (.cdibak)** con AES-256-GCM; restaurables en cualquier PC con la clave maestra; los antiguos se cifran solos. Sobre de claves (config.mk) para migrar de PC con autorización.
- **No ejecuta desde USB.**
- **API:** solo atiende a la propia PC (Host/Origin), CSP estricta (se movieron los scripts en línea a app.js y tema-pre.js), cabeceras de seguridad, errores sin detalles, topes de intentos, sesión validada en la base de datos (usuario activo, sin bloqueo, posterior al último cambio de clave; rol vigente).
- **Interfaz:** cierre de sesión a los 15 min de inactividad; tope anti «bomba zip» al leer Excel.
- **Electron:** sin DevTools, sandbox, navegación y ventanas restringidas, permisos denegados, IPC verificado.
- Pruebas: pruebas/cripto.test.js y pruebas/anticopia.test.js (la segunda necesita la variable CDI_MAESTRA_PRUEBA; se omite si no existe). Ver SEGURIDAD.md.
