import type {
  AppState,
  Block,
  CaseDraft,
  CaseRecord,
  ConsentKey,
  Referral,
  ReferralDraft,
  SessionDraft,
  SessionRecord,
  VersionEntry,
} from "./types";

/* ---------------------------------- 常量 ---------------------------------- */

export const SUPERVISORS = ["王督导", "李督导", "赵督导"];

export const SLOTS = ["上午 09:00-10:00", "下午 14:00-15:00", "晚间 19:00-20:00"];

export const THEMES = ["焦虑", "亲密关系", "亲子", "职业压力"];

export const RISK_LEVELS = ["稳定", "关注", "高风险"] as const;

export const CONSENT_SCOPES: { key: ConsentKey; label: string; hint: string }[] = [
  { key: "recording", label: "录音", hint: "仅取得录音同意时可保存录音，否则只保存文字摘要" },
  { key: "supervision", label: "督导阅档", hint: "允许个案记录提交督导查阅" },
  { key: "research", label: "教学研究", hint: "脱敏后用于教学研究" },
];

export const FIELD_LABELS: Record<string, string> = {
  id: "来访者代号",
  theme: "咨询主题",
  scope: "同意范围",
  emergencyName: "紧急联系人",
  emergencyPhone: "联系电话",
  consentExpiry: "同意到期日",
  date: "会谈日期",
  slot: "会谈时段",
  risk: "风险等级",
  summary: "文字摘要",
  recordingName: "录音文件",
  supervisor: "接收督导",
  deadline: "响应期限",
  safetyPlan: "安全计划",
  reason: "更正原因",
  status: "转介状态",
};

/* --------------------------------- 小工具 --------------------------------- */

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function dateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function nowStamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 16);
}

