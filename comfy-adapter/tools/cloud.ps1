<#
comfy-adapter 本机云端链路：一键起停 + 自愈

链路三跳（缺一跳，其他电脑就用不上本机的 MiniMax H3）：
  1) ComfyUI        127.0.0.1:8188  ← Comfy Desktop（GUI，只能在本机已登录的桌面会话里跑）
  2) comfy-adapter  127.0.0.1:9000  ← 计划任务 comfy-adapter
  3) frpc 隧道                       ← 计划任务 comfy-frpc → VPS 的 frps:8796 → NewAPI 渠道 140

用法（在这台机器上跑）：
  powershell -ExecutionPolicy Bypass -File tools\cloud.ps1 -Action status
  powershell -ExecutionPolicy Bypass -File tools\cloud.ps1 -Action ensure-all        # 三跳全保（开机任务用）
  powershell -ExecutionPolicy Bypass -File tools\cloud.ps1 -Action ensure-services   # 只保适配器+隧道（守护任务用）
  powershell -ExecutionPolicy Bypass -File tools\cloud.ps1 -Action restart-adapter   # 改完 workflow/meta 后重启适配器
  powershell -ExecutionPolicy Bypass -File tools\cloud.ps1 -Action restart-frpc

为什么需要它（2026-10-02 实测的根因，别再退回老做法）：
  * 两个服务任务原来的动作是 `cmd.exe /c ... >> log`，**会在桌面弹一个控制台窗口**；
    窗口被关掉（或任务被 End）时 python / frpc 会收到控制台关闭事件，以 0xC000013A 退出。
    当天 01:04 开机后两者本来都起好了，08:33 一起死 —— 就是窗口被点了。
    所以任务动作已改成隐藏窗口的 powershell（`-Action run-adapter` / `run-frpc`）。
  * 起服务**只走计划任务**（单一入口，避免同时起两份抢 9000）；守护只负责「缺谁补谁」，
    并处理「任务 State 卡在 Running 但端口不通」这种夹生状态。
  * ComfyUI 是 GUI：开机后没人开它就永远不会有 8188。本机 `AutoAdminLogon=1`（自动登录），
    所以「登录时触发」能真正无人值守地跑起来。
#>
param(
  [ValidateSet('status', 'ensure-all', 'ensure-services', 'restart-adapter', 'restart-frpc', 'run-adapter', 'run-frpc')]
  [string]$Action = 'status'
)

$ErrorActionPreference = 'Continue'

$Root = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $Root 'logs'
$CloudLog = Join-Path $LogDir 'cloud.log'
$AdapterLog = Join-Path $LogDir 'adapter.log'
$FrpcStdout = Join-Path $LogDir 'frpc-stdout.log'
$Python = Join-Path $Root '.venv\Scripts\python.exe'
$FrpcExe = Join-Path $Root 'bin\frpc.exe'
$FrpcToml = Join-Path $Root 'deploy\frpc.toml'
$ComfyDesktop = 'D:\ComfyUI-Desktop\Comfy Desktop\Comfy Desktop.exe'

$AdapterPort = 9000
$ComfyPort = 8188
$AdapterTask = 'comfy-adapter'
$FrpcTask = 'comfy-frpc'

$script:Problems = 0

function Write-Log {
  param([string]$Message)
  $line = '{0} | {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
  # 首次建文件时写 BOM：PS 5.1 的 Get-Content 读无 BOM 的 UTF-8 会当 ANSI，中文全乱
  if (-not (Test-Path $CloudLog)) {
    [IO.File]::WriteAllText($CloudLog, $line + "`r`n", (New-Object System.Text.UTF8Encoding($true)))
  } else {
    [IO.File]::AppendAllText($CloudLog, $line + "`r`n", (New-Object System.Text.UTF8Encoding($false)))
  }
  Write-Output $line
}

function Test-Port {
  param([int]$Port)
  return [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

function Wait-Port {
  param([int]$Port, [int]$TimeoutSeconds)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Port $Port) { return $true }
    Start-Sleep -Milliseconds 1000
  }
  return (Test-Port $Port)
}

function Get-FrpcProcess {
  return Get-Process -Name frpc -ErrorAction SilentlyContinue
}

function Restart-TaskClean {
  param([string]$TaskName)
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (-not $task) { Write-Log ('!! 计划任务 {0} 不存在' -f $TaskName); return $false }
  if ($task.State -eq 'Running') {
    # 进程已死但任务没回收时，Start-ScheduledTask 会被当成「已在运行」而不干活
    Write-Log ('{0}: State=Running，先停掉再拉' -f $TaskName)
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 2000
  }
  Start-ScheduledTask -TaskName $TaskName
  return $true
}

function Ensure-Adapter {
  if (Test-Port $AdapterPort) { Write-Log ('适配器: 已在跑（:{0}）' -f $AdapterPort); return $true }
  Write-Log ('适配器: :{0} 不通，拉起计划任务 {1}' -f $AdapterPort, $AdapterTask)
  Restart-TaskClean $AdapterTask | Out-Null
  if (Wait-Port $AdapterPort 60) { Write-Log ('适配器: 已就绪（:{0}）' -f $AdapterPort); return $true }
  Write-Log ('!! 适配器: 60 秒内 {0} 仍不通，看 {1}' -f $AdapterPort, $AdapterLog)
  $script:Problems++
  return $false
}

function Ensure-Frpc {
  if (Get-FrpcProcess) { Write-Log '隧道: frpc 已在跑'; return $true }
  Write-Log ('隧道: 没有 frpc 进程，拉起计划任务 {0}' -f $FrpcTask)
  Restart-TaskClean $FrpcTask | Out-Null
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline) {
    if (Get-FrpcProcess) { Write-Log '隧道: frpc 已拉起'; return $true }
    Start-Sleep -Milliseconds 1000
  }
  Write-Log ('!! 隧道: 30 秒内 frpc 没起来，看 {0}' -f $FrpcStdout)
  $script:Problems++
  return $false
}

