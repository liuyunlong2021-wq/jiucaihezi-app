# 动态影音统一执行层（源码阶段，未部署）

权威合同：`docs/wiki/开发/影音动态能力目录与NewAPI统一执行合同-2026-10-10.md`。

## 结构

- `shared/creation-schema.mjs`：App 和服务端共用的 `creation-params-v1` 数据解释器，无 eval、远程脚本或生成代码。
- `extension/creation_protocol_router.go` 位于 `../newapi-media`：在固定 NewAPI 宿主中复用 TokenAuth / ListModels，再代理到私有执行服务。任务读取使用 TokenAuthReadOnly，避免生成耗尽额度后取不回结果；禁用 Key、封禁用户仍拒绝。
- `server.mjs`：无额外 npm 依赖的 Node >= 22 服务，默认监听 loopback；容器模式只接内网，不发布公网端口。
- `publish.mjs`：原子发布能力与适配合同。新模型只修改服务器合同文件及既有 NewAPI 插件/渠道，不增加 App 注册表条目。
- `install-host-extension.py`：仅在固定官方 SHA 的**独立源码目录**安装路由；不构建镜像、不改线上服务。
- 示例 `openai-image.example.json` 按当前菠萝图片接口生成首个合同，尚未做动态协议真实计费验收，不能直接当作已上线模型清单。

## 管理员接入

1. 在独立的 NewAPI rc.40 checkout 运行：
   ```sh
   python3 scripts/creation-protocol/install-host-extension.py /absolute/pinned/newapi/source
   ```
   脚本只增加路由；原本的素材/OSS 扩展仍按 `scripts/newapi-media` 流程维护。不要运行历史 `prepare.sh` 去覆盖当前生产镜像，它针对不同的旧镜像基线。
2. NewAPI 配置 `JC_CREATION_EXECUTOR_URL`（私有执行服务地址）和 `JC_CREATION_EXECUTOR_SECRET`（至少 32 字符随机秘密）。执行服务用相同 secret。secret 通过服务器权限受控 env 文件注入，不写仓库或模型 Key。
3. 执行服务配置：
   - `JC_NEWAPI_INTERNAL_URL`：同实例 NewAPI 内网 URL；禁止指向该执行层自身。
   - `JC_CREATION_DATA_DIR`：持久化目录，运行用户可写；仅一个写入实例。
   - `JC_CREATION_MANIFEST`：管理员管理的能力清单 JSON。
   - `JC_CREATION_OUTPUT_HOSTS`：供应商结果 HTTPS 域名的精确白名单；禁止通配、私网、重定向。外部结果实际 TLS 连接固定经过校验的 DNS 地址，且不携带 NewAPI Key。
   - `JC_CREATION_BIND`：默认 `127.0.0.1`；私有容器网络可设 `0.0.0.0`，不映射公网端口。
4. 根目录构建该服务时，Dockerfile 必须显式提供经审计、按 digest 固定的 `NODE_IMAGE`。挂载数据目录前由管理员赋给镜像运行用户；Dockerfile 不以 root 运行。
5. 初次目录文件 `{ "entries": [] }`，发布一项合同：
   ```sh
   node scripts/creation-protocol/publish.mjs /absolute/data/capabilities.json /absolute/model-entry.json
   ```
   服务在每次目录/提交请求检查目录文件更新。旧 revision 的能力和适配器保留；更新已发布版本内容会被拒绝。
6. 在固定宿主编译路由、审计生产 Compose/镜像回滚方案、验收已有媒体功能和动态合同后，再启用新服务。当前没有执行这些生产步骤。

NewAPI 的可信代理设置须只信任实际内部代理地址。执行层回传由宿主核实的原客户端 IP；正式接入必须验证受 IP 限制 Token 的目录、提交和查询，不得为了通过验收关闭 IP 限制。

## 模型接入合同

`capability` 是公开参数/素材/输出合同；`adapter` 只留服务器。提交可选 JSON 或 multipart，`defaults` 提供确定的宿主默认字段，`rename` 映射一级参数/素材槽位，`scalar_slots` 映射单素材字段。上游嵌套结构、厂商令牌和专有参数应由已安装的 NewAPI 插件归一；不要把 JS 表达式塞进清单。

同步图片示例已提供。异步适配器须声明：

```json
{
  "submit": {"path": "/v1/videos", "encoding": "json"},
  "poll": {
    "id_path": "id",
    "path": "/v1/videos/{id}",
    "status_path": "status",
    "succeeded_states": ["completed"],
    "failed_states": ["failed"],
    "cancelled_states": ["cancelled"]
  },
  "outputs": {
    "content_path": "/v1/videos/{id}/content",
    "modality": "video",
    "mime_type": "video/mp4",
    "extension": "mp4"
  }
}
```

这是结构示例，必须用实际部署插件的公开返回字段校准。提交可用服务器侧纯数据 `body_template` 组合 `$param`、`$model`、`$slot`、`$map_slot` 与 `$concat`，以复用 Responses 等现有嵌套协议；这些数据不返回给 App。`outputs` 也可为多个描述的数组，以保存同一任务中的多种输出。同步结果支持数组、URL、Base64、文本和二进制；异步任务只在真实成功终态提取文件。取消仅在真实 cancel 适配路径已声明时可用，收到受理响应仍是 `cancel_requested`，不能宣称已取消或退款。

## 持久化与恢复边界

- 用户 Key 只在内存中转发到本实例 NewAPI；任务/目录不写 Key。目录按官方宿主返回的模型权限交集过滤，读取输出按用户/Token 身份隔离。
- `request_id` 的记录和确定性任务 ID 在付费提交前写盘；原子创建防止并发重复任务，持久化执行 claim 防止二次付费调用。
- 服务重启后，尚未取得执行 claim 的 queued 任务可恢复。已有 claim 且丢失同步上游响应时保留任务，不自动重新生成；管理员需凭宿主账单/日志核实。已有上游 ID 的异步任务继续查询。
- 图片 Base64/二进制缓存默认总上限 10 GiB，至少保留 1 GiB 磁盘；远程结果经鉴权转发，Range 仅在上游支持时透传。缓存输出不会自行删除用户历史；容量与备份由管理员监控。
- 任务记录冻结本层 capability/revision/参数/适配器；实际渠道选择、插件运行版本与计费版本的追溯仍须在宿主上线验收中确认，不能声称已完成整个 NewAPI 计费审计。
- 生产模型须逐项发布真实能力合同。只有 `/v1/models` 名称而没有参数/执行合同的模型不猜接口。
- 服务暂不可用、权限错误、合同冲突不会切回旧模型白名单绕过。只有统一端点不存在（404/405）时兼容旧适配；本机能力独立保留。

## 本轮检查范围

TypeScript 类型检查、独立模块依赖编译、Rust `cargo check --lib`、Node 语法检查和文档/JSON 静态检查。未运行测试套件、未启动该服务做接口验收、未调用计费模型、未编译固定 NewAPI 宿主、未部署服务器、未打包 App。
