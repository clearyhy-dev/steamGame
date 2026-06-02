# 触发服务端从 defaultTasks 修复 Firestore 中文 label（勿用无 UTF-8 的 PUT 覆盖任务）
$BaseUrl = "https://steam-game-api-r7vmg7elga-as.a.run.app"
$login = Invoke-RestMethod -Uri "$BaseUrl/api/admin/auth/login" -Method POST -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes('{"username":"admin","password":"123456"}'))
$h = @{ Authorization = "Bearer $($login.data.token)" }
$list = Invoke-RestMethod -Uri "$BaseUrl/api/admin/scheduled-tasks" -Headers $h
$list.data.tasks | Select-Object id, label | Format-Table -AutoSize
