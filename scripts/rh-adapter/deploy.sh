#!/bin/bash
# rh-adapter 一键部署脚本
# 在服务器上执行: bash deploy.sh

set -e

ADAPTER_DIR="/opt/rh-adapter"
echo "=== 部署 rh-adapter → ${ADAPTER_DIR} ==="

# 1. 创建目录
mkdir -p "${ADAPTER_DIR}"

# 2. 复制适配器文件
cp server.mjs "${ADAPTER_DIR}/"

# 3. 配置环境变量（如果不存在则创建）
if [ ! -f "${ADAPTER_DIR}/.env" ]; then
  echo "请输入 RunningHub API Key (32位):"
  read -r RH_KEY
  cat > "${ADAPTER_DIR}/.env" << EOF
PORT=8789
RUNNINGHUB_API_KEY=${RH_KEY}
EOF
  echo "✓ .env 已创建"
else
  echo "✓ .env 已存在，跳过"
fi

# 4. 安装 systemd 服务
cp rh-adapter.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable rh-adapter
systemctl restart rh-adapter

echo ""
echo "=== 验证 ==="
sleep 2
systemctl status rh-adapter --no-pager | head -10
echo ""
curl -s http://127.0.0.1:8789/health | python3 -m json.tool 2>/dev/null || echo "健康检查失败，查看日志: journalctl -u rh-adapter -f"

echo ""
echo "=== NewAPI Channel SQL (在 PostgreSQL 中执行) ==="
echo ""
cat << 'SQLEOF'
-- 图片 Channel
INSERT INTO channels (type, name, models, base_url, "key", "group", status, created_at, updated_at)
VALUES (1, 'RH-图片', 'rh-pro-image,rh-gpt2-image,rh-gpt2-text',
        'http://127.0.0.1:8789', 'sk-rh-adapter', '1', 1, NOW(), NOW())
ON CONFLICT DO NOTHING;

-- 视频 Channel
INSERT INTO channels (type, name, models, base_url, "key", "group", status, created_at, updated_at)
VALUES (1, 'RH-视频', 'rh-seedance2,rh-video-v31-fast,rh-grok-text-video,rh-grok-image-video,rh-grok-video-edit,rh-mimic,rh-digital-human-fast,rh-digital-human,grok-video-3',
        'http://127.0.0.1:8789', 'sk-rh-adapter', '1', 1, NOW(), NOW())
ON CONFLICT DO NOTHING;

-- 音频 Channel
INSERT INTO channels (type, name, models, base_url, "key", "group", status, created_at, updated_at)
VALUES (1, 'RH-音频', 'rh-voice-clone,rh-voice-design',
        'http://127.0.0.1:8789', 'sk-rh-adapter', '1', 1, NOW(), NOW())
ON CONFLICT DO NOTHING;
SQLEOF

echo ""
echo "=== 部署完成 ==="
echo "检查 NewAPI 渠道: docker exec \$(docker ps -q -f name=postgres) bash -c \"PGPASSWORD='JiucaiheziPostgres_2026!' psql -h localhost -U newapi -d new-api -c 'SELECT id, name, models, status FROM channels WHERE name LIKE ''RH-%'';'\""
