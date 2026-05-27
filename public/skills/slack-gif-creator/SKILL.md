---
name: slack-gif-creator
description: 创建为 Slack 优化的动画 GIF 的工具包。提供约束、验证工具和动画概念。当用户请求为 Slack 创建动画 GIF 时使用，如「帮我做一个 XX 的 GIF 用于 Slack」。触发词：GIF、动画、Slack、表情、animated gif、动图。
triggers:
  - GIF
  - 动画
  - Slack
  - 表情
  - animated gif
  - 动图
  - emoji
---

# Slack GIF Creator

为 Slack 创建优化动画 GIF 的工具包。

## Slack 要求

**尺寸：**
- Emoji GIF：128x128（推荐）
- 消息 GIF：480x480

**参数：**
- FPS：10-30（越低文件越小）
- 颜色：48-128（越少文件越小）
- 时长：Emoji GIF 保持 3 秒以内

## 绘制图形

### 从头绘制
使用 PIL ImageDraw 基本图形：
```python
from PIL import ImageDraw
draw = ImageDraw.Draw(frame)
draw.ellipse([x1, y1, x2, y2], fill=(r, g, b), outline=(r, g, b), width=3)
draw.polygon(points, fill=(r, g, b), outline=(r, g, b), width=3)
draw.line([(x1, y1), (x2, y2)], fill=(r, g, b), width=5)
draw.rectangle([x1, y1, x2, y2], fill=(r, g, b), outline=(r, g, b), width=3)
```

### 让图形好看
- 使用更粗的线条（width=2+）
- 添加视觉深度：渐变背景、多层形状
- 使用鲜艳的互补色
- 复杂形状使用多边形和椭圆的组合

## 动画概念

- **抖动/振动**：用 `math.sin()` 偏移位置
- **脉冲/心跳**：用正弦波缩放大小
- **弹跳**：使用缓动函数 `bounce_out`
- **旋转**：`image.rotate(angle)`
- **淡入淡出**：调整 alpha 通道
- **滑动**：从屏幕外移动到位置
- **缩放**：缩放和裁剪
- **爆炸/粒子爆发**：创建向外辐射的粒子

## 优化策略

按需实施：
1. 减少帧数
2. 减少颜色数（`num_colors=48`）
3. 缩小尺寸
4. 移除重复帧（`remove_duplicates=True`）
5. Emoji 模式（`optimize_for_emoji=True`）

## 依赖

```bash
pip install pillow imageio numpy
```
