import type { CommercialProject, DefaultWorkflowTemplate } from './types';

function node(
  id: string,
  name: string,
  status: CommercialProject['workflow']['sections'][0]['nodes'][0]['status'],
  extra?: Partial<CommercialProject['workflow']['sections'][0]['nodes'][0]>,
): CommercialProject['workflow']['sections'][0]['nodes'][0] {
  return { id, name, status, ...extra };
}

/** 新项目的默认流程（设置页只读展示） */
export const defaultWorkflowTemplate: DefaultWorkflowTemplate = {
  title: '新商单默认流程',
  description:
    '短剧式商单从询单到发布，再到结算与后续维护。并行制作包与结算类节点在主干之后分叉，可在具体项目里微调。',
  graph: {
    sections: [
      {
        id: 'main',
        nodes: [
          node('inq', '询单', 'not_reached'),
          node('outline', '大纲', 'not_reached'),
          node('script', '文案', 'not_reached'),
          node('pre-shoot', '预拍摄', 'not_reached'),
        ],
        parallelGroups: [
          [
            node('a-roll', 'A-roll 拍摄', 'not_reached'),
            node('b-roll', 'B-roll 素材', 'not_reached'),
            node('ai-post', 'AI 后期', 'not_reached'),
          ],
        ],
      },
      {
        id: 'post-main',
        nodes: [node('review', '审核', 'not_reached'), node('publish', '发布', 'not_reached')],
        parallelGroups: [
          [
            node('settle', '结算', 'not_reached'),
            node('distribute', '全平台分发', 'not_reached'),
            node('data-care', '数据维护', 'not_reached'),
            node('other', '其他', 'not_reached'),
          ],
        ],
      },
    ],
  },
};