let seq = 0;
export function uid(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

/* --------------------------- 录音同意有效性判定 --------------------------- */

/**
 * 判断个案在指定日期（默认今天）是否持有有效的录音同意：
 * 1) 同意范围含录音 2) 未撤回 3) 未到期。
 */
export function recordingConsentValid(c: CaseRecord | undefined, onDate: string = todayISO()): boolean {
  if (!c) return false;
  if (c.withdrawn) return false;
  if (!c.scope.includes("recording")) return false;
  return c.consentExpiry >= onDate;
}

export function consentBadge(c: CaseRecord | undefined, onDate: string = todayISO()): {
  text: string;
  tone: "ok" | "muted" | "warn" | "danger";
} {
  if (!c) return { text: "未登记", tone: "muted" };
  if (c.withdrawn) return { text: "同意已撤回 · 历史可查", tone: "danger" };
  if (!c.scope.includes("recording")) return { text: "无录音同意 · 仅文字摘要", tone: "muted" };
  if (c.consentExpiry < onDate) return { text: `同意已过期（${c.consentExpiry}）`, tone: "warn" };
  return { text: `录音同意有效 · 至 ${c.consentExpiry}`, tone: "ok" };
}

/* -------------------------------- 校验/受阻 -------------------------------- */

type BlockInput = Omit<Block, "id" | "at">;

function makeBlock(b: BlockInput): Block {
  return { ...b, id: uid("blk"), at: nowStamp() };
}

function show(v: string | null | undefined): string {
  return v === null || v === undefined || v === "" ? "（空）" : v;
}

function getCase(state: AppState, caseId: string): CaseRecord | undefined {
  return state.cases.find((c) => c.id === caseId);
}

/** 督导排班冲突：同一督导同一日期同一时段只能接一单（排除自身转介） */
export function supervisorBusy(state: AppState, date: string, slot: string, supervisor: string, excludeReferralId?: string): Referral | undefined {
  return state.referrals.find(
    (r) =>
      r.supervisor === supervisor &&
      r.date === date &&
      r.slot === slot &&
      r.id !== excludeReferralId,
  );
}

/** 个案登记校验，返回受阻列表（空数组表示通过） */
export function evaluateCase(draft: CaseDraft, state: AppState): Block[] {
  const blocks: Block[] = [];
  const bid = draft.id.trim();

  if (!bid) {
    blocks.push(makeBlock({ caseId: "（未填）", field: FIELD_LABELS.id, oldValue: "（空）", rule: "个案必须登记来访者代号" }));
  } else if (state.cases.some((c) => c.id === bid)) {
    blocks.push(makeBlock({ caseId: bid, field: FIELD_LABELS.id, oldValue: bid, rule: "来访者代号已存在，不得重复登记" }));
  }
  if (!THEMES.includes(draft.theme)) {
    blocks.push(makeBlock({ caseId: bid || "（未填）", field: FIELD_LABELS.theme, oldValue: show(draft.theme), rule: "咨询主题须从既定分类中选择" }));
  }
  if (draft.scope.length === 0) {
    blocks.push(makeBlock({ caseId: bid || "（未填）", field: FIELD_LABELS.scope, oldValue: "（未勾选）", rule: "至少勾选一项同意范围" }));
  }
  if (!draft.emergencyName.trim()) {
    blocks.push(makeBlock({ caseId: bid || "（未填）", field: FIELD_LABELS.emergencyName, oldValue: "（空）", rule: "必须登记紧急联系人" }));
  }
  if (!/^[0-9\-+ ]{7,20}$/.test(draft.emergencyPhone.trim())) {
    blocks.push(makeBlock({ caseId: bid || "（未填）", field: FIELD_LABELS.emergencyPhone, oldValue: show(draft.emergencyPhone), rule: "紧急联系电话须为 7-20 位数字" }));
  }
  if (!draft.consentExpiry) {
    blocks.push(makeBlock({ caseId: bid || "（未填）", field: FIELD_LABELS.consentExpiry, oldValue: "（空）", rule: "必须登记同意到期日" }));
  }
  return blocks;
}

/** 会谈（含高风险转介）校验，返回受阻列表（空数组表示通过） */
export function evaluateSession(
  draft: SessionDraft,
  referral: ReferralDraft | null,
  state: AppState,
  options: { mode: "create" | "correct"; original?: SessionRecord; existingReferral?: Referral } = { mode: "create" },
): Block[] {
  const blocks: Block[] = [];
  const c = getCase(state, draft.caseId);

  if (!c) {
    blocks.push(makeBlock({ caseId: draft.caseId || "（未选）", field: FIELD_LABELS.id, oldValue: show(draft.caseId), rule: "请先选择已登记个案" }));
    return blocks;
  }
  if (c.closed) {
    blocks.push(makeBlock({ caseId: c.id, field: FIELD_LABELS.status, oldValue: "已结案", rule: "个案已结案，不得再新增或更正会谈" }));
  }
  if (!draft.date) {
    blocks.push(makeBlock({ caseId: c.id, field: FIELD_LABELS.date, oldValue: "（空）", rule: "必须填写会谈日期" }));
  }
  if (!SLOTS.includes(draft.slot)) {
    blocks.push(makeBlock({ caseId: c.id, field: FIELD_LABELS.slot, oldValue: show(draft.slot), rule: "必须选择会谈时段" }));
  }
  if (!draft.summary.trim()) {
    blocks.push(makeBlock({ caseId: c.id, field: FIELD_LABELS.summary, oldValue: "（空）", rule: "文字摘要必填：未取得录音同意时只能保存文字摘要" }));
  }

  // 录音文件：仅当会谈日录音同意有效时可保存
  const wantsRecording = !!draft.recordingName && draft.recordingName.trim() !== "";
  const recordingChanged = options.mode === "create"
    ? wantsRecording
    : wantsRecording && (draft.recordingName ?? "") !== (options.original?.recordingName ?? "");
  const oldRecording = options.mode === "correct" ? show(options.original?.recordingName) : "（空）";

  if (recordingChanged) {
    if (c.withdrawn) {
      blocks.push(makeBlock({ caseId: c.id, field: FIELD_LABELS.recordingName, oldValue: oldRecording, rule: "录音同意已撤回：不得新增或替换录音，历史录音保留可查" }));
    } else if (!c.scope.includes("recording")) {
      blocks.push(makeBlock({ caseId: c.id, field: FIELD_LABELS.recordingName, oldValue: oldRecording, rule: "未取得录音同意：只能保存文字摘要，不得保存录音" }));
    } else if (c.consentExpiry < draft.date) {
      blocks.push(makeBlock({
        caseId: c.id,
        field: FIELD_LABELS.recordingName,
        oldValue: oldRecording,
        rule: `会谈日 ${draft.date || "（空）"} 已超过同意到期日 ${c.consentExpiry}：不得保存该会谈录音`,
      }));
    }
  }

  // 高风险会谈必须生成转介单
  if (draft.risk === "高风险") {
    const ref = referral ?? options.existingReferral ?? null;
    const sup = ref?.supervisor ?? "";
    if (!SUPERVISORS.includes(sup)) {
      blocks.push(makeBlock({ caseId: c.id, field: FIELD_LABELS.supervisor, oldValue: show(sup), rule: "高风险会谈必须指定接收督导并生成转介单" }));
    }
    if (!ref?.deadline) {
      blocks.push(makeBlock({ caseId: c.id, field: FIELD_LABELS.deadline, oldValue: "（空）", rule: "转介单必须写明响应期限" }));
    } else if (draft.date && ref.deadline < draft.date) {
      blocks.push(makeBlock({ caseId: c.id, field: FIELD_LABELS.deadline, oldValue: ref.deadline, rule: `响应期限不得早于会谈日期 ${draft.date}` }));
    }
    if (!ref?.safetyPlan.trim()) {
      blocks.push(makeBlock({ caseId: c.id, field: FIELD_LABELS.safetyPlan, oldValue: "（空）", rule: "转介单必须写明安全计划" }));
    }
    if (draft.date && SLOTS.includes(draft.slot) && SUPERVISORS.includes(sup)) {
      const clash = supervisorBusy(state, draft.date, draft.slot, sup, options.existingReferral?.id);
      if (clash) {
        blocks.push(makeBlock({
          caseId: c.id,
          field: FIELD_LABELS.supervisor,
          oldValue: sup,
          rule: `督导排班冲突：${sup} ${draft.date} ${draft.slot} 已接个案 ${clash.caseId}，同一时段只接一单`,
        }));
      }
    }
  }

  return blocks;
}

/* ----------------------------- 字段差异 / 留痕 ----------------------------- */

export interface FieldChange {
  field: string;
  oldValue: string;
  newValue: string;
}

const SESSION_FIELDS: { key: keyof SessionDraft; label: string }[] = [
  { key: "date", label: FIELD_LABELS.date },
  { key: "slot", label: FIELD_LABELS.slot },
  { key: "risk", label: FIELD_LABELS.risk },
  { key: "summary", label: FIELD_LABELS.summary },
  { key: "recordingName", label: FIELD_LABELS.recordingName },
];

export function diffSession(draft: SessionDraft, original: SessionRecord): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const { key, label } of SESSION_FIELDS) {
    const oldV = show(original[key] as string | null);
    const newV = show(draft[key] as string | null);
    if (oldV !== newV) changes.push({ field: label, oldValue: oldV, newValue: newV });
  }
  return changes;
}

