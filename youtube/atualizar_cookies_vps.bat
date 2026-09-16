@echo off
setlocal
set LOG=D:\kimicode\youtube\atualizar_cookies.log
set COOKIES=D:\kimicode\youtube\cookies_auto.txt
set PYTHON=C:\Users\welli\AppData\Local\Python\pythoncore-3.14-64\python.exe
set SCP=C:\Program Files\Git\usr\bin\scp.exe
set SSH=C:\Program Files\Git\usr\bin\ssh.exe
set KEY=C:\Users\welli\.ssh\savetube_vps_key
set VPS=root@144.91.118.214

echo [%date% %time%] Iniciando exportacao de cookies (perfil savetube-bot) >> "%LOG%"
"%PYTHON%" -m yt_dlp --cookies-from-browser "firefox:votr557y.savetube-bot" --cookies "%COOKIES%" --skip-download --no-warnings "https://example.com" >> "%LOG%" 2>&1

findstr /C:"LOGIN_INFO" "%COOKIES%" >nul
if errorlevel 1 (
  echo [%date% %time%] ERRO: cookies sem sessao valida - upload abortado >> "%LOG%"
  exit /b 1
)

echo [%date% %time%] Backup dos cookies atuais na VPS >> "%LOG%"
"%SSH%" -i "%KEY%" -o IdentitiesOnly=yes %VPS% "cp -f /opt/savetube/cookies.txt /opt/savetube/cookies.txt.bak" >> "%LOG%" 2>&1

echo [%date% %time%] Enviando cookies novos para a VPS >> "%LOG%"
"%SCP%" -i "%KEY%" -o IdentitiesOnly=yes "%COOKIES%" %VPS%:/opt/savetube/cookies.txt >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [%date% %time%] ERRO: falha no envio via scp >> "%LOG%"
  exit /b 1
)

"%SSH%" -i "%KEY%" -o IdentitiesOnly=yes %VPS% "python3 /opt/savetube/validate_cookies.py" >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [%date% %time%] ERRO: validacao na VPS falhou - restaurando cookies anteriores >> "%LOG%"
  "%SSH%" -i "%KEY%" -o IdentitiesOnly=yes %VPS% "mv -f /opt/savetube/cookies.txt.bak /opt/savetube/cookies.txt" >> "%LOG%" 2>&1
  exit /b 1
)

echo [%date% %time%] Cookies atualizados e validados na VPS com sucesso >> "%LOG%"
exit /b 0
