export type ConsentKey = "recording" | "supervision" | "research";

export type RiskLevel = "稳定" | "关注" | "高风险";

/** 个案登记 */
export interface CaseRecord {
  id: string; // 来访者代号
  theme: string; // 咨询主题
  scope: ConsentKey[]; // 同意范围
  emergencyName: string; // 紧急联系人
  emergencyPhone: string; // 紧急联系电话
  consentExpiry: string; // 同意到期日 yyyy-mm-dd
  withdrawn: boolean; // 同意是否已撤回
  withdrawnAt: string | null;
  closed: boolean; // 是否结案
  closedAt: string | null;
  createdAt: string;
}

/** 会谈记录（文字摘要 + 可选录音） */
export interface SessionRecord {
  id: string;
  caseId: string;
  date: string; // 会谈日期
  slot: string; // 会谈时段
  risk: RiskLevel; // 风险等级
  summary: string; // 文字摘要
  recordingName: string | null; // 录音文件名，仅在录音同意有效时可保存
  createdAt: string;
}

/** 高风险转介单 */
export interface Referral {
  id: string;
  caseId: string;
  sessionId: string;
  supervisor: string; // 接收督导
  date: string; // 会谈日期（与时段共同构成督导排班占用）
  slot: string; // 会谈时段
  deadline: string; // 响应期限
  safetyPlan: string; // 安全计划
  status: "待接收" | "已接收";
  createdAt: string;
  receivedAt: string | null;
}

/** 会后更正的字段级版本留痕 */
export interface VersionEntry {
  id: string;
  at: string;
  caseId: string;
  sessionId: string;
  field: string; // 字段
  oldValue: string; // 原值
  newValue: string; // 更正后值
  reason: string; // 更正原因
}

/** 受阻记录：个案 / 字段 / 原值 / 规则 */
export interface Block {
  id: string;
  at: string;
  caseId: string;
  field: string;
  oldValue: string;
  rule: string;
}

export interface AppState {
  cases: CaseRecord[];
  sessions: SessionRecord[];
  referrals: Referral[];
  versions: VersionEntry[];
  blocks: Block[];
}

export interface CaseDraft {
  id: string;
  theme: string;
  scope: ConsentKey[];
  emergencyName: string;
  emergencyPhone: string;
  consentExpiry: string;
}

export interface SessionDraft {
  caseId: string;
  date: string;
  slot: string;
  risk: RiskLevel;
  summary: string;
  recordingName: string | null;
}

export interface ReferralDraft {
  supervisor: string;
  deadline: string;
  safetyPlan: string;
}
