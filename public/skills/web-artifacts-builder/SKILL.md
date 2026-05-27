---
name: web-artifacts-builder
description: 使用现代前端技术（React 18、TypeScript、Vite、Tailwind CSS、shadcn/ui）创建复杂的多组件 HTML 产出物。适用于需要状态管理、路由或 shadcn/ui 组件的复杂产出物 — 不适用于简单的单文件 HTML。触发词：web artifact、html组件、React组件、shadcn、前端组件、网页应用。
triggers:
  - web artifact
  - html组件
  - React组件
  - shadcn
  - 前端组件
  - 网页应用
  - tailwind
---

# Web Artifacts Builder

构建强大的前端产出物。

## 技术栈
React 18 + TypeScript + Vite + Parcel（打包）+ Tailwind CSS + shadcn/ui

## 快速开始

### 步骤 1：初始化项目
```bash
bash scripts/init-artifact.sh <project-name>
cd <project-name>
```
创建完整配置的项目：React + TS + Tailwind + 40+ shadcn/ui 组件 + 路径别名

### 步骤 2：开发
编辑生成的文件。

### 步骤 3：打包为单个 HTML
```bash
bash scripts/bundle-artifact.sh
```
创建 `bundle.html` — 自包含的产出物，所有 JS/CSS/依赖内联。

### 步骤 4：分享
将打包的 HTML 文件分享给用户。

### 步骤 5：测试/可视化（可选）
使用 Playwright 或其他工具测试产出物。通常避免预先测试以减少延迟。

## 设计 & 样式指南

**非常重要**：为避免「AI slop」，避免使用过度居中布局、紫色渐变、统一圆角和 Inter 字体。

## 参考

- shadcn/ui 组件：https://ui.shadcn.com/docs/components
