Set fso = CreateObject("Scripting.FileSystemObject")
Set WshShell = CreateObject("WScript.Shell")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = scriptDir
electronExe = scriptDir & "\node_modules\electron\dist\electron.exe"

If fso.FileExists(electronExe) Then
  WshShell.Run """" & electronExe & """ .", 0, False
Else
  WshShell.Run "cmd /c npx electron .", 0, False
End If