function Ensure-ComfyUI {
  if (Test-Port $ComfyPort) { Write-Log ('ComfyUI: 已在跑（:{0}）' -f $ComfyPort); return $true }
  if (Get-Process -Name 'Comfy Desktop' -ErrorAction SilentlyContinue) {
    # 安装记录里 portConflict=auto 时，8188 被占会静默漂到 8189 —— 适配器固定连 8188，必然连不上
    Write-Log ('!! ComfyUI: Comfy Desktop 进程在，但 {0} 没监听（很可能漂到别的端口了）。把它设成「端口冲突=询问」并重启它' -f $ComfyPort)
    $script:Problems++
    return $false
  }
  Write-Log ('ComfyUI: {0} 不通且没有 Comfy Desktop 进程，启动 Comfy Desktop' -f $ComfyPort)
  if (-not (Test-Path $ComfyDesktop)) {
    Write-Log ('!! ComfyUI: 找不到 {0}' -f $ComfyDesktop)
    $script:Problems++
    return $false
  }
  Start-Process -FilePath $ComfyDesktop | Out-Null
  # 首次要加载 standalone 环境，给足 3 分钟
  if (Wait-Port $ComfyPort 180) { Write-Log ('ComfyUI: 已就绪（:{0}）' -f $ComfyPort); return $true }
  Write-Log ('!! ComfyUI: 180 秒内 {0} 仍不通（Comfy Desktop 可能弹了端口询问框）' -f $ComfyPort)
  $script:Problems++
  return $false
}

function Show-Status {
  $comfy = Test-Port $ComfyPort
  $adapter = Test-Port $AdapterPort
  $frpc = Get-FrpcProcess
  Write-Output ('第 1 跳 ComfyUI         : ' + $(if ($comfy) { "ok  (:$ComfyPort)" } else { "DOWN" }))
  Write-Output ('第 2 跳 comfy-adapter   : ' + $(if ($adapter) { "ok  (:$AdapterPort)" } else { "DOWN" }))
  Write-Output ('第 3 跳 frpc 隧道       : ' + $(if ($frpc) { 'ok  (' + $frpc.Count + ' 个进程)' } else { 'DOWN' }))
  if ($adapter) {
    try {
      $health = Invoke-RestMethod "http://127.0.0.1:$AdapterPort/health" -TimeoutSec 8
      $comfyState = $health.comfyui
      Write-Output ('适配器 /health          : ok   comfyui=' + $comfyState)
      if ($health.models) { Write-Output ('已注册模型             : ' + ($health.models -join ', ')) }
    } catch {
      Write-Output ('适配器 /health          : 503/失败（多半是它连不上 ComfyUI）-> ' + $_.Exception.Message)
    }
  }
  if ($frpc) {
    $tail = Get-Content (Join-Path $LogDir 'frpc.log') -Tail 40 -ErrorAction SilentlyContinue |
      Where-Object { $_ -match 'start proxy success|login to server success' } | Select-Object -Last 1
    if ($tail) { Write-Output ('frpc 最近一次连上服务端 : ' + $tail) }
  }
  Write-Output ''
  Write-Output '其他电脑能否用：三跳都 ok 就能用（NewAPI 渠道 140 → frps:8796）'
}

function Restart-Adapter {
  Write-Log '重启适配器（改过 workflows/*.meta.json 后必须做）'
  $task = Get-ScheduledTask -TaskName $AdapterTask -ErrorAction SilentlyContinue
  if ($task) { Stop-ScheduledTask -TaskName $AdapterTask -ErrorAction SilentlyContinue }
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline -and (Test-Port $AdapterPort)) { Start-Sleep -Milliseconds 500 }
  if (Test-Port $AdapterPort) { Write-Log ('!! {0} 一直没释放，先手工查占用进程' -f $AdapterPort); $script:Problems++; return }
  Ensure-Adapter | Out-Null
}

function Restart-Frpc {
  Write-Log '重启 frpc 隧道'
  Get-Process -Name frpc -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Milliseconds 1000
  Ensure-Frpc | Out-Null
}

switch ($Action) {
  'status' { Show-Status; exit 0 }
  'ensure-services' {
    Write-Log '--- 守护：适配器 + 隧道 ---'
    Ensure-Adapter | Out-Null
    Ensure-Frpc | Out-Null
  }
  'ensure-all' {
    Write-Log '--- 开机全保：ComfyUI + 适配器 + 隧道 ---'
    Ensure-ComfyUI | Out-Null
    Ensure-Adapter | Out-Null
    Ensure-Frpc | Out-Null
  }
  'restart-adapter' { Restart-Adapter }
  'restart-frpc' { Restart-Frpc }
  'run-adapter' {
    # 计划任务 comfy-adapter 的动作：前台跑，输出进 adapter.log
    Set-Location $Root
    & $Python (Join-Path $Root 'app.py') *>> $AdapterLog
    exit $LASTEXITCODE
  }
  'run-frpc' {
    # 计划任务 comfy-frpc 的动作：前台跑，输出进 frpc-stdout.log
    Set-Location $Root
    & $FrpcExe -c $FrpcToml *>> $FrpcStdout
    exit $LASTEXITCODE
  }
}

if ($Action -like 'ensure-*') {
  if ($script:Problems -eq 0) { Write-Log '结论：可用' } else { Write-Log ('结论：还有 {0} 项没起来' -f $script:Problems) }
  exit $script:Problems
}
