# RH 图片模型排障铁律

> **日期**: 2026-06-22
> **教训**: 新增 FLUX Klein 9B 触发 NewAPI 字段过滤 + Pydantic 类型校验两层 bug

## 铁律

1. **NewAPI 只透传 4 个顶层字段**: `model`/`prompt`/`images`/`extra_fields`。参数必须放 `extra_fields`
2. **extra_fields 严格白名单**: `normalizedParams` 含 `image`（数组），漏入会触发 Pydantic 422
3. **先测 image-to-image**: 文生图绕过上传链路，第一个测试必须是图生图
4. **排障第一信号**: `docker logs rh-adapter-rh-adapter-1 | grep ">>> RAW|POST /v1/images"`

## 死路
- 参数放顶层（被 NewAPI 吃掉）
- normalizedParams 全量 dump 进 extra_fields（数组炸 Pydantic）
- 只测文生图就认为通了

完整记录: `docs/sdd/rh-flux-klein-9b-sdd.md`
