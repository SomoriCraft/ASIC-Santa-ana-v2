# Seguridad de Farmacia CDI (v1.0.9)

## Qué protege el sistema
| Amenaza | Medida |
|---|---|
| Copiar el programa/datos a una USB y usarlos en otra PC | **Autorización por equipo**: cada instalación se autoriza con la clave maestra del usuario principal y queda atada al hardware (MachineGuid + UUID de la placa) y a la cuenta de Windows. Una copia ajena no abre; tras **5 claves maestras incorrectas** se elimina la información copiada (base de datos, claves, respaldos y el programa). Si solo se cancela, no se borra nada. |
| Ejecutar el programa desde una USB | Se rechaza si el .exe está en una unidad extraíble. |
| Leer un respaldo robado | Los respaldos son **.cdibak**: AES-256-GCM con una llave por archivo, envuelta con una llave derivada de la clave maestra (scrypt). Ilegibles y a prueba de alteraciones sin la clave maestra. Los respaldos antiguos sin cifrar se cifran solos al actualizar. |
| Leer las claves internas copiadas | Cifradas con la cuenta de Windows (DPAPI) y, además, en un «sobre» (config.mk) cifrado con la clave maestra para poder migrar de PC con autorización. |
| Adivinar claves | 5 intentos → bloqueo de 15 min; preguntas de seguridad con 4 oportunidades; clave maestra con freno (5 fallos / 15 min); claves con bcrypt. |
| Sesiones robadas o abandonadas | Cierre automático a los 15 min de inactividad; una sesión deja de valer si el usuario se desactiva, se bloquea o cambia su clave; el rol se lee siempre de la base de datos. |
| Ataques desde páginas web / otros programas | El servidor solo atiende a la propia PC (Host y Origin locales), CSP estricta (sin scripts en línea), cabeceras de seguridad, topes de intentos, errores sin detalles internos. |
| Programa de escritorio | Sin DevTools, sin navegar fuera de la PC, sin permisos del navegador, aislamiento y sandbox, IPC con verificación del origen. |
| Manipular la auditoría | Encadenada con hash e inmutable; botón «Verificar integridad». |

## Límites (lo que NO puede garantizar ningún programa)
1. **Archivos de la base de datos en claro en el disco.** Quien tenga acceso físico al disco puede leer los archivos de PostgreSQL con otro programa. **Active BitLocker / Cifrado de dispositivo de Windows** (Configuración → Privacidad y seguridad → Cifrado de dispositivo) y use un usuario de Windows con contraseña.
2. **El borrado ocurre solo si la copia ajena se ejecuta.** Si alguien copia los archivos y no los abre con el programa, el programa no puede borrarlos. Por eso los respaldos y las claves están cifrados.
3. **El hash de la clave maestra está dentro del programa.** Una clave larga y no deducible es esencial: la actual combina datos de la institución y una fecha, lo que la hace más fácil de adivinar de lo que parece. Si es posible, cámbiela por una frase larga al azar (hay que regenerar `api/maestra.js` y volver a compilar).
4. **Perder la clave maestra = perder la capacidad de migrar** a otra PC o restaurar un respaldo en otro equipo. Guárdela en sobre cerrado en caja fuerte.
5. **Cambio legítimo de hardware** (placa nueva, disco clonado): el programa pedirá la clave maestra. Con ella se autoriza y no se pierde nada; sin ella, tras 5 fallos, se tratará como copia ajena.
6. **SSD:** la sobrescritura antes de borrar no es una garantía absoluta en discos de estado sólido (por eso lo importante es el cifrado).
7. **Instalador sin firma digital:** Windows mostrará un aviso. Para producción, firme el .exe con un certificado de firma de código; las actualizaciones automáticas verifican la huella SHA-256 que publica GitHub cuando existe.
8. **Marcha atrás:** un usuario con permisos de administrador de Windows puede detener o alterar el propio programa; las defensas anteriores apuntan a copia, robo y uso indebido, no a un administrador malicioso del equipo.

## Recomendaciones operativas
- Una sola cuenta de Windows para la farmacia, con contraseña y bloqueo de pantalla (Win + L).
- No dejar USB conectadas permanentemente; usar solo la USB de respaldos y guardarla fuera del local.
- Revisar la auditoría semanalmente (acciones LOGIN_FALLIDO, BLOQUEO_TEMPORAL, ANULAR_DESPACHO, AJUSTE_CONTEO) y pulsar «Verificar integridad».
- Mantener el repositorio de GitHub **privado** si contiene datos; el actualizador necesita Releases públicas, así que publique las Releases en un repositorio aparte solo para instaladores.
