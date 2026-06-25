@echo off
REM CrewClaw stage launcher - forwards to the prebuilt static crewclaw.exe.
REM Usage: crew hire <agent> | crew verify | crew fire <agent> [--ascii]
set "CREWCLAW_ROOT=C:\Users\12117\Playground\crewclaw\crewhire"
"%CREWCLAW_ROOT%\crewclaw.exe" %*
