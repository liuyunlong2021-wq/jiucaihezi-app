# NewAPI 视频下载 SSRF 端口配置失效排障

> 日期：2026-09-09  
> 状态：生产已恢复，用户确认视频可以下载  
> 适用场景：视频任务已经成功，但访问 `/v1/videos/{task_id}/content` 返回 `request blocked: port N is not allowed`

关联：[[韭菜盒子MiniMax参考生视频API对外接入-2026-09-06]]

## 一、现象与结论

MiniMax H3 的创建和轮询均成功，失败只发生在下载阶段：

```json
{"error":{"message":"request blocked: port 8794 is not allowed","type":"server_error"}}
```

根因不是上游生成失败，也不是模型路由错误。菠萝适配器的 `/content` 服务运行在 Docker 内网端口 `8794`，NewAPI 代理下载前会执行 SSRF 校验；生产数据库保存的端口配置是 JSON 数字数组：

```json
[80,443,8080,8443,8794]
```

而当前 NewAPI 后端读取的是字符串数组。配置反序列化失败后，运行时继续使用默认端口，因此 `8794` 仍被拦截。后台页面显示“保存成功”并不能证明运行时已经加载。

## 二、快速判定

先查数据库中的真实值和当前运行镜像：

```bash
docker exec postgres psql -U newapi -d new-api -Atc \
"SELECT key,value FROM options WHERE key LIKE 'fetch_setting.%' ORDER BY key;"

docker inspect new-api --format \
'started={{.State.StartedAt}} image={{.Config.Image}}'
```

本次故障现场为：

```text
fetch_setting.allowed_ports|[80,443,8080,8443,8794]
fetch_setting.allow_private_ip|true
image=jiucaihezi/new-api:rollback-rc20
```

关键判断只有一个：`allowed_ports` 中的每个端口是否带双引号。数字数组是错误格式，字符串数组才是当前后端可读取的格式。

## 三、已验证恢复步骤

直接把数据库值修正为字符串数组，然后重启 NewAPI 让配置重新加载：

```bash
docker exec postgres psql -U newapi -d new-api -c \
"UPDATE options SET value='[\"80\",\"443\",\"8080\",\"8443\",\"8794\"]' WHERE key='fetch_setting.allowed_ports';"

docker exec postgres psql -U newapi -d new-api -Atc \
"SELECT key,value FROM options WHERE key='fetch_setting.allowed_ports';"

cd /root/new-api-new
docker compose restart new-api
docker compose ps new-api
docker compose logs --tail=50 new-api
```

正确回执应为：

```text
fetch_setting.allowed_ports|["80","443","8080","8443","8794"]
```

随后直接重试原来已经完成的 `/content` 下载即可，不需要重新生成视频。本次按上述步骤执行后，用户已确认下载成功。

## 四、为什么其他适配器可能正常

只有 NewAPI 需要主动访问 Docker 内网适配器 `/content` 时，才会命中这条 SSRF 端口规则。直接返回公网 HTTPS 成品地址的渠道通常只使用 `443`，所以即使 `8794` 没有生效，也可能一直正常。

菠萝上游不直接返回可公开下载的视频地址，NewAPI 必须继续访问内部适配器的 `8794` 端口，所以问题只在“任务完成后的下载”阶段暴露。

## 五、下次处理原则

1. 看到“任务成功但 `/content` 被端口拦截”，先查 `options` 表，不要先改模型路由或上游请求。
2. 在该前后端类型问题修复前，不要再从 SSRF 后台页面保存允许端口；页面可能重新写回数字数组。
3. 不要关闭 SSRF 保护。只放行实际使用的内部适配器端口。
4. Docker 内网适配器下载需要 `fetch_setting.allow_private_ip=true`；仅在确实需要内部访问时保持开启。
5. 同时记录 `new-api` 的镜像标签和启动时间。本次生产实际运行 `rollback-rc20`，与既有 rc.30 升级记录不一致，镜像漂移应另行核验，不能在本故障处理中顺手升级。

## 六、本次未做的改动

- 未修改 NewAPI 源码。
- 未修改适配器端口，也没有把 `8794` 迁移为 `8080`。
- 未关闭 SSRF 校验。
- 未记录 API Key、任务 ID、提示词或临时视频链接。
