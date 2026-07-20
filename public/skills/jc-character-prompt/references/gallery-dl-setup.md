# gallery-dl 安装与使用

> 阶段 6 时可选——下载 Pinterest 参考图到本地，方便反复查看。

## 安装

```bash
# macOS
brew install gallery-dl

# 或 pip
pip install gallery-dl

# 验证
gallery-dl --version
```

## 使用

```bash
# 下载单个 Pin 的图片
gallery-dl "https://jp.pinterest.com/pin/123456789/" -d ./references/

# 下载搜索结果页的前 20 张
gallery-dl "https://jp.pinterest.com/search/pins/?q=female+warrior+concept+art" \
  --range 1-20 -d ./references/
```

> 若 gallery-dl 不可用，直接用浏览器截图 + view_image 即可，核心流程不依赖它。
