---
name: mcp-builder
description: 创建高质量 MCP（模型上下文协议）服务器的指南，使 LLM 能够通过精心设计的工具与外部服务交互。当构建 MCP 服务器以集成外部 API 或服务时使用，支持 Python（FastMCP）和 Node/TypeScript（MCP SDK）。触发词：MCP、模型上下文协议、mcp server、工具服务器、tool server、API集成。
triggers:
  - MCP
  - 模型上下文协议
  - mcp server
  - 工具服务器
  - tool server
  - API集成
  - Model Context Protocol
---

# MCP 服务器开发指南

## 概述

创建 MCP（Model Context Protocol）服务器，使 LLM 能够通过精心设计的工具与外部服务交互。

## 推荐技术栈

- **语言**：TypeScript（高质量 SDK 支持，AI 模型擅长生成 TypeScript 代码）
- **传输**：远程服务器使用 Streamable HTTP，本地服务器使用 stdio

## 工作流程

### 阶段 1：深入研究和规划

#### 1.1 理解现代 MCP 设计
- **API 覆盖 vs 工作流工具**：平衡全面 API 端点覆盖和专业工作流工具
- **工具命名和可发现性**：使用一致的前缀（如 `github_create_issue`、`github_list_repos`）
- **上下文管理**：设计返回聚焦、相关数据的工具，支持过滤/分页
- **可操作的错误消息**：引导 agent 找到解决方案

#### 1.2 研究 MCP 协议文档
- 从 `https://modelcontextprotocol.io/sitemap.xml` 开始
- 关键页面：规范概述、传输机制、工具/资源/提示定义

#### 1.3 研究框架文档
- TypeScript SDK：`https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/main/README.md`
- Python SDK：`https://raw.githubusercontent.com/modelcontextprotocol/python-sdk/main/README.md`

### 阶段 2：实现

#### 2.1 项目结构
- TypeScript：使用 Zod schema + `server.registerTool`
- Python：使用 Pydantic + `@mcp.tool` 装饰器

#### 2.2 核心基础设施
- API 客户端与认证
- 错误处理辅助
- 响应格式化（JSON/Markdown）
- 分页支持

#### 2.3 实现工具
每个工具需要：
- **输入 Schema**：使用 Zod/Pydantic，包含约束和清晰描述
- **输出 Schema**：定义 `outputSchema`，使用 `structuredContent`
- **工具描述**：简洁的功能摘要 + 参数描述

### 阶段 3：审查和测试
- 无重复代码（DRY）
- 一致的错误处理
- 完整类型覆盖
- 用 MCP Inspector 测试

### 阶段 4：创建评估
- 创建 10 个需要多工具调用的复杂评估问题
- 每个问题独立、只读、可验证
