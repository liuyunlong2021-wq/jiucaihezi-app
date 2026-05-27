# Gateway Account Setup

## Check Status

Run `--check` first:
```bash
python3 {baseDir}/scripts/runninghub.py --check
```

React by `status`:
- `"ready"` → "账号就绪！可以开始使用画布、创作面板和媒体生成。"
- `"no_key"` → "桌面端不接收上游媒体密钥。请登录韭菜盒子账号并开通会员，媒体能力会通过 Gateway 和 NewAPI 自动分组路由。"
- `"no_balance"` → "韭菜花余额不足，请在账号中心充值或开通会员后继续。"
- `"invalid_key"` → "本地上游凭据已失效。桌面端不维护上游凭据，请改用韭菜盒子账号会员体系。"

## Product Rule

韭菜盒子桌面端只展示 Gateway 映射出来的能力。用户不需要、也不应该在桌面端填写 RunningHub 上游凭据。后台渠道、自动分组和成本控制由 NewAPI/Gateway 维护。
