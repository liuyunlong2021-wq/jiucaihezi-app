---
name: webapp-testing
description: 使用 Playwright 与本地 Web 应用交互和测试的工具包。支持验证前端功能、调试 UI 行为、捕获浏览器截图和查看浏览器日志。触发词：测试、Playwright、浏览器测试、UI测试、e2e、网页测试、自动化测试、web testing。
triggers:
  - 测试
  - Playwright
  - 浏览器测试
  - UI测试
  - e2e
  - 网页测试
  - 自动化测试
  - web testing
  - playwright
---

# Web 应用测试

使用原生 Python Playwright 脚本测试本地 Web 应用。

## 决策树：选择方法

```
用户任务 → 是静态 HTML？
    ├─ 是 → 直接读取 HTML 文件识别选择器
    │         └─ 编写 Playwright 脚本
    │
    └─ 否（动态 webapp）→ 服务器已在运行？
        ├─ 否 → 运行：python scripts/with_server.py --help
        │        然后使用辅助脚本 + 编写简化 Playwright 脚本
        │
        └─ 是 → 侦察-然后-行动模式：
            1. 导航并等待 networkidle
            2. 截图或检查 DOM
            3. 从渲染状态识别选择器
            4. 用发现的选择器执行操作
```

## 使用 with_server.py

**单服务器：**
```bash
python scripts/with_server.py --server "npm run dev" --port 5173 -- python your_automation.py
```

**多服务器（如 backend + frontend）：**
```bash
python scripts/with_server.py \
  --server "cd backend && python server.py" --port 3000 \
  --server "cd frontend && npm run dev" --port 5173 \
  -- python your_automation.py
```

## 侦察-然后-行动模式

1. **检查渲染的 DOM**：
   ```python
   page.screenshot(path='/tmp/inspect.png', full_page=True)
   content = page.content()
   page.locator('button').all()
   ```
2. 从检查结果**识别选择器**
3. 使用发现的选择器**执行操作**

## 常见陷阱

❌ 不要在动态应用上等待 `networkidle` 之前检查 DOM
✅ 在检查前等待 `page.wait_for_load_state('networkidle')`

## 最佳实践

- 使用 `sync_playwright()` 编写同步脚本
- 使用完关闭浏览器
- 使用描述性选择器：`text=`、`role=`、CSS 选择器或 ID
- 添加适当的等待：`page.wait_for_selector()` 或 `page.wait_for_timeout()`
