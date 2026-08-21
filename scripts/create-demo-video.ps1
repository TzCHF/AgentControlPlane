param(
  [string]$OutDir = (Join-Path $PSScriptRoot '..\dist'),
  [string]$TaskId = 'c3aaa988-95a0-44ae-a646-090cd60ab105'
)

$ErrorActionPreference = 'Stop'
$resolvedOut = [System.IO.Path]::GetFullPath($OutDir)
[System.IO.Directory]::CreateDirectory($resolvedOut) | Out-Null
$pptxPath = Join-Path $resolvedOut 'agent-control-plane-v0.9.0-demo-source.pptx'
$videoPath = Join-Path $resolvedOut 'agent-control-plane-v0.9.0-demo.mp4'

$powerPoint = $null
$presentation = $null

function Add-TextBox {
  param($Slide, [string]$Text, [float]$Left, [float]$Top, [float]$Width, [float]$Height,
    [float]$Size = 24, [int]$Color = 0xE7EAF3, [string]$Font = 'Aptos', [bool]$Bold = $false)
  $shape = $Slide.Shapes.AddTextbox(1, $Left, $Top, $Width, $Height)
  $shape.TextFrame.TextRange.Text = $Text
  $shape.TextFrame.TextRange.Font.Name = $Font
  $shape.TextFrame.TextRange.Font.Size = $Size
  $shape.TextFrame.TextRange.Font.Bold = [int]$Bold
  $shape.TextFrame.TextRange.Font.Color.RGB = $Color
  $shape.TextFrame.MarginLeft = 0
  $shape.TextFrame.MarginRight = 0
  $shape.TextFrame.MarginTop = 0
  $shape.TextFrame.MarginBottom = 0
  return $shape
}

function Add-DemoSlide {
  param($Presentation, [string]$Kicker, [string]$Title, [string[]]$Lines, [string]$Footer)
  $slide = $Presentation.Slides.Add($Presentation.Slides.Count + 1, 12)
  $slide.FollowMasterBackground = 0
  $slide.Background.Fill.ForeColor.RGB = 0x18130E
  $slide.Background.Fill.Solid()

  $accent = $slide.Shapes.AddShape(1, 44, 38, 8, 54)
  $accent.Fill.ForeColor.RGB = 0xF3A45B
  $accent.Fill.Solid()
  $accent.Line.Visible = 0
  Add-TextBox $slide $Kicker 68 40 800 22 13 0x9C958D 'Aptos' $true | Out-Null
  Add-TextBox $slide $Title 68 68 820 62 30 0xF4F1EB 'Aptos Display' $true | Out-Null

  $terminal = $slide.Shapes.AddShape(5, 68, 154, 824, 300)
  $terminal.Fill.ForeColor.RGB = 0x27211B
  $terminal.Fill.Solid()
  $terminal.Line.ForeColor.RGB = 0x51473E
  $terminal.Line.Weight = 1
  $dots = $slide.Shapes.AddShape(9, 88, 172, 10, 10)
  $dots.Fill.ForeColor.RGB = 0x6A625B
  $dots.Line.Visible = 0
  $dots2 = $slide.Shapes.AddShape(9, 106, 172, 10, 10)
  $dots2.Fill.ForeColor.RGB = 0xA58C6B
  $dots2.Line.Visible = 0
  $dots3 = $slide.Shapes.AddShape(9, 124, 172, 10, 10)
  $dots3.Fill.ForeColor.RGB = 0x5C9B82
  $dots3.Line.Visible = 0
  Add-TextBox $slide ($Lines -join "`r`n") 94 206 758 220 18 0xD7D3CC 'Cascadia Mono' $false | Out-Null
  Add-TextBox $slide $Footer 68 486 824 34 14 0x9C958D 'Aptos' $false | Out-Null
  $slide.SlideShowTransition.AdvanceOnTime = -1
  $slide.SlideShowTransition.AdvanceTime = 9
  return $slide
}

