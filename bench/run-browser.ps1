# Runs the browser benchmarks one after another, unattended, and writes each output to
# bench/results/. There is one results folder: a run replaces the previous run's logs
# (git history keeps the older ones), so links to the results never change.
#
#   powershell -ExecutionPolicy Bypass -File bench\run-browser.ps1
#   powershell -ExecutionPolicy Bypass -File bench\run-browser.ps1 -Node
#
# -Node also runs the Node.js benchmarks first and replaces their logs; without it the
# Node.js logs are kept. -SkipBuild skips the package build. -DryRun lists what would run.
# It builds the package, starts the server if port 8080 is free, keeps the PC awake while
# it runs, and stops the server it started at the end.

param(
	[switch] $Node,
	[switch] $SkipBuild,
	[switch] $DryRun
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$out = Join-Path $root 'bench/results'
New-Item -ItemType Directory -Force $out | Out-Null
$log = Join-Path $out 'run-log.txt'

$runs = @()
$runs += , @( 'bench.txt', @( 'bench/bench.mjs' ) )
$runs += , @( 'compat.txt', @( 'bench/compat.mjs' ) )
$runs += , @( 'math.txt', @( 'bench/math.mjs' ) )
$runs += , @( 'showcase-1280x720.txt', @( 'examples/showcase/check.mjs', '--measure', '--size=1280x720' ) )
$runs += , @( 'showcase-3840x2160.txt', @( 'examples/showcase/check.mjs', '--measure', '--size=3840x2160' ) )
$runs += , @( 'showcase100k-3840x2160.txt', @( 'examples/showcase/check.mjs', '--measure', '--counts=100000', '--modes=instanced', '--size=3840x2160' ) )
$runs += , @( 'compare-3840x2160.txt', @( 'examples/compare/measure.mjs', '--gpu', '--size=3840x2160' ) )

function Write-Log( $text ) {
	$line = '{0}  {1}' -f ( Get-Date -Format 'HH:mm:ss' ), $text
	Write-Host $line -ForegroundColor Cyan
	Add-Content -Path $log -Value $line -Encoding UTF8
}

if ( $DryRun ) {
	foreach ( $run in $runs ) { Write-Host ( 'node {0}  ->  {1}' -f ( $run[ 1 ] -join ' ' ), ( Join-Path $out $run[ 0 ] ) ) }
	return
}

# Remove the previous run's browser logs (and Node.js logs with -Node), so the folder never
# mixes sizes or engines from two runs.
$stale = @( 'run-log.txt', 'showcase-*.txt', 'showcase100k-*.txt', 'compare-*.txt' )
if ( $Node ) { $stale += @( 'bench.txt', 'compat.txt', 'math.txt' ) }
foreach ( $pattern in $stale ) { Remove-Item -Path ( Join-Path $out $pattern ) -Force -ErrorAction SilentlyContinue }

# Keep the PC (and display) awake until the script ends.
Add-Type -Namespace Wamr -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);'
[Wamr.Power]::SetThreadExecutionState( [uint32]'0x80000003' ) | Out-Null

function Stop-HeadlessBrowsers {
	Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'chrome|msedge' -and $_.CommandLine -like '*--headless*' -and $_.CommandLine -like '*wamr3d-*' } |
		ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Test-Server {
	try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 'http://localhost:8080/examples/showcase/' | Out-Null; return $true } catch { return $false }
}

$server = $null
try {
	Write-Log "results go to $out"

	if ( -not $SkipBuild ) {
		Write-Log 'building dist/wamr3d'
		$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
		& node engine/bindings/build.mjs
		if ( $LASTEXITCODE -ne 0 ) { Write-Log 'build failed, stopping'; return }
	}

	if ( Test-Server ) {
		Write-Log 'using the server already on port 8080'
	} else {
		Write-Log 'starting the server'
		$server = Start-Process node -ArgumentList 'examples/browser/serve.mjs' -WorkingDirectory $root -WindowStyle Hidden -PassThru
		for ( $i = 0; $i -lt 60 -and -not ( Test-Server ); $i ++ ) { Start-Sleep -Seconds 1 }
		if ( -not ( Test-Server ) ) { Write-Log 'server did not start, stopping'; return }
	}

	foreach ( $run in $runs ) {
		$file = Join-Path $out $run[ 0 ]
		$arguments = $run[ 1 ]
		# a server that died mid-run makes the browser checks wait forever
		if ( -not ( Test-Server ) ) {
			Write-Log 'server not answering, restarting it'
			if ( $server ) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
			$server = Start-Process node -ArgumentList 'examples/browser/serve.mjs' -WorkingDirectory $root -WindowStyle Hidden -PassThru
			for ( $i = 0; $i -lt 60 -and -not ( Test-Server ); $i ++ ) { Start-Sleep -Seconds 1 }
		}
		Stop-HeadlessBrowsers
		Write-Log ( 'running node {0}' -f ( $arguments -join ' ' ) )
		$started = Get-Date
		$lines = & node @arguments 2>&1 | ForEach-Object { $text = "$_"; Write-Host $text; $text }
		$code = $LASTEXITCODE
		# UTF-8 without a byte-order mark, as website/scripts/benchmark-data.mjs reads it
		[System.IO.File]::WriteAllText( $file, ( ( @( $lines ) -join "`n" ) + "`n" ), ( New-Object System.Text.UTF8Encoding $false ) )
		Write-Log ( 'finished in {0:N1} min, exit code {1}, wrote {2}' -f ( ( Get-Date ) - $started ).TotalMinutes, $code, $file )
	}

	Write-Log 'all runs done'
} finally {
	if ( $server ) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue; Write-Log 'stopped the server' }
	Stop-HeadlessBrowsers
	[Wamr.Power]::SetThreadExecutionState( [uint32]'0x80000000' ) | Out-Null
}
