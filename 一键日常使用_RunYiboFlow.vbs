Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

currentDir = fso.GetParentFolderName(WScript.ScriptFullName)

' 1. Start Docker completely silently (Wait for it to finish starting)
WshShell.Run "cmd /c cd """ & currentDir & "\server"" && docker-compose up -d", 0, True

' 2. Start Compiled Go Backend completely silently (No black window attached)
' We pass 0 (Hide Window) and False (Don't wait for it to close)
backendCmd = "cmd /c set DB_DSN=host=localhost user=yibo_admin password=secret_password dbname=yiboflow port=5432 sslmode=disable TimeZone=Asia/Shanghai&& set REDIS_URL=redis://:secret_redis_pass@localhost:6379/0&& cd """ & currentDir & "\server"" && yiboflow_server.exe"
WshShell.Run backendCmd, 0, False

' Wait 2.5 seconds for backend microservices to initialize
WScript.Sleep 2500

' 3. Start Compiled Tauri App natively (it is a GUI app so naturally has no black window)
frontendPath1 = currentDir & "\target\release\YiboFlow Desktop.exe"
frontendPath2 = currentDir & "\target\release\tauri-app.exe"

If fso.FileExists(frontendPath1) Then
    WshShell.Run """" & frontendPath1 & """", 1, False
ElseIf fso.FileExists(frontendPath2) Then
    WshShell.Run """" & frontendPath2 & """", 1, False
Else
    MsgBox "Compiling in background... Please wait ~2 minutes for the .exe build to finish, then double-click me again.", 48, "Still Compiling"
End If
