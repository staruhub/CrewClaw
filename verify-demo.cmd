@echo off
REM CrewClaw roadshow launcher - runs the prebuilt static crewclaw.exe.
REM Usage: verify-demo.cmd [--ascii] [--live]
cd /d "%~dp0"
"%~dp0crewclaw.exe" verify %*
