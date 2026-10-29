; Instalador de Farmacia CDI con Inno Setup (6.x).
; Antes de compilar: en la carpeta escritorio ejecute  npm run empaquetar  (genera dist\win-unpacked).
; Luego abra este archivo en "Inno Setup Compiler" y pulse Compilar (F9).
#define AppName "Farmacia CDI"
#define AppVersion "1.0.9"
#define AppExeName "Farmacia CDI.exe"

[Setup]
AppId={{7C71C1C5-B294-4BAD-B6E2-527162466EAB}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Colaboradores del proyecto Farmacia CDI
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
OutputDir=salida
OutputBaseFilename=Farmacia-CDI-Instalador-{#AppVersion}
SetupIconFile=..\build\icon.ico
UninstallDisplayIcon={app}\{#AppExeName}
UninstallDisplayName={#AppName}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "..\dist\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{group}\Desinstalar {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Run]
; runasoriginaluser: el programa NO debe ejecutarse como administrador (PostgreSQL lo rechaza)
Filename: "{app}\{#AppExeName}"; Description: "Abrir {#AppName}"; Flags: nowait postinstall skipifsilent runasoriginaluser

[Code]
// Al desinstalar, pregunta si se borran los datos. Por defecto se CONSERVAN.
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var Datos: String;
begin
  if (CurUninstallStep = usPostUninstall) and (not UninstallSilent) then
  begin
    Datos := ExpandConstant('{userappdata}\Farmacia CDI');
    if DirExists(Datos) then
      if MsgBox('¿Desea borrar también los datos del sistema (inventario, usuarios, kardex)?' + #13#10 + #13#10 +
                'Elija "No" para conservarlos (recomendado). Los respaldos de la carpeta Documentos nunca se borran.',
                mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
        DelTree(Datos, True, True, True);
  end;
end;
