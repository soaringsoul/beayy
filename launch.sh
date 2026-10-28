#!/usr/bin/env bash
# Beayy 本机启停（默认＝本地开发／测试版，不是已安装的正式 Beayy.app）
#
# 本仓库没有 npm／cargo-tauri；开发流程见 README：./build.sh → ~/Applications/Beayy-rs.app（BEAYY_SHADOW=1）
#
# 用法：./launch.sh start | restart | exit | stop | start-app
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
export PATH="/opt/homebrew/opt/rustup/bin:${HOME}/.cargo/bin:${PATH}"

LAUNCH_DIR="$ROOT/.launch"
PID_FILE="$LAUNCH_DIR/dev.pid"
LOG_FILE="$LAUNCH_DIR/dev.log"
DEV_APP="${HOME}/Applications/Beayy-rs.app"
DEV_BIN="$DEV_APP/Contents/MacOS/beayy"
# 正式版路径：exit 时绝不能动
PROD_APPS=("/Applications/Beayy.app" "${HOME}/Applications/Beayy.app")

usage() {
  cat <<'USAGE'
用法：./launch.sh <命令>

  start      本地开发环境：编译测试版（./build.sh --no-run）并后台启动 Beayy-rs
             （影子目录 BEAYY_SHADOW=1，不碰正式数据；日志 .launch/dev.log）
  restart    先 exit 再 start
  exit|stop  结束本次开发进程（只杀 Beayy-rs／本脚本起的进程，不动正式 Beayy.app）
  start-app  可选：打开已安装的正式版（/Applications 或 ~/Applications 的 Beayy.app）

说明：关主窗口仍进菜单栏后台；真正退出开发实例用 exit／托盘「退出」。
USAGE
}

ensure_launch_dir() {
  mkdir -p "$LAUNCH_DIR"
}

