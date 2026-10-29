# Construir el instalador .exe (para quien desarrolla)

Hay dos formas de empaquetar. **Si ya tiene Inno Setup, use la Opción I** (instalador clásico de Windows).

## Opción I: Inno Setup (recomendada si ya lo tiene)
Inno Setup solo arma el instalador; la aplicación hay que construirla antes con Node.js.

**I-1. Todo en su PC con Windows** (instale Node.js 20 LTS desde nodejs.org):
```
cd escritorio
npm install
npm run pg           # descarga PostgreSQL portátil (~300 MB), solo la primera vez
npm run empaquetar   # genera escritorio\dist\win-unpacked
```
Luego abra `escritorio\instalador\farmacia-cdi.iss` con **Inno Setup Compiler** y pulse **Compilar (F9)**.
El instalador queda en `escritorio\instalador\salida\Farmacia-CDI-Instalador-1.0.1.exe`.

**I-2. Sin instalar Node:** ejecute el flujo de GitHub (Opción A abajo), descargue el artefacto
**Farmacia-CDI-win-unpacked**, descomprímalo en `escritorio\dist\win-unpacked` y compile el `.iss` con Inno.

El instalador de Inno: asistente en español, `C:\Program Files\Farmacia CDI`, accesos directos, desinstalador en
Configuración → Aplicaciones, y al desinstalar **pregunta si desea borrar los datos (por defecto No)**.
Al terminar la instalación abre el programa con el usuario normal (no como administrador).
Si cambia la versión, edite `AppVersion` en el `.iss`.

> El `.iss` no pudo compilarse aquí (no hay Inno en este entorno). Si el compilador marca un error,
> copie el mensaje: normalmente es una ruta o una opción de versiones distintas de Inno.

## Opción II: instalador NSIS automático (electron-builder)
Lo genera `npm run dist` o el flujo de GitHub. Las instrucciones de esta opción siguen abajo.


El programa de escritorio empaqueta todo en un solo instalador de Windows:
la interfaz, la API y un PostgreSQL portátil. La persona que lo usa **no instala nada más**.

> Estado: el código fue revisado en sintaxis, pero **todavía no se ha construido ni probado en Windows**.
> Haga la primera construcción y una prueba completa en una PC limpia antes de repartirlo.

## Opción A (recomendada): GitHub construye el .exe por usted
1. Suba el contenido de la carpeta `cdi-santa-ana` a un repositorio de GitHub (la carpeta `.github` debe quedar en la raíz).
2. En GitHub: pestaña **Actions** → **Construir instalador de Windows (.exe)** → **Run workflow**.
3. Al terminar (10 a 20 minutos), entre a esa ejecución y descargue **Farmacia-CDI-Instalador** (contiene el `.exe`).

## Opción B: construir en su PC con Windows
Requiere Node.js 20 instalado.
```
cd escritorio
npm install
npm run pg        # descarga PostgreSQL portátil (~300 MB), solo la primera vez
npm run dist      # genera escritorio\dist\Farmacia-CDI-Instalador-1.0.1.exe
```
Para probar sin instalar: `npm run dev`.

## Qué instala (instalador estándar de Windows)
- Asistente en español con pantallas "Siguiente / Instalar / Finalizar".
- Pide permiso de administrador (aviso de Windows) e instala en `C:\Program Files\Farmacia CDI`
  (la carpeta se puede cambiar durante la instalación).
- Crea acceso directo en el escritorio y en el menú Inicio.
- Se registra en **Configuración → Aplicaciones → Aplicaciones instaladas**, con su **desinstalador** normal
  (también "Desinstalar Farmacia CDI" en el desinstalador de la carpeta de instalación).
- Instalar una versión nueva encima actualiza el programa y **conserva los datos**.
- Desinstalar quita el programa pero **no borra los datos ni los respaldos** (a propósito, para no perder
  información clínica por accidente). Los datos están en `%APPDATA%\Farmacia CDI` y los respaldos en
  `Documentos\Farmacia CDI`; se pueden borrar a mano si ya no se necesitan.
- Los datos pertenecen a cada usuario de Windows: si la PC tiene varias cuentas de Windows, cada una tendría
  su propia base. Para una farmacia se recomienda usar siempre la misma cuenta de Windows.

## Cómo funciona
- Al abrir, arranca PostgreSQL en 127.0.0.1 (puerto libre), crea la base la primera vez y ejecuta `db/01..04`.
- Si no hay usuarios, muestra una pantalla de bienvenida para crear al Farmacéutico Regente.
- Arranca la API solo en la propia PC (no queda expuesta a la red) y abre la ventana.
- Claves internas aleatorias, guardadas cifradas con la cuenta de Windows (`safeStorage`).
- Datos: `%APPDATA%\Farmacia CDI\pgdata` (carpeta definida por `productName`). Respaldos: `Documentos\Farmacia CDI\Respaldos` (uno diario al cerrar, conserva 60; también "Archivo → Respaldo ahora").
- Al desinstalar NO se borran los datos.

## Cosas que debe saber
- **Windows SmartScreen** mostrará "Windows protegió su PC" porque el instalador no está firmado.
  Hay que pulsar **Más información → Ejecutar de todas formas**. Un certificado de firma de código lo evita (es de pago).
- PostgreSQL necesita el runtime de Microsoft Visual C++ (viene en casi todo Windows 10/11 actualizado).
  Si falta, instale "Microsoft Visual C++ Redistributable x64".
- Solo Windows de 64 bits.
- Si la descarga de PostgreSQL da 404, cambie `VERSION` en `scripts/descargar-pg.js` por la vigente.
- Pendiente: botón para **restaurar** un respaldo, actualizaciones automáticas, instalación para varias PC en red
 .
