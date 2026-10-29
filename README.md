# Farmacia CDI — Control de inventario y farmacia hospitalaria (código abierto)

Programa de escritorio para Windows que controla medicamentos e insumos en centros de salud comunitarios:
entradas, despachos con FEFO (primero en vencer, primero en salir), medicamentos controlados con Libro Folia,
mermas con doble autorización, Kardex sanitario y reportes imprimibles. Nació para el CDI Santa Ana (Venezuela)
y se puede adaptar a otras instituciones.

## Para quien lo usa
Se instala con un `.exe` normal (asistente, Program Files, desinstalador de Windows). **No requiere instalar nada
más, ni navegador, ni internet**: abre su propia ventana y guarda los datos en la misma PC.
Instrucciones de una página: `LEEME-USUARIO-FINAL.txt`.

## Para quien construye el instalador
Vea `escritorio/README.md` (GitHub lo construye con un clic, o se construye en una PC con Windows).

## Carpetas
- `escritorio/` — programa de escritorio y configuración del instalador.
- `api/` — servicio que aplica las reglas (se empaqueta dentro del programa).
- `web/` — pantallas del sistema (se muestran dentro de la ventana del programa).
- `db/` — base de datos: tablas, reglas FEFO, controlados, mermas, reportes y pruebas (`db/tests`).

## Adaptarlo a su institución
- `web/config.json`: nombre de la institución, entidad, título y logo (ver `BRANDING.md`).
- `db/04_semillas.sql`: sus servicios y orígenes.
- Las reglas sanitarias (INHRR, SACS, MPPS) están pensadas para Venezuela; otras normativas se adaptan en `db/02` y `db/03`.

## Pruebas
`db/tests/01_smoke.sql` recorre FEFO, despachos, controlados, Libro Folia, mermas y reportes.
En GitHub se ejecuta sola en cada cambio (`.github/workflows/ci.yml`).

## Licencia y descargo
Código bajo licencia MIT (`LICENSE`). El nombre y el logo de la ASIC no están cubiertos (`BRANDING.md`).
Este software se entrega sin garantía. No es un dispositivo médico certificado: cada institución es responsable de
validarlo y de cumplir la normativa sanitaria y de protección de datos de su país.
Para contribuir vea `CONTRIBUTING.md`; para reportar vulnerabilidades, `SECURITY.md`.
