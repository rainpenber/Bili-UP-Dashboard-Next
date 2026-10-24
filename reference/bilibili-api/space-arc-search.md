# 查询用户投稿视频明细（固定 commit 摘录）

> 来源：BACNext/bilibili-API-collect-backup@cfc5fddcc8a94b74d91970bb5b4eaeb349addc47
> 原文：`docs/user/space.md`

### 查询用户投稿视频明细

> https://api.bilibili.com/x/space/wbi/arc/search

> ~~https://api.bilibili.com/x/space/arc/search~~ （已废弃，保留是方便遇到问题的人搜索到此处）

*请求方式：GET*

鉴权方式：[Wbi 签名](../misc/sign/wbi.md)

另见 [根据关键词查找视频](../video/collection.md#根据关键词查找视频), 功能基本相同, 暂未发现风控校验

**url参数：**

| 参数名  | 类型 | 内容         | 必要性 | 备注                                                                          |
| ------- | ---- | ------------ | ------ | ----------------------------------------------------------------------------- |
| mid     | num  | 目标用户mid  | 必要   |                                                                               |
| order   | str  | 排序方式     | 非必要 | 默认为pubdate<br />最新发布：pubdate<br />最多播放：click<br />最多收藏：stow |
| tid     | num  | 筛选目标分区 | 非必要 | 默认为0<br />0：不进行分区筛选<br />分区tid为所筛选的分区                     |
| keyword | str  | 关键词筛选   | 非必要 | 用于使用关键词搜索该UP主视频稿件                                              |
| pn      | num  | 页码         | 非必要 | 默认为 `1`                                                                    |
| ps      | num  | 每页项数     | 非必要 | 默认为 `30`                                                                   |

**json回复：**

根对象：

| 字段    | 类型 | 内容     | 备注                        |
| ------- | ---- | -------- | --------------------------- |
| code    | num  | 返回值   | 0：成功<br />-400：请求错误<br />-412：请求被拦截 |
| message | str  | 错误信息 | 默认为0                     |
| ttl     | num  | 1        |                 |
| data    | obj  | 信息本体 |                             |

`data`对象：

| 字段            | 类型 | 内容           | 备注 |
| --------------- | ---- | -------------- | ---- |
| list            | obj  | 列表信息       |      |
| page            | obj  | 页面信息       |      |
| episodic_button | obj  | “播放全部“按钮 |      |
| is_risk         | bool |                |      |
| gaia_res_type   | num  |                |      |
| gaia_data       | obj  |                |      |

`data`中的`list`对象：

| 字段  | 类型   | 内容             | 备注 |
| ----- | ------ | ---------------- | ---- |
| slist | array  | 空数组           |      |
| tlist | obj    | 投稿视频分区索引 |      |
| vlist | array | 投稿视频列表     |      |

`list`中的`tlist`对象：

| 字段  | 类型 | 内容         | 备注                  |
| ----- | ---- | ------------ | --------------------- |
| {tid} | obj  | 该分区的详情 | 字段名为存在的分区tid |
| ……    | obj  | ……           | 向下扩展              |

`tlist`中的`{tid}`对象：

| 字段  | 类型 | 内容                 | 备注 |
| ----- | ---- | -------------------- | ---- |
| count | num  | 投稿至该分区的视频数 |      |
| name  | str  | 该分区名称           |      |
| tid   | num  | 该分区tid            |      |

`list`中的`vlist`数组：

| 项   | 类型 | 内容            | 备注 |
| ---- | ---- | --------------- | ---- |
| 0    | obj  | 投稿视频1       |      |
| n    | obj  | 投稿视频（n+1） |      |
| ……   | obj  | ……              | ……   |

`list`中的`vlist`数组中的对象：

| 字段               | 类型 | 内容           | 备注                         |
| ------------------ | ---- | -------------- | ---------------------------- |
| aid                | num  | 稿件avid       |                              |
| attribute          | num  |                |                              |
| author             | str  | 视频UP主       | 不一定为目标用户（合作视频） |
| bvid               | str  | 稿件bvid       |                              |
| comment            | num  | 视频评论数     |                              |
| copyright          | str  | 视频版权类型   |                              |
| created            | num  | 投稿时间       | 时间戳                       |
| description        | str  | 视频简介       |                              |
| elec_arc_type      | num  | 充电为1，否则0 | 可能还有其他情况             |
| enable_vt          | num  | 0              | 作用尚不明确                 |
| hide_click         | bool | false          | 作用尚不明确                 |
| is_avoided         | num  | 0              | 作用尚不明确                 |
| is_charging_arc    | bool | 是否为充电视频 |                              |
| is_lesson_video    | num  | 是否为课堂视频 | 0：否<br />1：是             |
| is_lesson_finished | num  | 课堂是否已完结 | 0：否<br />1：是             |
| is_live_playback   | num  | 是否为直播回放 | 0：否<br />1：是             |
| is_pay             | num  | 0              | 作用尚不明确                 |
| is_self_view       | bool | 是否仅自己可见 |                           |
| is_steins_gate     | num  | 是否为互动视频 | 0：否<br />1：是             |
| is_union_video     | num  | 是否为合作视频 | 0：否<br />1：是             |
| jump_url           | str  | 跳转链接       | 跳转到课堂的链接，否则为""   |
| length             | str  | 视频长度       | MM:SS                        |
| mid                | num  | 视频UP主mid    | 不一定为目标用户（合作视频） |
| meta               | obj  | 所属合集或课堂 | 无数据时为 null              |
| pic                | str  | 视频封面       |                              |
| play               | num  | 视频播放次数   |                              |
| playback_position  | num  | 百分比播放进度 | 封面下方显示的粉色条         |
| review             | num  | 0              | 作用尚不明确                 |
| season_id          | num  | 合集或课堂编号 | 都不属于时为0                |
| subtitle           | str  | 空             | 作用尚不明确                 |
| title              | str  | 视频标题       |                              |
| typeid             | num  | 视频分区tid    |                              |
| video_review       | num  | 视频弹幕数     |                              |
| vt                 | num  | 0              | 作用尚不明确                 |
| vt_display         | str  | 空             | 作用尚不明确                 |

`list`中的`vlist`数组中的对象中的`meta`对象：

| 字段       | 类型 | 内容         | 备注             |
| ---------- | ---- | ------------ | ---------------- |
| attribute  | num  | 0            | 作用尚不明确     |
| cover      | str  | 合集封面URL  |                  |
| ep_count   | num  | 合集视频数量 |                  |
| ep_num     | num  | 合集视频数量 |                  |
| first_aid  | num  | 首个视频av号 |                  |
| id         | num  | 合集id       |                  |
| intro      | str  | 合集介绍     |                  |
| mid        | num  | UP主uid      | 若为课堂，则为0  |
| ptime      | num  | unix时间(s)  | 最后更新时间     |
| sign_state | num  | 0            | 作用尚不明确     |
| stat       | obj  | 合集统计数据 |                  |
| title      | str  | 合集名称     |                  |

`list`中的`vlist`数组中的对象中的`meta`对象中的`stat`对象：

| 字段       | 类型 | 内容         | 备注                 |
| ---------- | ---- | ------------ | -------------------- |
| coin       | num  | 合集总投币数 |                      |
| danmaku    | num  | 合集总弹幕数 |                      |
| favorite   | num  | 合集总收藏数 |                      |
| like       | num  | 合集总点赞数 |                      |
| mtime      | num  | unix时间(s)  | 其他统计数据更新时间 |
| reply      | num  | 合集总评论数 |                      |
| season_id  | num  | 合集id       |                      |
| share      | num  | 合集总分享数 |                      |
| view       | num  | 合集总播放量 |                      |
| vt         | num  | 0            | 作用尚不明确         |
| vv         | num  | 0            | 作用尚不明确         |

`data`中的`page`对象：

| 字段  | 类型 | 内容       | 备注 |
| ----- | ---- | ---------- | ---- |
| count | num  | 总计稿件数 |      |
| pn    | num  | 当前页码   |      |
| ps    | num  | 每页项数   |      |

`data`中的`episodic_button`对象：

| 字段 | 类型 | 内容          | 备注 |
| ---- | ---- | ------------- | ---- |
| text | str  | 按钮文字      |      |
| uri  | str  | 全部播放页url |      |

**示例：**

`pn`（页码）和`ps`（每页项数）只改变`vlist`中成员的多少与内容

以每页2项查询用户`mid=53456`的第1页投稿视频明细

```shell
curl -G 'https://api.bilibili.com/x/space/arc/search' \
--data-urlencode 'mid=53456' \
--data-urlencode 'ps=2' \
--data-urlencode 'pn=1'
```


（响应示例见上游原文；本仓库解析 `data.list.vlist[]` 的 `bvid`/`title`/`created`/`mid`。）
