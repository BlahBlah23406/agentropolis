' Agentropolis city server launcher (silent).
' Resolves its own folder — VBScript has no %~dp0.
Dim fso, here
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run """" & here & "\r2d2-city.cmd""", 0, False
