' Agentropolis city server launcher (silent).
' Resolves its own folder — VBScript has no %~dp0.
Dim fso, here
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run """" & here & "\agentropolis-city.cmd""", 0, False