# 读 PID 文件：进程还在且命令行像我们起的开发实例
pid_alive() {
  local pid="${1:-}"
  [[ -n "$pid" ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
}

is_dev_cmdline() {
  local cmd="$1"
  case "$cmd" in
    */Beayy-rs.app/Contents/MacOS/beayy*|*/MyLocalAIWorkstation/beayy/*/beayy*|*/beayy/target/*/beayy*|*/beayy/src-tauri/target/*/beayy*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

# 当前开发实例 PID 列表（不含正式版 Beayy.app）
dev_pids() {
  local out=()
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(tr -d '[:space:]' < "$PID_FILE" || true)"
    if pid_alive "$pid"; then
      local cmd
      cmd="$(ps -p "$pid" -o command= 2>/dev/null || true)"
      # 编译阶段 PID 是 bash 包装；跑起来后是 beayy
      if is_dev_cmdline "$cmd" || [[ "$cmd" == *"build.sh"* ]] || [[ "$cmd" == *"launch.sh"* ]] || [[ "$cmd" == *"/bin/bash"* && "$cmd" == *"Beayy-rs"* ]]; then
        out+=("$pid")
      fi
    fi
  fi
  local pid cmd
  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    cmd="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    # 只认测试版路径
    case "$cmd" in
      */Beayy-rs.app/Contents/MacOS/beayy*)
        local seen=0 x
        for x in "${out[@]:-}"; do [[ "$x" == "$pid" ]] && seen=1 && break; done
        [[ $seen -eq 0 ]] && out+=("$pid")
        ;;
    esac
  done < <(pgrep -f '/Beayy-rs\.app/Contents/MacOS/beayy' 2>/dev/null || true)
  printf '%s\n' "${out[@]:-}" | awk 'NF' | sort -u
}

is_dev_running() {
  local p
  p="$(dev_pids)"
  [[ -n "$p" ]]
}

cmd_start() {
  ensure_launch_dir
  if is_dev_running; then
    echo "本地开发环境已在运行（PID：$(dev_pids | tr '\n' ' '))"
    echo "日志：$LOG_FILE"
    return 0
  fi

  echo "启动本地开发环境（./build.sh --no-run → Beayy-rs，影子目录）…"
  echo "日志：$LOG_FILE"
  {
    echo "======== $(date '+%Y-%m-%d %H:%M:%S %z') launch.sh start ========"
  } >> "$LOG_FILE"

  # 同一进程组：先编译安装测试版，再 exec 测试版二进制（PID 文件始终指向这一条链）
  # 用 setsid/新会话在 macOS 上不统一；这里用 bash + exec，PID 在 exec 后仍是同一个。
  nohup bash -c '
    set -euo pipefail
    ROOT="'"$ROOT"'"
    DEV_BIN="'"$DEV_BIN"'"
    LOG="'"$LOG_FILE"'"
    cd "$ROOT"
    export PATH="/opt/homebrew/opt/rustup/bin:${HOME}/.cargo/bin:${PATH}"
    echo "[launch] 编译并安装测试版 Beayy-rs.app …" >>"$LOG"
    if ! ./build.sh --no-run >>"$LOG" 2>&1; then
      echo "[launch] build.sh 失败，见日志" >>"$LOG"
      exit 1
    fi
    if [[ ! -x "$DEV_BIN" ]]; then
      echo "[launch] 找不到 $DEV_BIN" >>"$LOG"
      exit 1
    fi
    echo "[launch] 启动 $DEV_BIN --open（BEAYY_SHADOW=1）" >>"$LOG"
    export BEAYY_SHADOW=1
    exec "$DEV_BIN" --open
  ' >>"$LOG_FILE" 2>&1 &
  local wrapper_pid=$!
  echo "$wrapper_pid" > "$PID_FILE"
  echo "已后台启动（PID $wrapper_pid）。编译完成后会弹出「Beayy 测试版」。"
  echo "查看进度：tail -f $LOG_FILE"
}

cmd_exit() {
  ensure_launch_dir
  local pids
  pids="$(dev_pids)"
  if [[ -z "$pids" ]]; then
    echo "本地开发环境没在运行"
    rm -f "$PID_FILE"
    return 0
  fi

  echo "正在退出本地开发环境（不动正式 Beayy.app）…"
  local pid cmd
  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    cmd="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    # 双保险：绝不杀正式版路径
    case "$cmd" in
      */Applications/Beayy.app/Contents/MacOS/beayy*|*/Applications/Beayy.app/*)
        echo "跳过正式版进程 PID $pid" >&2
        continue
        ;;
    esac
    for prod in "${PROD_APPS[@]}"; do
      case "$cmd" in
        "$prod"/Contents/MacOS/beayy*|"$prod"/*)
          echo "跳过正式版进程 PID $pid" >&2
          continue 2
          ;;
      esac
    done
    echo "结束 PID $pid"
    # 先温和再强杀；杀掉进程组里的子进程（编译中的 cargo 等）
    kill "$pid" 2>/dev/null || true
    # 若还挂着子进程树
    pkill -P "$pid" 2>/dev/null || true
  done <<< "$pids"

  # 再清一遍只认 Beayy-rs 路径的残留
  pkill -f '/Beayy-rs\.app/Contents/MacOS/beayy' 2>/dev/null || true

  local i
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if ! is_dev_running; then
      rm -f "$PID_FILE"
      echo "已退出开发环境"
      return 0
    fi
    sleep 0.3
  done

  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    kill -9 "$pid" 2>/dev/null || true
  done < <(dev_pids)
  pkill -9 -f '/Beayy-rs\.app/Contents/MacOS/beayy' 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "已强制退出开发环境"
}

cmd_restart() {
  cmd_exit || true
  sleep 0.4
  cmd_start
}

cmd_start_app() {
  local app=""
  if [[ -d "/Applications/Beayy.app" ]]; then
    app="/Applications/Beayy.app"
  elif [[ -d "${HOME}/Applications/Beayy.app" ]]; then
    app="${HOME}/Applications/Beayy.app"
  else
    echo "找不到已安装的 Beayy.app。正式版请用 ./build.sh --install 或 Releases 安装包。" >&2
    return 1
  fi
  echo "启动正式版 $app"
  open -a "$app"
}

main() {
  local cmd="${1:-}"
  case "$cmd" in
    start) cmd_start ;;
    restart) cmd_restart ;;
    exit|stop) cmd_exit ;;
    start-app) cmd_start_app ;;
    -h|--help|help) usage ;;
    "") usage; exit 1 ;;
    *) echo "未知命令：$cmd" >&2; usage; exit 1 ;;
  esac
}

main "$@"
