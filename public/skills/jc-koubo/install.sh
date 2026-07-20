#!/usr/bin/env bash
set -euo pipefail

# Install this Skill into the shared Agent directory and optionally link it into
# agent-specific directories. The source directory remains the single copy.

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOME_DIR="${HOME:?HOME is not set}"
MODE="link"
TARGETS=()

usage() {
  cat <<'EOF'
用法:
  ./install.sh                 安装到 ~/.agents/skills/jc-koubo
  ./install.sh --codex         共享目录 + ~/.codex/skills/jc-koubo
  ./install.sh --claude        共享目录 + ~/.claude/skills/jc-koubo
  ./install.sh --all           共享目录 + 已存在的 Codex/Claude 目录
  ./install.sh --copy --all    使用复制而不是软链接
  ./install.sh --help          显示帮助
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --codex) TARGETS+=("codex"); shift ;;
    --claude) TARGETS+=("claude"); shift ;;
    --all) TARGETS+=("all"); shift ;;
    --copy) MODE="copy"; shift ;;
    --link) MODE="link"; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "未知参数: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ ${#TARGETS[@]} -eq 0 ]]; then
  TARGETS=("shared")
fi

has_target() {
  local wanted="$1"
  for target in "${TARGETS[@]}"; do
    [[ "$target" == "$wanted" || "$target" == "all" ]] && return 0
  done
  return 1
}

install_shared() {
  local destination="$HOME_DIR/.agents/skills/jc-koubo"
  mkdir -p "$(dirname "$destination")"
  install_one "$destination" "shared"
}

install_one() {
  local destination="$1"
  local label="$2"
  if [[ "$destination" == "$SOURCE_DIR" ]]; then
    echo "[$label] 已经是源目录，跳过"
    return
  fi
  if [[ -e "$destination" || -L "$destination" ]]; then
    if [[ "$MODE" == "link" && -L "$destination" && "$(readlink "$destination")" == "$SOURCE_DIR" ]]; then
      echo "[$label] 已存在正确软链接: $destination"
      return
    fi
    echo "[$label] 目标已存在，拒绝覆盖: $destination" >&2
    echo "[$label] 请先手动移走目标，或使用一个新的 HOME/目标目录重试。" >&2
    exit 3
  fi
  if [[ "$MODE" == "link" ]]; then
    ln -s "$SOURCE_DIR" "$destination"
  else
    cp -R "$SOURCE_DIR" "$destination"
  fi
  echo "[$label] 已安装: $destination ($MODE)"
}

install_shared

if has_target codex && ! has_target all; then
  mkdir -p "$HOME_DIR/.codex/skills"
  install_one "$HOME_DIR/.codex/skills/jc-koubo" "codex"
fi

if has_target claude && ! has_target all; then
  mkdir -p "$HOME_DIR/.claude/skills"
  install_one "$HOME_DIR/.claude/skills/jc-koubo" "claude"
fi

if has_target all; then
  [[ -d "$HOME_DIR/.codex/skills" ]] && install_one "$HOME_DIR/.codex/skills/jc-koubo" "codex"
  [[ -d "$HOME_DIR/.claude/skills" ]] && install_one "$HOME_DIR/.claude/skills/jc-koubo" "claude"
fi

echo "安装完成。源目录: $SOURCE_DIR"