try {
  $powerPoint = New-Object -ComObject PowerPoint.Application
  $powerPoint.Visible = -1
  $presentation = $powerPoint.Presentations.Add()
  $presentation.PageSetup.SlideWidth = 960
  $presentation.PageSetup.SlideHeight = 540

  Add-DemoSlide $presentation '90-SECOND VERIFIED DEMO' 'AgentControlPlane v0.9.0' @(
    'Web AI -> MCP control plane -> local coding agent',
    '',
    'One task. One persisted result. One inspectable workspace.'
  ) 'Recorded from the verified OpenCode release run.' | Out-Null

  Add-DemoSlide $presentation 'FLOW' 'Dispatch path' @(
    'ChatGPT / DeepSeek / Claude web conversation',
    '  -> AgentControlPlane MCP tools',
    '  -> OpenCode / Codex / Claude Code / model endpoint',
    '  -> local workspace + structured evidence'
  ) 'Executor selection and model selection remain explicit.' | Out-Null

  Add-DemoSlide $presentation 'COMMAND' 'Start one confirmed task' @(
    'npm run demo -- --executor opencode `',
    '  --model opencode/mimo-v2.5-free --yes `',
    '  --timeout-seconds 600'
  ) 'The command starts an isolated loopback MCP server.' | Out-Null

  Add-DemoSlide $presentation 'DISCOVERY' 'Selected execution route' @(
    'AgentControlPlane live demo',
    'executor: opencode',
    'model: opencode/mimo-v2.5-free',
    'workspace: .acp-demo\run-qLG0M9'
  ) 'The demo preserves its workspace for inspection.' | Out-Null

  Add-DemoSlide $presentation 'DISPATCH' 'Task created through MCP' @(
    "task: $TaskId",
    'status: running',
    '',
    'objective: create and verify hello.txt'
  ) 'The task id links execution, status, result, usage, and audit records.' | Out-Null

  Add-DemoSlide $presentation 'LOCAL EXECUTION' 'OpenCode writes the requested file' @(
    'file: .acp-demo\run-qLG0M9\hello.txt',
    'content: AgentControlPlane demo OK',
    '',
    'changed files: hello.txt'
  ) 'The executor reads the file after writing it.' | Out-Null

  Add-DemoSlide $presentation 'RESULT' 'Terminal state and evidence' @(
    'status: completed',
    'verified: true',
    'file exists: true',
    'content matches: true'
  ) 'AgentControlPlane returns structured evidence to the controller.' | Out-Null

  Add-DemoSlide $presentation 'USAGE' 'Measured execution cost' @(
    'usage: 10,148 tokens reported',
    'profile: economy',
    'subagents: 0',
    'result persisted: true'
  ) 'The controller can inspect usage before selecting later routes.' | Out-Null

  Add-DemoSlide $presentation 'CONTINUATION' 'Executor-neutral project history' @(
    'logical task id: stable',
    'executor history: append-only',
    'continuation package: compact evidence',
    'automatic reroute: disabled by default'
  ) 'A follow-up can continue through the same executor or an explicit alternative.' | Out-Null

  Add-DemoSlide $presentation 'RELEASE' 'Inspect and reproduce the run' @(
    'npm run verify',
    'npm run release:package',
    'Get-FileHash dist\*.zip -Algorithm SHA256',
    '',
    'github.com/Ya-KARAS/AgentControlPlane'
  ) 'Release assets include source, browser companion, video, and SHA256SUMS.' | Out-Null

  $presentation.SaveAs($pptxPath)
  $presentation.CreateVideo($videoPath, $true, 9, 720, 30, 85)
  $deadline = (Get-Date).AddMinutes(15)
  while ($presentation.CreateVideoStatus -in @(1, 2) -and (Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
  }
  if ($presentation.CreateVideoStatus -ne 3 -or -not (Test-Path -LiteralPath $videoPath)) {
    throw "PowerPoint video export failed with status $($presentation.CreateVideoStatus)."
  }
  Write-Output "Demo source: $pptxPath"
  Write-Output "Demo video: $videoPath"
} finally {
  if ($presentation) { $presentation.Close() }
  if ($powerPoint) { $powerPoint.Quit() }
  if ($presentation) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($presentation) }
  if ($powerPoint) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($powerPoint) }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
