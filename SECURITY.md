# Seguridad

Este sistema maneja datos de pacientes (cédula, nombre, récipes de controlados). Trate cualquier
falla de seguridad como sensible.

**No abra un issue público** para una vulnerabilidad. Escriba al correo de los mantenedores
(complete aquí: `seguridad@ejemplo.org`) con una descripción y los pasos para reproducirla.

Compromisos mínimos de quien despliegue el sistema:
- HTTPS en la red local, claves únicas y largas, respaldos cifrados y probados.
- Nunca subir `.env`, respaldos ni datos reales de pacientes al repositorio.
- Actualizar dependencias (`npm audit`) y la imagen de PostgreSQL con regularidad.
