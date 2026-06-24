@echo off
REM 解决Win7中文乱码问题（Win7默认编码兼容）
chcp 65001 >nul 2>&1

REM 判断是否以隐藏模式启动，避免无限循环
if "%1"=="hidden" goto run_node

REM Win7兼容的VBScript隐藏调用（拆分命令，避免&&兼容性问题）
mshta vbscript:CreateObject("WScript.Shell").Run("""%~f0"" hidden",0)(window.close)
exit

:run_node
REM 切换到脚本所在目录（Win7必须确保路径无空格解析问题）
cd /d "%~dp0"

REM 隐藏运行node server（Win7重定向输出兼容写法）
node server >nul 2>&1

REM 防止脚本退出（Win7下pause >nul更稳定）
pause >nul