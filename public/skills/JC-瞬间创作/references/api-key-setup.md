# API Key 设置

> 什么时候读：脚本返回 `NO_API_KEY` 或用户说"怎么配置 Key"时。

## 韭菜盒子 Studio 用户

登录后自动配置，无需手动操作。Key 已写入 `~/.jiucaihezi/.jc_api_key`。

## 外部平台用户

### 1. 创建 Key

打开 https://api.jiucaihezi.studio/keys → 点击「新建」→ 复制 Key。

### 2. 配置

```bash
export JC_API_KEY='sk-你的key'
```

或直接传参：

```bash
python3 jc_media.py run --api-key sk-你的key ...
```

### 3. 验证

```bash
python3 jc_media.py check
# → {"status":"ok","message":"NewAPI ready, 80 models"}
```

## 充值

余额不足时：https://api.jiucaihezi.studio/wallet
