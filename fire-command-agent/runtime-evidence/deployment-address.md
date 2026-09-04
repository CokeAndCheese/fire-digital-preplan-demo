# 固定部署地址记录

status: `PENDING`

scope: `线上发布验收（本地比赛展示不需要）`

本次整改没有发现可审计、固定且可从验收环境访问的生产部署地址。`localhost`、临时开发端口、截图地址和一次性预览地址不满足发布地址要求。

完成此记录需要由部署负责人填写：

- `environment`: `production` / `staging`
- `base_url`: 固定 HTTPS 地址
- `health_url`: 可公开核验的健康检查地址
- `owner`: 维护人或团队
- `verified_at`: 最近一次外部访问时间
- `rollback_target`: 可回退版本或镜像标识

在 `base_url`、健康检查和回滚目标均有真实回执前，线上发布状态保持 `BLOCKED`。该状态不阻断 `local-competition-demo.md` 规定的本地比赛展示。
