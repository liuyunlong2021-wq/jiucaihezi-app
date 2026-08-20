# 韭菜盒子创作 MCP

这是本机 Desktop 桥接，不是插件，也不需要在 Codex 中填写 NewAPI Key。韭菜盒子运行时会把临时地址和一次性令牌写入 `~/.jiucaihezi/mcp-bridge.json`；MCP 只读这个发现文件，再把请求交回正在运行的创作面板任务引擎。

构建：

```bash
pnpm install
pnpm run build:creation-mcp
```

Codex 的 MCP 配置使用构建入口：

```json
{
  "mcpServers": {
    "jiucaihezi-creation": {
      "command": "node",
      "args": ["/Users/by3/Documents/jiucaihezi-app/scripts/jiucaihezi-creation-mcp/dist/index.mjs"]
    }
  }
}
```

先启动韭菜盒子 Desktop，再连接 MCP。当前工具会复用创作模型目录、任务执行、右上角历史、项目落盘、取消、重新保存和显式放入画布；未通过真实 Codex 客户端验收前，视频/音频只承诺返回稳定本地路径，不承诺内嵌播放器。
