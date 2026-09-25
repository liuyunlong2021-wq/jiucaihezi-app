#!/usr/bin/env bash
# 把下载服务器上的旧版本安装包删掉，只留最近的 N 个（默认 5），防止 800MB 级的
# 安装包把磁盘吃满。
#
# 用法：bash prune-updates.sh [目录] [保留数量]
#   bash prune-updates.sh /opt/updates 5
#
# CI 在 publish-download-manifest 里用 `ssh ... "bash -s /opt/updates 5" < 本脚本`
# 调用：新版本已上传成功之后才执行，所以清掉的永远只是旧版本。
#
# 两条硬约束（改这个脚本时不要拆掉）：
#   1. 只删「目录名形如 2.2.1」的目录；latest.json、backup 等其它东西一概不碰。
#   2. 永不删 latest.json 指向的那个版本：它排在保留名额之外也必须留下，否则
#      下载页与 App 的版本提示会指向一个不存在的目录。
set -euo pipefail

DIR="${1:-/opt/updates}"
KEEP="${2:-5}"

case "$KEEP" in
  '' | *[!0-9]*) echo "保留数量必须是正整数，收到：$KEEP" >&2; exit 2 ;;
esac
[ -d "$DIR" ] || { echo "目录不存在：$DIR" >&2; exit 1; }

# latest.json 里的 version 就是当前在用的版本（CI 每次发布覆盖这个单文件）
PINNED="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
  "$DIR/latest.json" 2>/dev/null | head -1 | sed 's/^v//')"

versions="$(
  cd "$DIR" && ls -1d */ 2>/dev/null | sed 's#/$##' \
    | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' \
    | sort -t. -k1,1n -k2,2n -k3,3n || true
)"
total="$(printf '%s' "$versions" | grep -c . || true)"

if [ "$total" -eq 0 ]; then
  echo "没有可识别的版本目录，未做任何改动：$DIR"
  exit 0
fi
if [ "$total" -le "$KEEP" ]; then
  echo "只有 $total 个版本（保留上限 ${KEEP}），无需清理"
  exit 0
fi

# 由旧到新排序后取前 total-KEEP 个，再摘掉被 latest.json 钉住的那个
drop="$(
  printf '%s\n' "$versions" \
    | awk -v keep="$KEEP" '{ at[NR] = $0 } END { for (i = 1; i <= NR - keep; i++) print at[i] }' \
    | grep -v -x -F "${PINNED:-__jc_no_pinned_version__}" || true
)"

if [ -z "$drop" ]; then
  echo "待删列表为空（旧版本都被 latest.json 钉住），未做任何改动"
  exit 0
fi

echo "保留最近 $KEEP 个版本；latest.json 指向 ${PINNED:-未知}，已钉住"
while IFS= read -r name; do
  [ -n "$name" ] || continue
  case "$name" in
    *[!0-9.]*) echo "跳过非版本目录：$name"; continue ;;
  esac
  echo "删除旧版本：$DIR/$name"
  rm -rf "${DIR:?}/${name}"
done <<< "$drop"

echo "清理后 $DIR 内容："
ls -1 "$DIR"
