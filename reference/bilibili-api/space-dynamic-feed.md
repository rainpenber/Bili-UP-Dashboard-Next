# 获取用户空间动态（固定 commit 摘录）

> 来源：BACNext/bilibili-API-collect-backup@cfc5fddcc8a94b74d91970bb5b4eaeb349addc47
> 原文：`docs/dynamic/space.md`

# 用户空间动态

## 获取用户空间动态

> https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space
> 
> https://api.bilibili.com/x/polymer/web-dynamic/desktop/v1/feed/space

*请求方法: GET*

鉴权方式:
* 未登录: 请求标头 `User-Agent` 字段, `Cookie` 需含 `buvid3`; WBI 签名, `dm_img` 系列风控
* 已登录: 请求标头 `Cookie` 含有效 `SESSDATA`

注: 该接口现在有一些奇奇怪怪的校验, 存在一定运气成分, 参见 [#686](https://github.com/SocialSisterYi/bilibili-API-collect/issues/686), 所以建议您还是登录吧~

**URL 参数:**

| 参数名          | 类型   | 内容   | 必要性 | 备注  |
|-----------------|--------|--------|-----| - |
| offset          | string | 分页偏移量 | 不必要 |     |
| host_mid        | string | 被查询用户 UID (mid)  |必要| |
| timezone_offset | number | 时区偏移| 不必要| 默认 `-480` |
| platform        | string | 平台 | 不必要 | 如 `web` |
| features        | string | 功能 | 不必要 | 留空为空, 默认为 `itemOpusStyle,listOnlyfans,opusBigCover,onlyfansVote,forwardListHidden,decorationCard,commentsNewVersion,onlyfansAssetsV2,ugcDelete,onlyfansQaCard`, 参见 [功能模块](../opus/features.md#features) |
| web_location    | string | `333.1387` | 不必要 |  |
| dm_img_switch   | number | `0` | 不必要 | 仅登录时存在 |
| dm_img_list     | object[] | `dm_img` 系列风控 | 不必要 | 仅未登录时存在 |
| dm_img_str      | string |  `dm_img` 系列风控 | 不必要 | 仅未登录时存在 |
| dm_cover_img_str | string |  `dm_img` 系列风控 | 不必要 | 仅未登录时存在 |
| dm_img_inter    | object | `dm_img` 系列风控 | 不必要 | 仅未登录时存在 |
| x-bili-device-req-json | object | `{"platform":"web","device":"pc"}` | 不必要 | |
| x-bili-web-req-json | object | `{"spm_id":"333.1387"}` | 不必要 |  |
| w_rid           | string | WBI 签名 | 不必要 | 参见 [WBI 签名](../misc/sign/wbi.md) |
| wts             | number | UNIX 秒级时间戳 | 不必要 | 参见 [WBI 签名](../misc/sign/wbi.md) |

**JSON 回复:**

响应 `data` 含 `has_more`、`items[]`、`offset`（游标字符串）。
条目关键字段：`id_str`、`type`、`modules.module_author.pub_ts`、`modules.module_author.name`、
`modules.module_dynamic.desc.text` / `major`（标题视类型而定）。

鉴权说明见上文；实现侧登录 Cookie（SESSDATA）优先，未登录需 WBI + buvid3。
风控：HTTP 412 / biz `-412` / `-352` → risk_control；`-509` → rate_limited。
