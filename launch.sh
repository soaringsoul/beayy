#!/usr/bin/env bash
# Beayy 本机启停：start / restart / exit（stop 同 exit）
# 关窗口只会进菜单栏后台；真正退出用本脚本的 exit，或托盘「退出」。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BUNDLE_ID="com.fengli.beayy"
EXE_NAME="beayy"

usage() {
  cat <<'USAGE'
用法：./launch.sh start | restart | exit | stop

  start    启动已安装的 Beayy（优先 /Applications，其次 ~/Applications）
  restart  先退出再启动
  exit     真正退出进程（不是关窗口；关窗仍进菜单栏）
  stop     同 exit

说明：若两处都没有 .app，会尝试用仓库里的 release 二进制；再没有就提示先 ./build.sh --install。
USAGE
}

app_path() {
  if [[ -d "/Applications/Beayy.app" ]]; then
    echo "/Applications/Beayy.app"
  elif [[ -d "${HOME}/Applications/Beayy.app" ]]; then
    echo "${HOME}/Applications/Beayy.app"
  else
    return 1
  fi
}

# 正在跑的 Beayy 主进程 PID（只认 .app 里的 MacOS/beayy，避免误杀别的）
running_pids() {
  local pids=()
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    local pid="${line%% *}"
    local cmd="${line#* }"
    case "$cmd" in
      */Beayy.app/Contents/MacOS/beayy|*/Beayy.app/Contents/MacOS/beayy\ *)
        pids+=("$pid")
        ;;
      */target/*/beayy|*/target/*/beayy\ *)
        # 开发态 cargo 产物也算
        pids+=("$pid")
        ;;
    esac
  done < <(pgrep -lf "^${EXE_NAME}$|/${EXE_NAME}$|/${EXE_NAME} " 2>/dev/null || true)
  # pgrep -lf 有时匹配整行；再扫一遍精确路径
  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    local path
    path="$(ps -p "$pid" -o comm= 2>/dev/null || true)"
    case "$path" in
      */Beayy.app/Contents/MacOS/beayy|*/target/*/beayy)
        local seen=0
        for x in "${pids[@]:-}"; do [[ "$x" == "$pid" ]] && seen=1 && break; done
        [[ $seen -eq 0 ]] && pids+=("$pid")
        ;;
    esac
  done < <(pgrep -x "$EXE_NAME" 2>/dev/null || true)
  printf '%s\n' "${pids[@]:-}" | awk 'NF' | sort -u
}

is_running() {
  local p
  p="$(running_pids)"
  [[ -n "$p" ]]
}

cmd_start() {
  if is_running; then
    echo "Beayy 已在运行（PID：$(running_pids | tr '\n' ' '))"
    return 0
  fi
  local app
  if app="$(app_path)"; then
    echo "启动 $app"
    open -a "$app"
    return 0
  fi
  # 没有安装包：尝试仓库 release 二进制
  local bin=""
  for c in \
    "$ROOT/src-tauri/target/release/beayy" \
    "$ROOT/target/release/beayy" \
    "$ROOT/src-tauri/target/debug/beayy" \
    "$ROOT/target/debug/beayy"
  do
    if [[ -x "$c" ]]; then bin="$c"; break; fi
  done
  if [[ -n "$bin" ]]; then
    echo "未找到 Beayy.app，改用 $bin"
    nohup "$bin" >/dev/null 2>&1 &
    echo "已后台启动 PID $!"
    return 0
  fi
  echo "找不到已安装的 Beayy.app，也没有编译好的 beayy。" >&2
  echo "请先：./build.sh --install" >&2
  return 1
}

cmd_exit() {
  if ! is_running; then
    echo "Beayy 没在运行"
    return 0
  fi
  echo "正在退出 Beayy…"
  # 优先走 AppleEvent quit（会触发 RunEvent::Exit，落盘 app.quit）
  osascript -e "tell application id \"${BUNDLE_ID}\" to quit" >/dev/null 2>&1 || true
  # 等最多 5 秒
  local i
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if ! is_running; then
      echo "已退出"
      return 0
    fi
    sleep 0.5
  done
  # 仍在：只杀 Beayy.app / 本仓库 target 下的 beayy
  local pid path
  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    path="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    case "$path" in
      */Beayy.app/Contents/MacOS/beayy*|*/MyLocalAIWorkstation/beayy/*/beayy*|*/beayy/src-tauri/target/*/beayy*|*/beayy/target/*/beayy*)
        echo "强制结束 PID $pid"
        kill "$pid" 2>/dev/null || true
        ;;
      *)
        echo "跳过不像 Beayy 的进程 PID $pid：$path" >&2
        ;;
    esac
  done < <(running_pids)
  sleep 0.5
  if is_running; then
    echo "仍有进程未退尽：$(running_pids | tr '\n' ' ')" >&2
    return 1
  fi
  echo "已退出"
}

cmd_restart() {
  cmd_exit || true
  sleep 0.3
  cmd_start
}

main() {
  local cmd="${1:-}"
  case "$cmd" in
    start) cmd_start ;;
    restart) cmd_restart ;;
    exit|stop) cmd_exit ;;
    -h|--help|help|"") usage; [[ -n "$cmd" ]] || exit 1 ;;
    *) echo "未知命令：$cmd" >&2; usage; exit 1 ;;
  esac
}

main "$@"
