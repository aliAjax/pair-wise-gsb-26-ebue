// 录音同意与高风险转介台账 —— 领域模型

/** 风险等级：会谈的风险标记，高风险必须生成转介单 */
export type RiskLevel = "稳定" | "关注" | "高风险";

/** 录音同意范围 */
export type ConsentScope = "仅督导抽听" | "内部教学" | "科研脱敏" | "不同意";

/** 转介单状态 */
export type ReferralStatus = "待接收" | "已接收";

/** 个案状态：高风险转介未被督导接收前，不得结案 */
export type CaseStatus = "进行中" | "已结案";

/** 版本关系中变更涉及的对象类型 */
export type VersionKind =
  | "个案登记"
  | "同意"
  | "会谈"
  | "转介"
  | "会后更正"
  | "结案";

/** 录音载体的可见范围：未取得录音同意时只能保存文字摘要 */
export interface Recording {
  /** 文字摘要始终可存 */
  summary: string;
  /** 音频文件名/标识；无有效同意或同意仅文字时为 null */
  audioName: string | null;
  /** 录制时采用的同意范围 */
  scopeAtRecording: Exclude<ConsentScope, "不同意"> | null;
}

/** 同意事件：登记/变更均留版本；撤回只改状态，历史录音与版本仍可查 */
export interface Consent {
  scope: ConsentScope;
  agreedFrom: string; // ISO 日期
  expiresAt: string; // ISO 到期日
  active: boolean;
  history: ConsentHistoryItem[];
}

export interface ConsentHistoryItem {
  at: string;
  scope: ConsentScope;
  action: "登记" | "变更" | "撤回";
  reason: string;
  versionId: string;
}

/** 个案档案 */
export interface CaseFile {
  id: string; // C-042 形式
  code: string; // 来访者代号
  topic: string; // 咨询主题
  status: CaseStatus;
  emergencyName: string; // 紧急联系人
  emergencyPhone: string;
  consent: Consent;
  sessionIds: string[];
  createdAt: string;
}

/** 高风险会谈 */
export interface Session {
  id: string;
  caseId: string;
  heldAt: string; // ISO 日期时间
  risk: RiskLevel;
  concern: string; // 主要困扰/风险描述
  intervention: string; // 干预方法
  nextGoal: string; // 下次目标
  recording: Recording;
  referralId: string | null; // 高风险会谈必须关联转介单
  closed: boolean; // 会谈是否随个案结案
}

/** 转介单：写明接收督导、响应期限和安全计划 */
export interface Referral {
  id: string;
  caseId: string;
  sessionId: string;
  supervisorId: string;
  slot: string; // 督导时段
  responseDue: string; // ISO 响应期限
  safetyPlan: string; // 安全计划
  status: ReferralStatus;
  acceptedAt: string | null;
  createdAt: string;
}

/** 会后更正：保留原因和旧值 */
export interface FieldChange {
  field: string;
  oldValue: string;
  newValue: string;
}

/** 版本流水：每次登记/撤回/会谈/转介/更正一条 */
export interface VersionEntry {
  id: string;
  seq: number;
  at: string;
  kind: VersionKind;
  caseId: string;
  sessionId: string | null;
  referralId: string | null;
  reason: string;
  changes: FieldChange[];
}

/** 督导排班：同一督导同一时段只接一单 */
export interface Supervisor {
  id: string;
  name: string;
  title: string;
  slots: string[];
}

/** 被规则阻止的操作：列出个案、字段、原值和规则 */
export interface Blocker {
  id: string;
  at: string;
  caseId: string;
  action: string;
  field: string;
  oldValue: string;
  rule: string;
}

export interface AppState {
  cases: Record<string, CaseFile>;
  sessions: Record<string, Session>;
  referrals: Record<string, Referral>;
  versions: VersionEntry[];
  supervisors: Supervisor[];
  blockers: Blocker[];
}

/** 操作结果：成功返回实体 id，失败返回阻断原因 */
export interface ActionResult {
  ok: boolean;
  id?: string;
  blocker?: {
    caseId: string;
    action: string;
    field: string;
    oldValue: string;
    rule: string;
  };
}
