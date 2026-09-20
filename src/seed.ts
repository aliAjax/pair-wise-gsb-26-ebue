import type { AppState, CaseFile, Session, Referral, VersionEntry, Blocker } from "./types";
import { SUPERVISOR_SLOTS, bumpSeq } from "./rules";

/**
 * 台账演示数据（基准日 2026-09-20）：
 * C-042 有效同意 / 高风险转介待接收且已逾期 / 不能结案
 * C-119 有效同意（内部教学）/ 稳定
 * C-203 同意已撤回：旧会谈有录音仍可查，新会谈仅文字摘要
 * C-308 高风险转介已接收
 * C-356 从未同意录音：仅文字摘要
 * C-417 已结案
 */
export function buildSeed(): AppState {
  const supervisors = [
    { id: "SUP-WANG", name: "王岚", title: "督导主任", slots: [...SUPERVISOR_SLOTS] },
    {
      id: "SUP-ZHAO",
      name: "赵衡",
      title: "资深督导",
      slots: ["周二 09:00-10:00", "周三 10:00-11:00", "周五 09:00-10:00"],
    },
    {
      id: "SUP-CHEN",
      name: "陈屿",
      title: "注册督导",
      slots: ["周二 14:00-15:00", "周四 14:00-15:00"],
    },
  ];

  const mkCase = (
    id: string,
    code: string,
    topic: string,
    emergencyName: string,
    emergencyPhone: string,
    consent: CaseFile["consent"],
    sessionIds: string[],
    status: CaseFile["status"] = "进行中",
    createdAt = "2026-07-15T09:30:00.000Z"
  ): CaseFile => ({
    id,
    code,
    topic,
    status,
    emergencyName,
    emergencyPhone,
    consent,
    sessionIds,
    createdAt,
  });

  const consent = (
    scope: CaseFile["consent"]["scope"],
    agreedFrom: string,
    expiresAt: string,
    active = true
  ): CaseFile["consent"] => ({ scope, agreedFrom, expiresAt, active, history: [] });

  const cases: Record<string, CaseFile> = {
    "C-042": mkCase(
      "C-042",
      "林某（27岁/互联网运营）",
      "焦虑",
      "林建国（父亲）",
      "138-0571-2211",
      consent("仅督导抽听", "2026-07-15", "2026-12-31"),
      ["S-1001", "S-1002"]
    ),
    "C-119": mkCase(
      "C-119",
      "周某（31岁/教师）",
      "亲密关系",
      "周琳（姐姐）",
      "139-1120-8845",
      consent("内部教学", "2026-06-01", "2026-11-30"),
      ["S-1003"],
      "进行中",
      "2026-06-01T10:00:00.000Z"
    ),
    "C-203": mkCase(
      "C-203",
      "何某（34岁/财务）",
      "职业压力",
      "何敏（配偶）",
      "137-6621-0934",
      (() => {
        const c = consent("仅督导抽听", "2026-08-20", "2027-02-19", false);
        c.history = [
          {
            at: "2026-09-10T16:20:00.000Z",
            scope: "仅督导抽听",
            action: "撤回",
            reason:
              "来访者来电表示不愿再被录音，后续仅保留文字摘要；已确认既往录音不删除，仅限本人调阅与督导需要。",
            versionId: "V-012",
          },
        ];
        return c;
      })(),
      ["S-1004", "S-1005"],
      "进行中",
      "2026-08-20T13:00:00.000Z"
    ),
    "C-308": mkCase(
      "C-308",
      "高某（29岁/全职妈妈）",
      "亲子",
      "高芳（妹妹）",
      "136-9902-4471",
      consent("仅督导抽听", "2026-08-28", "2026-12-28"),
      ["S-1006"],
      "进行中",
      "2026-08-28T09:00:00.000Z"
    ),
    "C-356": mkCase(
      "C-356",
      "陈某（22岁/应届生）",
      "焦虑",
      "陈桂兰（母亲）",
      "135-3382-7720",
      consent("不同意", "2026-09-01", "2027-08-31"),
      ["S-1007"],
      "进行中",
      "2026-09-01T11:00:00.000Z"
    ),
    "C-417": mkCase(
      "C-417",
      "赵某（40岁/工程师）",
      "职业压力",
      "赵鹏（友人）",
      "131-7745-7092",
      consent("仅督导抽听", "2026-05-10", "2026-11-09"),
      ["S-1008"],
      "已结案",
      "2026-05-10T14:00:00.000Z"
    ),
  };

  const sessions: Record<string, Session> = {
    "S-1001": {
      id: "S-1001",
      caseId: "C-042",
      heldAt: "2026-09-08T10:00:00.000Z",
      risk: "关注",
      concern: "入睡困难、心悸，工作汇报前焦虑发作",
      intervention: "呼吸放松训练、认知解离练习",
      nextGoal: "每日两次呼吸练习并记录睡眠时长",
      recording: { summary: "来访者汇报上周三次夜醒，练习腹式呼吸后可再度入睡。", audioName: "C-042-0908.m4a", scopeAtRecording: "仅督导抽听" },
      referralId: null,
      closed: false,
    },
    "S-1002": {
      id: "S-1002",
      caseId: "C-042",
      heldAt: "2026-09-15T10:00:00.000Z",
      risk: "高风险",
      concern: "提及自残念头，上周有掐自己手臂行为，风险评估第9项阳性",
      intervention: "即时安全评估、移除利器约定、同步紧急联系人",
      nextGoal: "执行安全计划至督导复盘，每日报平安",
      recording: { summary: "来访者情绪崩溃后可合作，愿意交出美工刀；已致电林父。", audioName: "C-042-0915.m4a", scopeAtRecording: "仅督导抽听" },
      referralId: "R-2001",
      closed: false,
    },
    "S-1003": {
      id: "S-1003",
      caseId: "C-119",
      heldAt: "2026-09-10T14:00:00.000Z",
      risk: "稳定",
      concern: "识别与伴侣冲突中的回避模式",
      intervention: "情绪聚焦疗法（EFT）情绪唤起练习",
      nextGoal: "本周尝试一次主动表达需求",
      recording: { summary: "来访者能命名“被抛弃感”，练习中情绪唤起充分。", audioName: "C-119-0910.m4a", scopeAtRecording: "内部教学" },
      referralId: null,
      closed: false,
    },
    "S-1004": {
      id: "S-1004",
      caseId: "C-203",
      heldAt: "2026-09-03T15:00:00.000Z",
      risk: "关注",
      concern: "绩效面谈后持续失眠、哭泣",
      intervention: "资源发掘、边界梳理",
      nextGoal: "整理下周可拒绝的三项任务",
      recording: { summary: "撤回同意前录制：来访者梳理调岗传闻带来的失控感。", audioName: "C-203-0903.m4a", scopeAtRecording: "仅督导抽听" },
      referralId: null,
      closed: false,
    },
    "S-1005": {
      id: "S-1005",
      caseId: "C-203",
      heldAt: "2026-09-17T15:00:00.000Z",
      risk: "关注",
      concern: "被调岗后情绪低落，但朋友支持尚可",
      intervention: "行为激活、社交支持清单",
      nextGoal: "每天外出散步一次",
      recording: { summary: "（同意已撤回，仅文字摘要）来访者主诉情绪较上周平稳，已与主管沟通调岗细节。", audioName: null, scopeAtRecording: null },
      referralId: null,
      closed: false,
    },
    "S-1006": {
      id: "S-1006",
      caseId: "C-308",
      heldAt: "2026-09-11T11:00:00.000Z",
      risk: "高风险",
      concern: "亲子冲突后抓扯孩子，强烈自责并出现伤己念头",
      intervention: "家庭暴力风险评估、安全计划、即时转介督导",
      nextGoal: "09-15 前完成家长情绪管理门诊预约",
      recording: { summary: "来访者承诺冲突时离开现场并联系妹妹；已预约督导。", audioName: "C-308-0911.m4a", scopeAtRecording: "仅督导抽听" },
      referralId: "R-2002",
      closed: false,
    },
    "S-1007": {
      id: "S-1007",
      caseId: "C-356",
      heldAt: "2026-09-16T09:00:00.000Z",
      risk: "关注",
      concern: "考前反复检查、拖延",
      intervention: "暴露练习分级表",
      nextGoal: "完成最低一级暴露任务",
      recording: { summary: "（来访者不同意录音，仅文字摘要）共同制定三级暴露阶梯。", audioName: null, scopeAtRecording: null },
      referralId: null,
      closed: false,
    },
    "S-1008": {
      id: "S-1008",
      caseId: "C-417",
      heldAt: "2026-08-27T10:00:00.000Z",
      risk: "稳定",
      concern: "结案回顾，情绪调节能力稳定",
      intervention: "复发预防计划",
      nextGoal: "一月后自助复诊",
      recording: { summary: "结案会谈，来访者演示了两次压力场景应对。", audioName: "C-417-0827.m4a", scopeAtRecording: "仅督导抽听" },
      referralId: null,
      closed: true,
    },
  };

  const referrals: Record<string, Referral> = {
    "R-2001": {
      id: "R-2001",
      caseId: "C-042",
      sessionId: "S-1002",
      supervisorId: "SUP-WANG",
      slot: "周二 09:00-10:00",
      responseDue: "2026-09-18",
      safetyPlan:
        "1) 每日 20:00 自评冲动程度（0-10）并向咨询师短信报平安；2) 紧急联系人林建国 138-0571-2211 已知情；3) 尖锐器具由室友代管；4) 冲动≥7 分拨打 12320 或前往市七医院急诊；5) 王岚督导 09-18 前完成接收与风险复盘。",
      status: "待接收",
      acceptedAt: null,
      createdAt: "2026-09-15T11:00:00.000Z",
    },
    "R-2002": {
      id: "R-2002",
      caseId: "C-308",
      sessionId: "S-1006",
      supervisorId: "SUP-WANG",
      slot: "周二 14:00-15:00",
      responseDue: "2026-09-15",
      safetyPlan:
        "1) 冲突升级时先离开房间并致电妹妹高芳 136-9902-4471；2) 孩子暂由母亲接走两天；3) 09-15 前预约家长情绪管理门诊；4) 出现伤己/伤人念头立即急诊；5) 督导王岚接收后每周复盘一次。",
      status: "已接收",
      acceptedAt: "2026-09-12T16:30:00.000Z",
      createdAt: "2026-09-11T12:00:00.000Z",
    },
  };

  const versions: VersionEntry[] = [
    { id: "V-001", seq: 1, at: "2026-05-10T14:00:00.000Z", kind: "个案登记", caseId: "C-417", sessionId: null, referralId: null, reason: "首次建档登记", changes: [
      { field: "来访者代号", oldValue: "", newValue: "赵某（40岁/工程师）" },
      { field: "咨询主题", oldValue: "", newValue: "职业压力" },
      { field: "紧急联系人", oldValue: "", newValue: "赵鹏（友人） 131-7745-7092" },
      { field: "同意范围", oldValue: "", newValue: "仅督导抽听（至2026-11-09）" },
    ]},
    { id: "V-002", seq: 2, at: "2026-06-01T10:00:00.000Z", kind: "个案登记", caseId: "C-119", sessionId: null, referralId: null, reason: "首次建档登记", changes: [
      { field: "来访者代号", oldValue: "", newValue: "周某（31岁/教师）" },
      { field: "咨询主题", oldValue: "", newValue: "亲密关系" },
      { field: "紧急联系人", oldValue: "", newValue: "周琳（姐姐） 139-1120-8845" },
      { field: "同意范围", oldValue: "", newValue: "内部教学（至2026-11-30）" },
    ]},
    { id: "V-003", seq: 3, at: "2026-07-15T09:30:00.000Z", kind: "个案登记", caseId: "C-042", sessionId: null, referralId: null, reason: "首次建档登记", changes: [
      { field: "来访者代号", oldValue: "", newValue: "林某（27岁/互联网运营）" },
      { field: "咨询主题", oldValue: "", newValue: "焦虑" },
      { field: "紧急联系人", oldValue: "", newValue: "林建国（父亲） 138-0571-2211" },
      { field: "同意范围", oldValue: "", newValue: "仅督导抽听（至2026-12-31）" },
    ]},
    { id: "V-004", seq: 4, at: "2026-08-20T13:00:00.000Z", kind: "个案登记", caseId: "C-203", sessionId: null, referralId: null, reason: "首次建档登记", changes: [
      { field: "来访者代号", oldValue: "", newValue: "何某（34岁/财务）" },
      { field: "同意范围", oldValue: "", newValue: "仅督导抽听（至2027-02-19）" },
    ]},
    { id: "V-005", seq: 5, at: "2026-08-28T09:00:00.000Z", kind: "个案登记", caseId: "C-308", sessionId: null, referralId: null, reason: "首次建档登记", changes: [
      { field: "来访者代号", oldValue: "", newValue: "高某（29岁/全职妈妈）" },
      { field: "同意范围", oldValue: "", newValue: "仅督导抽听（至2026-12-28）" },
    ]},
    { id: "V-006", seq: 6, at: "2026-09-01T11:00:00.000Z", kind: "个案登记", caseId: "C-356", sessionId: null, referralId: null, reason: "首次建档登记（来访者明确不同意录音）", changes: [
      { field: "来访者代号", oldValue: "", newValue: "陈某（22岁/应届生）" },
      { field: "同意范围", oldValue: "", newValue: "不同意（仅文字摘要，至2027-08-31）" },
    ]},
    { id: "V-007", seq: 7, at: "2026-09-08T11:00:00.000Z", kind: "会谈", caseId: "C-042", sessionId: "S-1001", referralId: null, reason: "会谈记录归档", changes: [
      { field: "风险等级", oldValue: "", newValue: "关注" },
      { field: "录音", oldValue: "", newValue: "C-042-0908.m4a（录制时同意：仅督导抽听）" },
    ]},
    { id: "V-008", seq: 8, at: "2026-09-09T11:00:00.000Z", kind: "会后更正", caseId: "C-042", sessionId: "S-1001", referralId: null, reason: "来访者会后补充手环睡眠数据，据此更正下次目标", changes: [
      { field: "下次目标", oldValue: "记录睡眠情况", newValue: "每日两次呼吸练习并记录睡眠时长" },
    ]},
    { id: "V-009", seq: 9, at: "2026-09-15T11:00:00.000Z", kind: "会谈", caseId: "C-042", sessionId: "S-1002", referralId: null, reason: "高风险会谈记录归档", changes: [
      { field: "风险等级", oldValue: "关注", newValue: "高风险" },
      { field: "录音", oldValue: "", newValue: "C-042-0915.m4a（录制时同意：仅督导抽听）" },
    ]},
    { id: "V-010", seq: 10, at: "2026-09-15T11:05:00.000Z", kind: "转介", caseId: "C-042", sessionId: "S-1002", referralId: "R-2001", reason: "高风险会谈自动生成转介单", changes: [
      { field: "接收督导", oldValue: "", newValue: "王岚 · 周二 09:00-10:00" },
      { field: "响应期限", oldValue: "", newValue: "2026-09-18" },
      { field: "安全计划", oldValue: "", newValue: "已录入5项安全计划" },
      { field: "状态", oldValue: "", newValue: "待接收" },
    ]},
    { id: "V-011", seq: 11, at: "2026-09-10T15:00:00.000Z", kind: "会谈", caseId: "C-119", sessionId: "S-1003", referralId: null, reason: "会谈记录归档", changes: [
      { field: "风险等级", oldValue: "", newValue: "稳定" },
      { field: "录音", oldValue: "", newValue: "C-119-0910.m4a（录制时同意：内部教学）" },
    ]},
    { id: "V-012", seq: 12, at: "2026-09-10T16:20:00.000Z", kind: "同意", caseId: "C-203", sessionId: null, referralId: null, reason: "来访者来电撤回录音同意：后续仅保留文字摘要；既往录音不删除，仅限本人调阅与督导需要。", changes: [
      { field: "同意状态", oldValue: "有效（仅督导抽听）", newValue: "已撤回（历史可查）" },
    ]},
    { id: "V-013", seq: 13, at: "2026-09-03T16:00:00.000Z", kind: "会谈", caseId: "C-203", sessionId: "S-1004", referralId: null, reason: "撤回同意前会谈记录归档", changes: [
      { field: "风险等级", oldValue: "", newValue: "关注" },
      { field: "录音", oldValue: "", newValue: "C-203-0903.m4a（录制时同意：仅督导抽听，撤回后历史仍可查）" },
    ]},
    { id: "V-014", seq: 14, at: "2026-09-17T16:00:00.000Z", kind: "会谈", caseId: "C-203", sessionId: "S-1005", referralId: null, reason: "同意撤回后会谈：仅文字摘要", changes: [
      { field: "风险等级", oldValue: "", newValue: "关注" },
      { field: "录音", oldValue: "C-203-0917.m4a（拟上传）", newValue: "仅文字摘要（R1）" },
    ]},
    { id: "V-015", seq: 15, at: "2026-09-11T12:00:00.000Z", kind: "会谈", caseId: "C-308", sessionId: "S-1006", referralId: null, reason: "高风险会谈记录归档", changes: [
      { field: "风险等级", oldValue: "关注", newValue: "高风险" },
    ]},
    { id: "V-016", seq: 16, at: "2026-09-11T12:05:00.000Z", kind: "转介", caseId: "C-308", sessionId: "S-1006", referralId: "R-2002", reason: "高风险会谈自动生成转介单", changes: [
      { field: "接收督导", oldValue: "王岚 · 周二 09:00-10:00（被R4阻断）", newValue: "王岚 · 周二 14:00-15:00" },
      { field: "响应期限", oldValue: "", newValue: "2026-09-15" },
      { field: "状态", oldValue: "", newValue: "待接收" },
    ]},
    { id: "V-017", seq: 17, at: "2026-09-12T16:30:00.000Z", kind: "转介", caseId: "C-308", sessionId: "S-1006", referralId: "R-2002", reason: "督导王岚完成接收并确认安全计划", changes: [
      { field: "状态", oldValue: "待接收", newValue: "已接收" },
    ]},
    { id: "V-018", seq: 18, at: "2026-09-16T10:00:00.000Z", kind: "会谈", caseId: "C-356", sessionId: "S-1007", referralId: null, reason: "不同意录音：仅文字摘要", changes: [
      { field: "风险等级", oldValue: "", newValue: "关注" },
      { field: "录音", oldValue: "C-356-0916.m4a（拟上传）", newValue: "仅文字摘要（R1）" },
    ]},
    { id: "V-019", seq: 19, at: "2026-08-27T11:00:00.000Z", kind: "会谈", caseId: "C-417", sessionId: "S-1008", referralId: null, reason: "结案会谈归档", changes: [
      { field: "风险等级", oldValue: "", newValue: "稳定" },
    ]},
    { id: "V-020", seq: 20, at: "2026-08-28T09:00:00.000Z", kind: "结案", caseId: "C-417", sessionId: null, referralId: null, reason: "无未接收转介，结案自评通过，予以结案", changes: [
      { field: "个案状态", oldValue: "进行中", newValue: "已结案" },
    ]},
  ];

  const blockers: Blocker[] = [
    { id: "BL-1", at: "2026-09-19T09:12:00.000Z", caseId: "C-042", action: "个案结案", field: "个案状态", oldValue: "进行中", rule: "R5" },
    { id: "BL-2", at: "2026-09-11T11:55:00.000Z", caseId: "C-308", action: "高风险转介派单", field: "督导时段", oldValue: "王岚 / 周二 09:00-10:00", rule: "R4" },
    { id: "BL-3", at: "2026-09-17T15:40:00.000Z", caseId: "C-203", action: "会谈录音保存", field: "录音文件", oldValue: "C-203-0917.m4a", rule: "R1" },
    { id: "BL-4", at: "2026-09-16T10:05:00.000Z", caseId: "C-356", action: "会谈录音保存", field: "录音文件", oldValue: "C-356-0916.m4a", rule: "R1" },
    { id: "BL-5", at: "2026-09-09T10:50:00.000Z", caseId: "C-042", action: "会后更正", field: "更正原因", oldValue: "（空）", rule: "R6" },
  ];

  versions.forEach((v) => bumpSeq(v.seq));

  return { cases, sessions, referrals, versions, supervisors, blockers };
}
