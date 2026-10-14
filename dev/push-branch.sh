#!/usr/bin/env bash
# ============================================================================
# dev/push-branch.sh — 沙箱 git 直连不通时，通过 GitHub Git Data API 推送分支
#
# 背景：本机 git https 直连报 schannel: CRYPT_E_NO_REVOCATION_CHECK（实测无解），
#      但 gh CLI 通道正常。本脚本用 gh api 完成 blob/tree/commit/ref 全流程。
#      脚本自包含：默认从自身位置推断仓库目录，无需硬编码路径。
#
# 用法：
#   COMMIT_MSG="提交说明（单行，别带英文双引号）" bash dev/push-branch.sh <branch> <manifest.tsv> [base]
#   DRY_RUN=1 COMMIT_MSG="演练" bash dev/push-branch.sh whatever manifest.tsv   # 只建 commit 不建分支
#
# manifest.tsv 每行一条：<A|M|D>\t<仓库内相对路径>
#   A = 新增   M = 修改   D = 删除
#   路径相对仓库根，不要带头尾空格；文件内容从工作区读取。
#
# 可选环境变量：
#   REPO_DIR   工作副本目录（默认：脚本所在目录的上一级）
#   REPO       GitHub 仓库（默认 EraserPlus/eraser-site）
#
# 注意：Node 在本沙箱不能创建子进程（EBUSY），所以纯 Bash 实现；
#      JSON 请求体用 base64 + printf 拼，路径均为 ASCII 安全字符。
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${REPO_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
R="${REPO:-EraserPlus/eraser-site}"
BRANCH="${1:?用法: push-branch.sh <branch> <manifest.tsv> [base]}"
MANIFEST="${2:?缺少 manifest.tsv}"
BASE="${3:-main}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK" 2>/dev/null || true' EXIT   # 沙箱可能拦 rm，清理失败不影响推送结果
cd "$REPO_DIR"

BASE_SHA="$(gh api "repos/$R/git/refs/heads/$BASE" --jq .object.sha)"
BASE_TREE="$(gh api "repos/$R/git/commits/$BASE_SHA" --jq .tree.sha)"

# 父节点与 tree 基底的选择（关键）：
#   分支已存在 → 以分支当前头为父、分支当前树为基底（增量推送，不清空分支上已有的改动）
#   分支不存在 → 以 base 为父、base 树为基底（首次推送）
if gh api "repos/$R/git/refs/heads/$BRANCH" --jq .object.sha >/dev/null 2>&1; then
  PARENT_SHA="$(gh api "repos/$R/git/refs/heads/$BRANCH" --jq .object.sha)"
  TREE_BASE="$(gh api "repos/$R/git/commits/$PARENT_SHA" --jq .tree.sha)"
  echo "增量推送：父=分支头 $PARENT_SHA（tree 基底取分支当前树）"
else
  PARENT_SHA="$BASE_SHA"
  TREE_BASE="$BASE_TREE"
  echo "首次推送：父=$BASE @ $BASE_SHA"
fi

ENTRIES=""
first=1
while IFS=$'\t' read -r st path; do
  [ -z "${st:-}" ] && continue
  path="${path%$'\r'}"          # 防清单文件是 CRLF
  [ -z "$path" ] && continue
  if [ "$st" = "D" ]; then
    entry="{\"path\":\"$path\",\"mode\":\"100644\",\"type\":\"blob\",\"sha\":null}"
    echo "  D  $path"
  else
    [ -f "$path" ] || { echo "文件不存在: $path" >&2; exit 1; }
    b64="$(base64 -w0 "$path")"
    printf '{"encoding":"base64","content":"%s"}' "$b64" > "$WORK/blob.json"
    sha=""
    for i in 1 2 3 4 5; do
      sha="$(gh api "repos/$R/git/blobs" --method POST --input "$WORK/blob.json" --jq .sha 2>/dev/null || true)"
      [ -n "$sha" ] && break
      echo "  blob 重试 ($i): $path" >&2
      sleep 2
    done
    [ -n "$sha" ] || { echo "建 blob 失败: $path" >&2; exit 1; }
    entry="{\"path\":\"$path\",\"mode\":\"100644\",\"type\":\"blob\",\"sha\":\"$sha\"}"
    echo "  $st  $path -> ${sha:0:10}"
  fi
  if [ $first -eq 1 ]; then ENTRIES="$entry"; first=0; else ENTRIES="$ENTRIES,$entry"; fi
done < "$MANIFEST"

printf '{"base_tree":"%s","tree":[%s]}' "$TREE_BASE" "$ENTRIES" > "$WORK/tree.json"
TREE_SHA="$(gh api "repos/$R/git/trees" --method POST --input "$WORK/tree.json" --jq .sha)"
echo "tree = $TREE_SHA"

MSG="${COMMIT_MSG:-通过 API 更新站点文件}"
msg="${MSG//\\/\\\\}"; msg="${msg//\"/\\\"}"; msg="${msg//$'\n'/\\n}"
printf '{"message":"%s","tree":"%s","parents":["%s"]}' "$msg" "$TREE_SHA" "$PARENT_SHA" > "$WORK/commit.json"
COMMIT_SHA="$(gh api "repos/$R/git/commits" --method POST --input "$WORK/commit.json" --jq .sha)"
echo "commit = $COMMIT_SHA"

if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "DRY_RUN：未创建分支。改动对比：https://github.com/$R/compare/$BASE...$COMMIT_SHA"
  exit 0
fi

if gh api "repos/$R/git/refs/heads/$BRANCH" --jq .ref >/dev/null 2>&1; then
  printf '{"sha":"%s","force":false}' "$COMMIT_SHA" > "$WORK/ref.json"
  gh api "repos/$R/git/refs/heads/$BRANCH" --method PATCH --input "$WORK/ref.json" >/dev/null
  echo "分支已更新: $BRANCH"
else
  printf '{"ref":"refs/heads/%s","sha":"%s"}' "$BRANCH" "$COMMIT_SHA" > "$WORK/ref.json"
  gh api "repos/$R/git/refs" --method POST --input "$WORK/ref.json" >/dev/null
  echo "分支已创建: $BRANCH"
fi
echo "改动对比: https://github.com/$R/compare/$BASE...$BRANCH"
