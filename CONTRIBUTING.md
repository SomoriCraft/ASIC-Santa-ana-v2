# Cómo contribuir

¡Gracias por ayudar! Este proyecto apoya el control de medicamentos en centros de salud comunitarios.

## Reglas importantes
- **Nunca** incluya datos reales de pacientes, personal o inventario en issues, commits o capturas.
  Use datos inventados.
- Los cambios que afecten reglas sanitarias (FEFO, controlados, Libro Folia, mermas, Kardex) deben
  describir la norma o práctica en que se basan y pedir revisión de un farmacéutico.
- Las reglas de negocio viven en la base de datos (`db/02`, `db/03`). La API no debe saltarse esas funciones.

## Flujo
1. Haga un fork y cree una rama por cambio.
2. Levante PostgreSQL y cargue `db/01..04`; luego ejecute `psql -v ON_ERROR_STOP=1 -f db/tests/01_smoke.sql`
   contra una base de **pruebas** (el script revierte sus cambios, pero no lo use en producción).
3. Si agrega una regla, agregue su caso a `db/tests/01_smoke.sql`.
4. Abra un pull request explicando qué problema resuelve. La CI debe pasar.

## Ideas bienvenidas
Formularios para ajustes de inventario y catálogo en la interfaz, pruebas de la API, traducción a otros
idiomas, adaptación a otras normativas, accesibilidad y modo de contingencia sin servidor.
