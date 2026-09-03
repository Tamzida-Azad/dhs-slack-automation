# Registers a Windows Scheduled Task for Daily Head Start posting.
# Runs weekdays at 12:00 local time (this PC is Bangladesh Standard Time / Asia/Dhaka).

$ErrorActionPreference = 'Stop'

$taskName = 'SJ-Daily-Head-Start'
$projectRoot = Split-Path -Parent $PSScriptRoot
$batPath = Join-Path $PSScriptRoot 'run-daily.bat'

if (-not (Test-Path $batPath)) {
  throw "Missing runner: $batPath"
}

$action = New-ScheduledTaskAction -Execute $batPath -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At '12:00PM'
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description 'Copy SJ Daily Head Start plan and post to Slack #daily-head-start and #sj-qa (weekdays 12:00 Asia/Dhaka).' `
  -Force | Out-Null

Write-Host "Scheduled task registered: $taskName"
Write-Host "Schedule: Mon-Fri at 12:00 PM (local Bangladesh Standard Time)"
Write-Host "Action:   $batPath"
Write-Host ""
Write-Host "Useful commands:"
Write-Host "  Get-ScheduledTask -TaskName '$taskName' | Get-ScheduledTaskInfo"
Write-Host "  Start-ScheduledTask -TaskName '$taskName'"
Write-Host "  Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false"
