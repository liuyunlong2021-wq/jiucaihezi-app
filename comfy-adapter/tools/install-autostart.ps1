<#
安装/修复「本机 ComfyUI 云端链路」的开机自启（管理员权限运行）

登记 4 个计划任务（同名覆盖，可反复运行）：

  1) comfy-adapter      动作 = 隐藏窗口跑 cloud.ps1 -Action run-adapter   ← 9000
  2) comfy-frpc         动作 = 隐藏窗口跑 cloud.ps1 -Action run-frpc      ← 隧道
  3) comfy-cloud-boot   触发 = 登录后 30 秒 → cloud.ps1 -Action ensure-all（含 ComfyUI）
  4) comfy-cloud-guard  触发 = 登录 + 每 5 分钟 → cloud.ps1 -Action ensure-services（只保适配器+隧道）

为什么 1/2 的动作要换掉：原来用 `cmd.exe /c ... >> log`，会在桌面弹控制台窗口，
窗口一被关（或任务被 End），python / frpc 收到控制台关闭事件就以 0xC000013A 退出 ——
2026-10-02 实测两个服务就是这么一起死的。改成 `powershell -WindowStyle Hidden` 后没有可点的窗口。

为什么要有 4：计划任务不会自动拉起已退出的进程（State 会停在 Ready），
Comfy Desktop 也不在自己的启动项里；所以「开机全保 + 每 5 分钟补一次」才真正无人值守。

注：本文件必须保存为 UTF-8 with BOM —— PS 5.1 读无 BOM 的 UTF-8 会当 ANSI，中文变乱码并报语法错。
#>
param(
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

$Root = 'd:\jiucaihezi-app\comfy-adapter'
$CloudScript = Join-Path $Root 'tools\cloud.ps1'
$PowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$RunAs = "$env:USERDOMAIN\$env:USERNAME"

if (-not (Test-Path $CloudScript)) { throw "找不到 $CloudScript" }
if (-not (Test-Path $PowerShell)) { throw "找不到 $PowerShell" }

# 只允许：不加时限、不因电池/空闲退出、不重复起第二份、错过触发就补跑
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -DontStopOnIdleEnd `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew `
  -StartWhenAvailable

$principal = New-ScheduledTaskPrincipal -UserId $RunAs -LogonType Interactive -RunLevel Highest

function New-ServiceTask {
  param([string]$TaskName, [string]$Service)
  $action = New-ScheduledTaskAction -Execute $PowerShell `
    -Argument ("-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " + $CloudScript + " -Action " + $Service) `
    -WorkingDirectory $Root
  Register-ScheduledTask -TaskName $TaskName -Action $action -Settings $settings -Principal $principal -Force | Out-Null
  Write-Output ("已登记 {0}（隐藏窗口跑 {1}）" -f $TaskName, $Service)
}

function New-GuardTask {
  param([string]$TaskName, [string]$EnsureAction, [int]$DelaySeconds, [int]$EveryMinutes)

  $action = New-ScheduledTaskAction -Execute $PowerShell `
    -Argument ("-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " + $CloudScript + " -Action " + $EnsureAction) `
    -WorkingDirectory $Root

  # 登录触发：本机 AutoAdminLogon=1，开机后会自动登录，所以这条能无人值守地跑起来
  $logon = New-ScheduledTaskTrigger -AtLogOn -User $RunAs
  $logon.Delay = ('PT{0}S' -f $DelaySeconds)

  $triggers = @($logon)
  if ($EveryMinutes -gt 0) {
    # 再挂一个「立即开始、每 N 分钟一次」的触发器。
    # 注意：**不要**设 -RepetitionDuration([TimeSpan]::MaxValue) —— 会生成 P99999999DT23H59M59S，
    # Register-ScheduledTask 直接报「超出范围」(0x80041318)。XML 里省略 <Duration> 就是「无限期重复」。
    $repeat = New-ScheduledTaskTrigger -Once -At (Get-Date) `
      -RepetitionInterval (New-TimeSpan -Minutes $EveryMinutes)
    $triggers += $repeat
  }

  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Force | Out-Null
  Write-Output ("已登记 {0}（{1}，登录后 {2} 秒；重复间隔 {3} 分钟）" -f $TaskName, $EnsureAction, $DelaySeconds, $EveryMinutes)
}

if ($Uninstall) {
  foreach ($name in 'comfy-cloud-boot', 'comfy-cloud-guard') {
    if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
      Unregister-ScheduledTask -TaskName $name -Confirm:$false
      Write-Output "已删除 $name"
    }
  }
  Write-Output '（comfy-adapter / comfy-frpc 保留，只删了守护任务）'
  exit 0
}

New-ServiceTask -TaskName 'comfy-adapter' -Service 'run-adapter'
New-ServiceTask -TaskName 'comfy-frpc' -Service 'run-frpc'
New-GuardTask -TaskName 'comfy-cloud-boot' -EnsureAction 'ensure-all' -DelaySeconds 30 -EveryMinutes 0
New-GuardTask -TaskName 'comfy-cloud-guard' -EnsureAction 'ensure-services' -DelaySeconds 120 -EveryMinutes 5

Write-Output ''
Write-Output '当前状态：'
Get-ScheduledTask -TaskName 'comfy-adapter', 'comfy-frpc', 'comfy-cloud-boot', 'comfy-cloud-guard' |
  ForEach-Object { Write-Output ("  {0} | State={1} | LogonType={2}" -f $_.TaskName, $_.State, $_.Principal.LogonType) }
