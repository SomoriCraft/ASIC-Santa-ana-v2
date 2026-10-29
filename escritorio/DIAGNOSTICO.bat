@echo off
setlocal
title Diagnostico de Farmacia CDI
set "REP=%USERPROFILE%\Desktop\diagnostico-farmacia-cdi.txt"
set "APPDIR=%ProgramFiles%\Farmacia CDI"
if not exist "%APPDIR%\resources\pgsql\bin\initdb.exe" set "APPDIR=%LOCALAPPDATA%\Programs\Farmacia CDI"
set "DATA=%APPDATA%\Farmacia CDI"
set "PGBIN=%APPDIR%\resources\pgsql\bin"

echo ==== DIAGNOSTICO FARMACIA CDI ==== > "%REP%"
echo Fecha: %date% %time% >> "%REP%"
ver >> "%REP%"
echo Usuario: %USERNAME% >> "%REP%"
echo Programa en: %APPDIR% >> "%REP%"
echo Datos en: %DATA% >> "%REP%"
echo. >> "%REP%"

echo --- Es administrador? --- >> "%REP%"
net session >nul 2>&1 && echo SI, esta ventana es de administrador >> "%REP%"
net session >nul 2>&1 || echo NO, usuario normal >> "%REP%"

echo. >> "%REP%"
echo --- Archivos de PostgreSQL --- >> "%REP%"
if exist "%PGBIN%\initdb.exe"   (echo initdb.exe   OK >> "%REP%") else (echo initdb.exe   FALTA >> "%REP%")
if exist "%PGBIN%\pg_ctl.exe"   (echo pg_ctl.exe   OK >> "%REP%") else (echo pg_ctl.exe   FALTA >> "%REP%")
if exist "%PGBIN%\postgres.exe" (echo postgres.exe OK >> "%REP%") else (echo postgres.exe FALTA >> "%REP%")

echo. >> "%REP%"
echo --- Visual C++ Redistributable x64 --- >> "%REP%"
reg query "HKLM\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" /v Installed >> "%REP%" 2>&1

echo. >> "%REP%"
echo --- Procesos abiertos (Farmacia / postgres / initdb) --- >> "%REP%"
tasklist | findstr /i "farmacia postgres initdb pg_ctl" >> "%REP%"

echo. >> "%REP%"
echo --- Espacio libre en disco --- >> "%REP%"
dir "%DATA%\.." 2>nul | findstr /i "libres bytes free" >> "%REP%"

echo. >> "%REP%"
echo --- arranque.log (lo que hizo el programa) --- >> "%REP%"
if exist "%DATA%\arranque.log" (type "%DATA%\arranque.log" >> "%REP%") else (echo NO EXISTE arranque.log: el programa ni siquiera llego a escribir >> "%REP%")

echo. >> "%REP%"
echo --- postgres.log --- >> "%REP%"
if exist "%DATA%\postgres.log" (type "%DATA%\postgres.log" >> "%REP%") else (echo no existe >> "%REP%")

echo.
echo Probando crear una base de datos de prueba (puede tardar hasta 5 minutos)...
echo No cierre esta ventana.
set "T=%TEMP%\pgtest-cdi"
rmdir /s /q "%T%" >nul 2>&1
echo. >> "%REP%"
echo --- PRUEBA MANUAL DE initdb --- >> "%REP%"
echo Inicio: %time% >> "%REP%"
"%PGBIN%\initdb.exe" -D "%T%" -U postgres -A trust -E UTF8 --locale=C --no-sync >> "%REP%" 2>&1
echo Codigo de salida: %errorlevel% >> "%REP%"
echo Fin: %time% >> "%REP%"
rmdir /s /q "%T%" >nul 2>&1

echo.
echo LISTO. Se creo el archivo:  %REP%
echo (esta en el Escritorio). Envielo a quien le ayuda.
echo.
pause
