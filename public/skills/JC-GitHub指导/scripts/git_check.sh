#!/bin/bash

# GitHub 环境检查脚本 - 帮小白排查 Git 配置、SSH Key 等常见问题

echo "=========================================="
echo "  GitHub 环境检查"
echo "=========================================="
echo ""

# ---------- 1. 检查 Git 是否安装 ----------
if ! command -v git &> /dev/null; then
    echo "❌ 未检测到 Git。"
    echo "   请去 https://git-scm.com/ 下载安装。"
    exit 1
fi

echo "✅ Git 已安装: $(git --version)"

# ---------- 2. 检查用户名和邮箱 ----------
echo ""
echo "--- Git 用户配置 ---"
USER_NAME=$(git config --global user.name)
USER_EMAIL=$(git config --global user.email)

if [ -z "$USER_NAME" ]; then
    echo "⚠️  未配置用户名。运行："
    echo "   git config --global user.name \"你的名字\""
else
    echo "✅ 用户名: $USER_NAME"
fi

if [ -z "$USER_EMAIL" ]; then
    echo "⚠️  未配置邮箱。运行："
    echo "   git config --global user.email \"你的邮箱@example.com\""
else
    echo "✅ 邮箱:   $USER_EMAIL"
fi

# ---------- 3. 检查 SSH Key ----------
echo ""
echo "--- SSH Key 检查 ---"
SSH_KEY_PATH="$HOME/.ssh/id_ed25519"
SSH_KEY_RSA="$HOME/.ssh/id_rsa"

if [ -f "$SSH_KEY_PATH" ]; then
    echo "✅ 找到 ED25519 SSH Key: $SSH_KEY_PATH"
    HAS_SSH=true
elif [ -f "$SSH_KEY_RSA" ]; then
    echo "✅ 找到 RSA SSH Key: $SSH_KEY_RSA"
    HAS_SSH=true
else
    echo "⚠️  未找到 SSH Key。生成方法："
    echo "   ssh-keygen -t ed25519 -C \"你的GitHub邮箱\""
    echo "   然后去 GitHub Settings > SSH Keys 添加公钥"
    HAS_SSH=false
fi

# ---------- 4. 测试 GitHub SSH 连接 ----------
if [ "$HAS_SSH" = true ]; then
    echo ""
    echo "--- 测试 GitHub SSH 连接 ---"
    SSH_RESULT=$(ssh -T -o StrictHostKeyChecking=no -o ConnectTimeout=5 git@github.com 2>&1)
    if echo "$SSH_RESULT" | grep -q "successfully authenticated"; then
        echo "✅ GitHub SSH 连接成功！"
    elif echo "$SSH_RESULT" | grep -q "Permission denied"; then
        echo "❌ SSH Key 存在但 GitHub 连接失败。"
        echo "   请确认已将公钥添加到 GitHub:"
        echo "   GitHub → Settings → SSH and GPG keys → New SSH key"
        echo ""
        echo "   你的公钥内容："
        if [ -f "$SSH_KEY_PATH.pub" ]; then
            cat "$SSH_KEY_PATH.pub"
        elif [ -f "$SSH_KEY_RSA.pub" ]; then
            cat "$SSH_KEY_RSA.pub"
        fi
    else
        echo "⚠️  GitHub SSH 测试返回异常："
        echo "   $SSH_RESULT"
    fi
fi

# ---------- 5. 检查当前目录是否是 Git 仓库 ----------
echo ""
echo "--- 当前目录检查 ---"
if git rev-parse --git-dir > /dev/null 2>&1; then
    echo "✅ 当前目录是一个 Git 仓库"
    REMOTE=$(git remote get-url origin 2>/dev/null || echo "未设置")
    echo "   远程地址: $REMOTE"
    BRANCH=$(git branch --show-current 2>/dev/null || echo "未知")
    echo "   当前分支: $BRANCH"
else
    echo "ℹ️  当前目录不是 Git 仓库（这不是错误，只是说明这里还没有用 Git 管理）"
fi

echo ""
echo "=========================================="
echo "  检查完成！"
echo "=========================================="