export const commercialProjectsMock: CommercialProject[] = [
  {
    id: 'proj-nev-spring',
    name: '某新能源 SUV 春季种草',
    stageLabel: '大纲',
    listBucket: 'blocked_with_reason',
    hasConcreteBlockReason: true,
    blockedNodeName: '大纲',
    blockedDays: 6,
    userFacingDeadline: '3月10日交大纲定稿',
    overallStage: '大纲反复对齐中',
    inProgressNodeNames: ['大纲'],
    mainBlockingItem: '确认口播是偏「家庭场景」还是「智驾体验」',
    netAmountYuan: 88000,
    rebateAmountYuan: 8800,
    upcomingNodeSchedule: [
      { name: '大纲', dateLabel: '3月10日' },
      { name: '文案', dateLabel: '3月14日' },
      { name: '成片', dateLabel: '3月22日' },
    ],
    finishedNodeSchedule: [{ name: '询单', dateLabel: '2月18日' }],
    statusHeadline: '大纲',
    blockingReason: '甲方中介来回改口播方向，群里约了十几条仍没定稿',
    published: false,
    archived: false,
    keywordHaystack: '新能源 SUV 春季 大纲 智驾 家庭',
    sortDate: '2026-03-10',
    openItems: [
      {
        id: 'oi-nev-1',
        projectId: 'proj-nev-spring',
        title: '大纲口播方向定稿',
        nextAction: '把两版开头各写 3 句，发群让甲方二选一',
        plannedTime: '3月10日前',
        side: 'ours',
        isBlocking: true,
      },
      {
        id: 'oi-nev-2',
        projectId: 'proj-nev-spring',
        title: '甲方确认最终大纲',
        nextAction: '中介在群里 @品牌方市场同学拍板',
        plannedTime: '定稿后 2 个工作日内',
        side: 'client',
        isBlocking: true,
      },
    ],
    workflow: {
      sections: [
        {
          id: 's1',
          nodes: [
            node('inq', '询单', 'done', { finishedDateLabel: '2月18日' }),
            node('outline', '大纲', 'blocked', {
              plannedDateLabel: '3月10日',
              blockingReason: '甲方反馈写作方向',
            }),
            node('script', '文案', 'not_reached', { plannedDateLabel: '3月14日' }),
            node('pre', '预拍摄', 'not_reached', { plannedDateLabel: '3月16日' }),
          ],
          parallelGroups: [
            [
              node('ar', 'A-roll', 'not_reached'),
              node('br', 'B-roll', 'not_reached'),
              node('ai', 'AI 后期', 'not_reached'),
            ],
          ],
        },
        {
          id: 's2',
          nodes: [
            node('rev', '审核', 'not_reached'),
            node('pub', '发布', 'not_reached', { plannedDateLabel: '3月22日' }),
          ],
        },
      ],
    },
  },
  {
    id: 'proj-snack-crisp',
    name: '某休闲零食「咔嚓脆」上新',
    stageLabel: '大纲',
    listBucket: 'in_progress',
    hasConcreteBlockReason: false,
    overallStage: '大纲撰写中',
    inProgressNodeNames: ['大纲'],
    netAmountYuan: 32000,
    rebateAmountYuan: 3200,
    upcomingNodeSchedule: [
      { name: '大纲', dateLabel: '3月9日' },
      { name: '文案', dateLabel: '3月12日' },
      { name: '成片', dateLabel: '3月18日' },
    ],
    finishedNodeSchedule: [{ name: '询单', dateLabel: '2月25日' }],
    statusHeadline: '大纲撰写中',
    published: false,
    archived: false,
    keywordHaystack: '零食 咔嚓脆 大纲',
    sortDate: '2026-03-09',
    openItems: [
      {
        id: 'oi-snack-1',
        projectId: 'proj-snack-crisp',
        title: '催甲方看大纲（仅顺延，不新开事项）',
        nextAction: '微信再发一遍链接，备注已按上次意见改到第三版',
        plannedTime: '3月9日',
        side: 'ours',
        isBlocking: false,
      },
    ],
    workflow: {
      sections: [
        {
          id: 's1',
          nodes: [
            node('inq', '询单', 'done', { finishedDateLabel: '2月25日' }),
            node('outline', '大纲', 'in_progress', { plannedDateLabel: '3月9日' }),
            node('script', '文案', 'not_reached', { plannedDateLabel: '3月12日' }),
          ],
        },
      ],
    },
  },
  {
    id: 'proj-game-collab',
    name: '某手游「星轨」皮肤联动',
    stageLabel: '文案',
    listBucket: 'in_progress',
    hasConcreteBlockReason: false,
    overallStage: '文案与素材准备',
    inProgressNodeNames: ['文案', 'B-roll 素材'],
    netAmountYuan: 56000,
    rebateAmountYuan: 5600,
    upcomingNodeSchedule: [
      { name: '文案', dateLabel: '3月8日' },
      { name: '成片', dateLabel: '3月15日' },
    ],
    finishedNodeSchedule: [
      { name: '询单', dateLabel: '2月20日' },
      { name: '大纲', dateLabel: '2月28日' },
    ],
    statusHeadline: '文案撰写中',
    published: false,
    archived: false,
    keywordHaystack: '手游 星轨 皮肤 素材',
    sortDate: '2026-03-08',
    openItems: [
      {
        id: 'oi-game-1',
        projectId: 'proj-game-collab',
        title: '向甲方要高清角色立绘',
        nextAction: '邮件抄送中介，说明仅作 B-roll 贴图，不卡主流程',
        plannedTime: '本周内',
        side: 'ours',
        isBlocking: false,
      },
    ],
    workflow: {
      sections: [
        {
          id: 's1',
          nodes: [
            node('inq', '询单', 'done', { finishedDateLabel: '2月20日' }),
            node('outline', '大纲', 'done', { finishedDateLabel: '2月28日' }),
            node('script', '文案', 'in_progress', { plannedDateLabel: '3月8日' }),
            node('pre', '预拍摄', 'not_reached'),
          ],
          parallelGroups: [
            [
              node('ar', 'A-roll', 'not_reached'),
              node('br', 'B-roll 素材', 'in_progress'),
              node('ai', 'AI 后期', 'not_reached'),
            ],
          ],
        },
      ],
    },
  },
  {
    id: 'proj-phone-gen',
    name: '某旗舰手机 Gen3 评测商单',
    stageLabel: '导出前',
    listBucket: 'blocked_with_reason',
    hasConcreteBlockReason: true,
    blockedNodeName: '审核 / 导出',
    blockedDays: 2,
    userFacingDeadline: '3月7日必须出片',
    overallStage: '剪辑收尾，等素材',
    inProgressNodeNames: ['AI 后期', '审核'],
    mainBlockingItem: '甲方补发暗光样张原图',
    netAmountYuan: 120000,
    rebateAmountYuan: 12000,
    upcomingNodeSchedule: [{ name: '发布', dateLabel: '3月7日' }],
    finishedNodeSchedule: [
      { name: '大纲', dateLabel: '2月22日' },
      { name: '文案', dateLabel: '2月26日' },
      { name: 'A-roll', dateLabel: '3月1日' },
    ],
    statusHeadline: '审核',
    blockingReason: '缺暗光场景原图，导出前被卡住',
    published: false,
    archived: false,
    keywordHaystack: '旗舰手机 Gen3 暗光 素材 导出',
    sortDate: '2026-03-07',
    openItems: [
      {
        id: 'oi-phone-1',
        projectId: 'proj-phone-gen',
        title: '暗光样张原图（已从普通素材升级为阻塞）',
        nextAction: '催中介今天下班前网盘补链',
        plannedTime: '3月6日 18:00 前',
        side: 'client',
        isBlocking: true,
      },
      {
        id: 'oi-phone-2',
        projectId: 'proj-phone-gen',
        title: '片尾免责声明字号',
        nextAction: '法务 PDF 已收到，剪辑按稿改一版',
        side: 'ours',
        isBlocking: false,
      },
    ],
    workflow: {
      sections: [
        {
          id: 's1',
          nodes: [
            node('outline', '大纲', 'done', { finishedDateLabel: '2月22日' }),
            node('script', '文案', 'done', { finishedDateLabel: '2月26日' }),
          ],
          parallelGroups: [
            [
              node('ar', 'A-roll', 'done', { finishedDateLabel: '3月1日' }),
              node('br', 'B-roll', 'done', { finishedDateLabel: '3月2日' }),
              node('ai', 'AI 后期', 'in_progress'),
            ],
          ],
        },
        {
          id: 's2',
          nodes: [
            node('rev', '审核', 'blocked', {
              blockingReason: '缺甲方暗光原图',
            }),
            node('pub', '发布', 'not_reached', { plannedDateLabel: '3月7日' }),
          ],
        },
      ],
    },
  },
  {
    id: 'proj-cosmetics-set',
    name: '国货彩妆「雾面三件套」',
    stageLabel: '制作并行包',
    listBucket: 'in_progress',
    hasConcreteBlockReason: false,
    overallStage: '拍摄与后期并行',
    inProgressNodeNames: ['A-roll', 'B-roll', 'AI 后期'],
    netAmountYuan: 45000,
    rebateAmountYuan: 4500,
    upcomingNodeSchedule: [
      { name: '审核', dateLabel: '3月11日' },
      { name: '发布', dateLabel: '3月13日' },
    ],
    finishedNodeSchedule: [
      { name: '大纲', dateLabel: '2月24日' },
      { name: '文案', dateLabel: '2月27日' },
    ],
    statusHeadline: '制作并行包进行中',
    published: false,
    archived: false,
    keywordHaystack: '彩妆 雾面 并行 A-roll B-roll',
    sortDate: '2026-03-11',
    openItems: [
      {
        id: 'oi-cos-1',
        projectId: 'proj-cosmetics-set',
        title: 'B-roll 产品微距镜头补拍',
        nextAction: '明天上午棚内补 20 分钟',
        plannedTime: '3月8日上午',
        side: 'ours',
        isBlocking: false,
      },
    ],
    workflow: {
      sections: [
        {
          id: 's1',
          nodes: [
            node('outline', '大纲', 'done', { finishedDateLabel: '2月24日' }),
            node('script', '文案', 'done', { finishedDateLabel: '2月27日' }),
            node('pre', '预拍摄', 'done', { finishedDateLabel: '3月1日' }),
          ],
          parallelGroups: [
            [
              node('ar', 'A-roll', 'in_progress'),
              node('br', 'B-roll', 'in_progress'),
              node('ai', 'AI 后期', 'in_progress'),
            ],
          ],
        },
        {
          id: 's2',
          nodes: [
            node('rev', '审核', 'not_reached', { plannedDateLabel: '3月11日' }),
            node('pub', '发布', 'not_reached', { plannedDateLabel: '3月13日' }),
          ],
        },
      ],
    },
  },
  {
    id: 'proj-camp-gear',
    name: '露营装备「轻量炉具」实测',
    stageLabel: '外拍并行',
    listBucket: 'in_progress',
    hasConcreteBlockReason: false,
    overallStage: '棚拍 + 山地外拍并行',
    inProgressNodeNames: ['A-roll', '外拍补充镜头'],
    netAmountYuan: 38000,
    rebateAmountYuan: 3800,
    upcomingNodeSchedule: [{ name: '成片', dateLabel: '3月16日' }],
    finishedNodeSchedule: [{ name: '文案', dateLabel: '3月3日' }],
    statusHeadline: '剪辑中',
    published: false,
    archived: false,
    keywordHaystack: '露营 炉具 外拍 山地',
    sortDate: '2026-03-16',
    openItems: [],
    workflow: {
      sections: [
        {
          id: 's1',
          nodes: [
            node('script', '文案', 'done', { finishedDateLabel: '3月3日' }),
            node('pre', '预拍摄', 'done', { finishedDateLabel: '3月4日' }),
          ],
          parallelGroups: [
            [
              node('ar', 'A-roll 棚拍', 'in_progress'),
              node('out', '外拍补充镜头', 'in_progress'),
              node('br', 'B-roll', 'not_reached'),
            ],
          ],
        },
        {
          id: 's2',
          nodes: [node('rev', '审核', 'not_reached'), node('pub', '发布', 'not_reached')],
        },
      ],
    },
  },
  {
    id: 'proj-board-prop',
    name: '桌游《夜航船》众筹开箱',
    stageLabel: '道具制作',
    listBucket: 'blocked_with_reason',
    hasConcreteBlockReason: true,
    blockedNodeName: 'A-roll 拍摄',
    blockedDays: 4,
    userFacingDeadline: '3月12日开拍',
    overallStage: '等手工道具',
    inProgressNodeNames: ['道具制作', 'A-roll'],
    mainBlockingItem: '1:6 船模手工涂装未完成',
    netAmountYuan: 28000,
    rebateAmountYuan: 2800,
    upcomingNodeSchedule: [
      { name: 'A-roll', dateLabel: '3月12日' },
      { name: '发布', dateLabel: '3月20日' },
    ],
    finishedNodeSchedule: [{ name: '大纲', dateLabel: '2月26日' }],
    statusHeadline: 'A-roll 拍摄',
    blockingReason: '船模道具未完工，开拍节点被挡',
    published: false,
    archived: false,
    keywordHaystack: '桌游 夜航船 道具 船模',
    sortDate: '2026-03-12',
    openItems: [
      {
        id: 'oi-board-1',
        projectId: 'proj-board-prop',
        title: '船模手工涂装',
        nextAction: '道具师周五前交付可上镜版本',
        plannedTime: '3月11日',
        side: 'ours',
        isBlocking: true,
      },
    ],
    workflow: {
      sections: [
        {
          id: 's1',
          nodes: [
            node('outline', '大纲', 'done', { finishedDateLabel: '2月26日' }),
            node('script', '文案', 'done', { finishedDateLabel: '3月1日' }),
            node('prop', '道具制作', 'in_progress', { plannedDateLabel: '3月11日' }),
            node('ar', 'A-roll 拍摄', 'blocked', {
              plannedDateLabel: '3月12日',
              blockingReason: '等手工船模',
            }),
          ],
        },
      ],
    },
  },
  {
    id: 'proj-drink-live',
    name: '功能饮料「电解」夏季档',
    stageLabel: '发布后收尾',
    listBucket: 'published_winding_down',
    hasConcreteBlockReason: false,
    overallStage: '已上线，结算与分发未完结',
    inProgressNodeNames: ['结算', '全平台分发', '数据维护'],
    netAmountYuan: 72000,
    rebateAmountYuan: 7200,
    upcomingNodeSchedule: [
      { name: '结算', dateLabel: '3月31日' },
      { name: '数据维护', dateLabel: '持续' },
    ],
    finishedNodeSchedule: [
      { name: '发布', dateLabel: '2月28日' },
      { name: '审核', dateLabel: '2月27日' },
    ],
    statusHeadline: '已上线',
    published: true,
    bvid: 'BV1mockDrink01',
    goLiveAtLabel: '2026年2月28日 18:00',
    archived: false,
    keywordHaystack: '功能饮料 电解 已发布 结算 分发',
    sortDate: '2026-02-28',
    openItems: [
      {
        id: 'oi-drink-1',
        projectId: 'proj-drink-live',
        title: '全平台分发链接汇总',
        nextAction: '把抖音、小红书链接填回给甲方',
        plannedTime: '3月10日前',
        side: 'ours',
        isBlocking: false,
      },
      {
        id: 'oi-drink-2',
        projectId: 'proj-drink-live',
        title: '甲方确认结算单',
        nextAction: '等品牌财务盖章扫描件',
        side: 'client',
        isBlocking: false,
      },
    ],
    workflow: {
      sections: [
        {
          id: 's1',
          nodes: [
            node('rev', '审核', 'done', { finishedDateLabel: '2月27日' }),
            node('pub', '发布', 'done', { finishedDateLabel: '2月28日' }),
          ],
          parallelGroups: [
            [
              node('settle', '结算', 'in_progress', { plannedDateLabel: '3月31日' }),
              node('dist', '全平台分发', 'in_progress'),
              node('data', '数据维护', 'in_progress'),
              node('other', '其他', 'not_reached'),
            ],
          ],
        },
      ],
    },
  },
  {
    id: 'proj-earbuds-rebate',
    name: '降噪耳机 Pro 深度体验',
    stageLabel: '待结算',
    listBucket: 'blocked_with_reason',
    hasConcreteBlockReason: true,
    blockedNodeName: '结算',
    blockedDays: 12,
    userFacingDeadline: '返点发票开出来后 5 个工作日',
    overallStage: '平台款已到账，返点待开票',
    inProgressNodeNames: ['结算'],
    mainBlockingItem: '返点公对公发票',
    netAmountYuan: 65000,
    rebateAmountYuan: 6500,
    upcomingNodeSchedule: [{ name: '结算收尾', dateLabel: '待发票' }],
    finishedNodeSchedule: [{ name: '发布', dateLabel: '1月15日' }],
    statusHeadline: '待结算',
    blockingReason: '甲方未开票，返点打款卡住',
    published: true,
    bvid: 'BV1mockEarbuds',
    goLiveAtLabel: '2026年1月15日 12:00',
    archived: false,
    keywordHaystack: '耳机 返点 发票 结算',
    sortDate: '2026-01-15',
    openItems: [
      {
        id: 'oi-ear-1',
        projectId: 'proj-earbuds-rebate',
        title: '返点增值税专用发票',
        nextAction: '催中介跟进品牌财务开票',
        plannedTime: '尽快',
        side: 'client',
        isBlocking: true,
      },
    ],
    workflow: {
      sections: [
        {
          id: 's1',
          nodes: [node('pub', '发布', 'done', { finishedDateLabel: '1月15日' })],
          parallelGroups: [
            [
              node('settle', '结算', 'blocked', {
                blockingReason: '甲方未开票',
              }),
              node('dist', '全平台分发', 'done', { finishedDateLabel: '1月16日' }),
              node('data', '数据维护', 'in_progress'),
            ],
          ],
        },
      ],
    },
  },
  {
    id: 'proj-camera-return',
    name: '全画幅相机 A7 寄拍还机',
    stageLabel: '还机',
    listBucket: 'in_progress',
    hasConcreteBlockReason: false,
    overallStage: '成片已交，等高价值样机寄回',
    inProgressNodeNames: ['审核', '还机'],
    netAmountYuan: 95000,
    rebateAmountYuan: 9500,
    upcomingNodeSchedule: [{ name: '还机', dateLabel: '3月9日' }],
    finishedNodeSchedule: [{ name: 'A-roll', dateLabel: '3月2日' }],
    statusHeadline: '审核中',
    published: false,
    archived: false,
    keywordHaystack: '相机 寄拍 还机 高价值',
    sortDate: '2026-03-09',
    openItems: [
      {
        id: 'oi-cam-1',
        projectId: 'proj-camera-return',
        title: '样机顺丰保价寄回',
        nextAction: '填单号发甲方仓库群，拍照留档',
        plannedTime: '3月9日',
        side: 'ours',
        isBlocking: false,
      },
    ],
    workflow: {
      sections: [
        {
          id: 's1',
          nodes: [
            node('ar', 'A-roll', 'done', { finishedDateLabel: '3月2日' }),
            node('rev', '审核', 'in_progress'),
            node('return', '高价值样机还机', 'in_progress', { plannedDateLabel: '3月9日' }),
            node('pub', '发布', 'not_reached', { plannedDateLabel: '3月14日' }),
          ],
        },
      ],
    },
  },
  {
    id: 'proj-archive-tea',
    name: '2025 秋·某茶叶礼盒（已结案）',
    stageLabel: '已归档',
    listBucket: 'archived',
    hasConcreteBlockReason: false,
    overallStage: '已结案归档',
    inProgressNodeNames: [],
    netAmountYuan: 24000,
    rebateAmountYuan: 2400,
    upcomingNodeSchedule: [],
    finishedNodeSchedule: [
      { name: '发布', dateLabel: '2025年10月1日' },
      { name: '结算', dateLabel: '2025年11月5日' },
    ],
    statusHeadline: '已结案',
    published: true,
    bvid: 'BV1mockTea2025',
    goLiveAtLabel: '2025年10月1日',
    archived: true,
    keywordHaystack: '茶叶 礼盒 归档 2025',
    sortDate: '2025-10-01',
    openItems: [],
    workflow: {
      sections: [
        {
          id: 's1',
          nodes: [
            node('pub', '发布', 'done', { finishedDateLabel: '2025/10/1' }),
            node('settle', '结算', 'done', { finishedDateLabel: '2025/11/5' }),
            node('close', '结案', 'done', { finishedDateLabel: '2025/11/20' }),
          ],
        },
      ],
    },
  },
];
