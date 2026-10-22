# WP-R2-MON-04：视频「只看我的」快捷筛选

## 行为

视频监控列表新增 **「只看我的」** 开关：

1. **筛选**：`GET /api/v1/monitor/cards?type=video&onlyMine=1` 按后台配置的本人 B 站 UID（`studio_owner_account.mid`）精确过滤 `videos.mid`，在 count / 置顶 / 发布时间排序 / 分页之前生效。
2. **配置**：`GET|PUT /api/v1/monitor/settings/owner-account`；设置页可编辑 UID 与显示名。默认狐正正 `3493141386627335`；迁移 `ON CONFLICT DO NOTHING` 不覆盖已改配置。
3. **URL**：`onlyMine=1`（默认关闭不写 URL）；与分类、搜索、监控状态、排序、布局组合保留；开关切换重置页码并清空选中。

与登录鉴权无关。UP / 动态 tab 不受影响。不新建 creators、不调 B 站。

## 非目标

不改采集、默认频率、监控启停、置顶排序算法、16G 卡片布局；不做完整账号管理。

## 验收要点

- 非法 UID / 空显示名 400；缺失配置开启 onlyMine 给可读错误，不返回全量。
- 同昵称不同 UID 不混入；未知 UID 可保存且筛选为空。
- 进程重启后配置仍在；改 UID 后列表缓存失效。