export function buildVersionEntries(changes: FieldChange[], caseId: string, sessionId: string, reason: string): VersionEntry[] {
  return changes.map((ch) => ({
    id: uid("ver"),
    at: nowStamp(),
    caseId,
    sessionId,
    field: ch.field,
    oldValue: ch.oldValue,
    newValue: ch.newValue,
    reason,
  }));
}

/* --------------------------------- 示例数据 -------------------------------- */

export function seedState(): AppState {
  const stamp = nowStamp();
  const cases: CaseRecord[] = [
    {
      id: "C-042",
      theme: "焦虑",
      scope: ["recording", "supervision"],
      emergencyName: "陈女士（母亲）",
      emergencyPhone: "138-0000-0042",
      consentExpiry: dateOffset(60),
      withdrawn: false,
      withdrawnAt: null,
      closed: false,
      closedAt: null,
      createdAt: stamp,
    },
    {
      id: "C-119",
      theme: "亲密关系",
      scope: ["recording", "supervision", "research"],
      emergencyName: "周先生（配偶）",
      emergencyPhone: "139-0000-1190",
      consentExpiry: dateOffset(20),
      withdrawn: false,
      withdrawnAt: null,
      closed: false,
      closedAt: null,
      createdAt: stamp,
    },
    {
      id: "C-203",
      theme: "职业压力",
      scope: ["recording", "supervision"],
      emergencyName: "吴女士（姐姐）",
      emergencyPhone: "137-0000-2030",
      consentExpiry: dateOffset(-3),
      withdrawn: false,
      withdrawnAt: null,
      closed: false,
      closedAt: null,
      createdAt: stamp,
    },
    {
      id: "C-315",
      theme: "亲子",
      scope: ["supervision"], // 未勾选录音 → 只能保存文字摘要
      emergencyName: "孙先生（父亲）",
      emergencyPhone: "136-0000-3150",
      consentExpiry: dateOffset(-12),
      withdrawn: true,
      withdrawnAt: dateOffset(-12) + " 10:20",
      closed: false,
      closedAt: null,
      createdAt: stamp,
    },
  ];

  const sessions: SessionRecord[] = [
    {
      id: "S-042-1",
      caseId: "C-042",
      date: dateOffset(-2),
      slot: SLOTS[0],
      risk: "关注",
      summary: "睡眠改善，练习呼吸放松；下周继续焦虑日记。",
      recordingName: "C-042_2026_session08.m4a",
      createdAt: stamp,
    },
    {
      id: "S-119-1",
      caseId: "C-119",
      date: dateOffset(-1),
      slot: SLOTS[1],
      risk: "稳定",
      summary: "识别沟通中的回避模式，约定非暴力沟通练习。",
      recordingName: "C-119_session03.m4a",
      createdAt: stamp,
    },
    {
      id: "S-203-1",
      caseId: "C-203",
      date: dateOffset(-5),
      slot: SLOTS[2],
      risk: "高风险",
      summary: "连续失眠、自述“撑不下去”，有消极意念但无具体计划；已启动高风险转介流程。",
      recordingName: null,
      createdAt: stamp,
    },
    {
      id: "S-315-1",
      caseId: "C-315",
      date: dateOffset(-20),
      slot: SLOTS[0],
      risk: "稳定",
      summary: "亲子冲突复盘，历史录音在撤回同意前已留存，仅可查阅不得扩散。",
      recordingName: "C-315_session01.m4a",
      createdAt: stamp,
    },
  ];

  const referrals: Referral[] = [
    {
      id: "R-203-1",
      caseId: "C-203",
      sessionId: "S-203-1",
      supervisor: "王督导",
      date: sessions[2].date,
      slot: SLOTS[2],
      deadline: dateOffset(-3),
      safetyPlan:
        "1) 每 24 小时电话回访一次；2) 移除住所内备用药物；3) 与紧急联系人吴女士同住至风险解除；4) 出现具体自伤计划立即送急诊并拨打危机热线。",
      status: "待接收",
      createdAt: stamp,
      receivedAt: null,
    },
  ];

  return { cases, sessions, referrals, versions: [], blocks: [] };
}
