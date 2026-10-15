# Web1.0.3 发布记录

用户授权：立即修复正式站GPT6.1图片附件误报并发送发布。只在`1001-shoujiweb`提交、推送和部署Pages Production，不合并Git main，不推桌面tag，不部署后端。

- `webVersion`：1.0.2 → 1.0.3；桌面`version=2.1.64`不变。
- 交付：[[开发/Web常用模型容量预设TDD-2026-10-15]]。包括常用云模型容量、按供应商手动覆盖、旧32K缓存迁移、聊天/索引统一预算、图像Base64误计数修复，以及Haiku5.5独立1M预设。
- TDD红灯已复现；相关133/133，Web quick build（含类型检查）、产物审计、差异检查通过。完整前端1568项中1565通过，剩3项与Web1.0.2既有失败名称一致（Skill Creator附录、Desktop视频超时旧断言、仓库测试注册完整性），不登记为全绿。
- 图像预算为本地保守估算，不是中转站精确计数；发送原图不缩减。4MB模拟附件在Mock实际请求中校验完整一致，未调用真实付费模型。
- 状态：源码`b4a943046876d71aa959ea92392235e65b90b7a8`已推送`origin/1001-shoujiweb`，Production部署成功且正式域名复检通过。上一Production为09463179（Web1.0.2，源码cf6441cc），保留作回滚依据。
- 未验：真实中转站生成、计费及原生设备。正式用户原图没有被上传给测试模型。

## 发布回执与正式站复检

- 使用既有代理及全局wrangler：`pages deploy dist --project-name=jiucaihezi --branch=main --commit-hash=b4a943046876d71aa959ea92392235e65b90b7a8`。这里的main只是Pages Production元数据，不是Git合并。
- 首次连接失败；重试成功，Uploaded10、376already uploaded。部署`b01bbbd3-8706-4e31-86aa-0f33143f82d7`，列表确认`Production / main / b4a9430`。
- [正式Web工作台](https://jiucaihezi.studio/try/)。首次复检`/try/`短暂返回旧入口，随后普通地址与`?release=1.0.3`均返回新入口；没有修改缓存或安全策略。
- 正式域名5项与本地构建SHA-256全部一致：
  - `/`：`3594bd9acb56c480fea4dea7029f897d4ed235f9d168a72d3374f8afa93b9b10`
  - `/try/`：`5489e76ab6b49e395826b6a5a20641d92fa08f6634b20ecd3167cd90d3d51986`
  - `/assets/try-CSx9enIl-jc20260610b.js`：`d7dedafa81df5548fa2e11cd15128ff2b503abe2873d40ae04d54e201d808a8e`
  - `/skills/manju-route.json`：`fb7964a53a5a010a410ff1005e099f536a32ad8478fd20a467d59cce3fb908d8`
  - `/skills/wiki-artifacts.json`：`8cb3f4bf22f194522ba321e5e7400ec03f6442e98d57cf327b4df8020edfa1e5`
- 正式主脚本包含Web1.0.3、图像独立预算、GPT6.1与Haiku5.5预设四项标记。
- 除Mock4MB请求外，用户此前提供的70,038字节PNG仅在本地干跑：估算输入4155token，原图载荷一致，模型网络请求0次。不是正式站真实生成/扣费验收。
