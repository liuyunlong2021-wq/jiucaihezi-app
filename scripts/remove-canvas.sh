#!/bin/bash
# 韭菜盒子画布移除脚本
set -e
cd /Users/by3/Documents/jiucaihezi-app

echo "=== 1. 移走画布源码到 _canvas-archive ==="
mkdir -p _canvas-archive
mv src/components/canvas _canvas-archive/ 2>/dev/null || true
mv src/canvas _canvas-archive/ 2>/dev/null || true
mv src/stores/canvas*.ts _canvas-archive/ 2>/dev/null || true
mv src/types/canvas.ts _canvas-archive/ 2>/dev/null || true
mv docs/sdd/canvas-*.md _canvas-archive/ 2>/dev/null || true

echo "=== 2. 移除画布测试文件 ==="
rm -f src/components/__tests__/canvas*.test.ts 2>/dev/null || true

echo "=== 3. 清理 WorkspaceLayout.vue ==="
# 移除 canvasEnabled, CanvasWorkspace import, workspaceMode, showCanvasWorkspace
python3 -c "
import re
with open('src/layouts/WorkspaceLayout.vue', 'r') as f:
    content = f.read()

# 移除 import CanvasWorkspace
content = re.sub(r\"const CanvasWorkspace = defineAsyncComponent.*\n\", '', content)
# 移除 canvasEnabled
content = re.sub(r\"const canvasEnabled = ref\(true\)\n\", '', content)
# 移除 mobilePanel 中的 'canvas'
content = re.sub(r\"\\| 'canvas'\", '', content)
# 移除 workspaceMode canvas 类型
content = re.sub(r\"<'chat' \\| 'canvas'>\", \"<'chat'>\", content)
# 移除 showCanvasWorkspace 函数
content = re.sub(r'function showCanvasWorkspace\([^}]*\}', '', content, flags=re.DOTALL)
# 移除 onRailSwitch 中的 showCanvasWorkspace 调用
content = content.replace('showCanvasWorkspace()', '')
# 移除 switch-workspace-mode 中的 canvas 分支
content = re.sub(r\"\\s*// toggle.*showCanvasWorkspace.*\n\", '', content)
content = re.sub(r\"\\s*if \\(mode === 'canvas'\\) \\{[^}]*\\}\", '', content)
# 移除 watch 中的 canvas 检查
content = re.sub(r\"\\s*if \\(workspaceMode\\.value === 'canvas'\\) \\{[^}]*\\}\", '', content)
# 移除 mobile 'canvas' button
content = re.sub(r'.*mobilePanel.*canvas.*\n', '', content)
content = re.sub(r'.*canvasEnabled.*\n', '', content)

with open('src/layouts/WorkspaceLayout.vue', 'w') as f:
    f.write(content)
print('OK')
"

echo "=== 4. 清理 ActivityRail.vue ==="
python3 -c "
with open('src/components/rail/ActivityRail.vue', 'r') as f:
    content = f.read()
# 移除 canvas 导航项
import re
content = re.sub(r\"\\s*\\{ key: 'canvas'.*\\},\", '', content)
# 移除 emit canvas 事件
content = content.replace(\"|| key === 'canvas'\", '')
with open('src/components/rail/ActivityRail.vue', 'w') as f:
    f.write(content)
print('OK')
"

echo "=== 5. 清理 FileTreePanel.vue ==="
python3 -c "
with open('src/components/filetree/FileTreePanel.vue', 'r') as f:
    content = f.read()
import re
# 移除 canvas tab
content = re.sub(r\"\\s*\\{ key: 'canvas'.*\\},\", '', content)
# 移除 canvas 类型引用
content = re.sub(r\"\\| 'canvas'\", '', content)
# 移除 import canvasStore
content = re.sub(r\"import.*canvasStore.*\n\", '', content)
# 移除 canvas 相关函数
content = re.sub(r'function createCanvasFile.*?\n  \\}', '', content, flags=re.DOTALL)
content = re.sub(r'function addCanvas.*?\n  \\}', '', content, flags=re.DOTALL)
# 移除 canvas category 图标
content = re.sub(r\"if \\(item\\.category === 'canvas'\\) return 'account_tree'\", '', content)
# 移除 activeTab canvas 文案
content = re.sub(r\"activeTab === 'canvas'.*画布.*:\", \"\", content)
with open('src/components/filetree/FileTreePanel.vue', 'w') as f:
    f.write(content)
print('OK')
"

echo "=== 6. 清理 CreationPanel.vue 画布发送 ==="
python3 -c "
with open('src/components/creation/CreationPanel.vue', 'r') as f:
    content = f.read()
import re
# 移除 SendMediaAssetToCanvasPayload import
content = re.sub(r\"import type.*SendMediaAssetToCanvasPayload.*\n\", '', content)
# 移除 send-to-canvas 相关函数
content = re.sub(r'function sendMediaAssetToCanvas.*?\n  \\}', '', content, flags=re.DOTALL)
content = re.sub(r'function sendResultToCanvas.*?\n  \\}', '', content, flags=re.DOTALL)
# 移除 @send-to-canvas 事件
content = content.replace('@send-to-canvas', '')
with open('src/components/creation/CreationPanel.vue', 'w') as f:
    f.write(content)
print('OK')
"

echo "=== 7. 清理 MediaViewer.vue ==="
python3 -c "
with open('src/components/media/MediaViewer.vue', 'r') as f:
    content = f.read()
import re
content = re.sub(r\"sendToCanvas.*\n\", '', content)
content = content.replace('emit(\\'sendToCanvas\\')', '')
content = re.sub(r'.*send-to-canvas.*\n', '', content)
with open('src/components/media/MediaViewer.vue', 'w') as f:
    f.write(content)
print('OK')
"

echo "=== 8. 清理 useFileStore.ts ==="
python3 -c "
with open('src/composables/useFileStore.ts', 'r') as f:
    content = f.read()
import re
content = re.sub(r\"\\| 'canvas'\", '', content)
content = re.sub(r'function addCanvas.*?\n  \\}', '', content, flags=re.DOTALL)
content = re.sub(r'addCanvas,', '', content)
content = content.replace(', addCanvas', '')
with open('src/composables/useFileStore.ts', 'w') as f:
    f.write(content)
print('OK')
"

echo "=== 9. 清理 agentStore.ts canvas-design Skill ==="
python3 -c "
with open('src/stores/agentStore.ts', 'r') as f:
    content = f.read()
import re
content = re.sub(r'.*preset_canvas-design.*\n', '', content)
with open('src/stores/agentStore.ts', 'w') as f:
    f.write(content)
print('OK')
"

echo "=== 10. 清理 i18n ==="
python3 -c "
with open('src/i18n/index.ts', 'r') as f:
    content = f.read()
import re
content = re.sub(r'canvas:.*画布.*,\n', '', content)
content = re.sub(r'canvas:.*Canvas.*,\n', '', content)
with open('src/i18n/index.ts', 'w') as f:
    f.write(content)
print('OK')
"

echo "=== 11. 清理 skillScope.ts ==="
python3 -c "
with open('src/opencodeClient/skillScope.ts', 'r') as f:
    content = f.read()
content = content.replace(\"'canvas'\", '')
with open('src/opencodeClient/skillScope.ts', 'w') as f:
    f.write(content)
print('OK')
"

echo "=== 12. 清理 types/mediaAsset.ts ==="
python3 -c "
with open('src/types/mediaAsset.ts', 'r') as f:
    content = f.read()
import re
content = re.sub(r\".*SendMediaAssetToCanvasPayload.*\n\", '', content)
content = re.sub(r\"\\| 'canvas'\", '', content)
with open('src/types/mediaAsset.ts', 'w') as f:
    f.write(content)
print('OK')
"

echo "=== 13. 移除 vue-flow 依赖 ==="
python3 -c "
import json
with open('package.json', 'r') as f:
    pkg = json.load(f)
pkg['dependencies'] = {k: v for k, v in pkg['dependencies'].items() if not k.startswith('@vue-flow/')}
pkg['devDependencies'] = {k: v for k, v in pkg['devDependencies'].items() if not k.startswith('@vue-flow/')}
with open('package.json', 'w') as f:
    json.dump(pkg, f, indent=2)
    f.write('\n')
print('OK')
"

echo ""
echo "✅ 画布移除完成"
