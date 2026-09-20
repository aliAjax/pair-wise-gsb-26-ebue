import type {
  ActionResult,
  AppState,
  CaseFile,
  Consent,
  ConsentScope,
  FieldChange,
  Referral,
  Session,
  VersionEntry,
} from "./types";

export const SUPERVISOR_SLOTS = [
  "周二 09:00-10:00",
  "周二 14:00-15:00",
  "周三 10:00-11:00",
  "周四 14:00-15:00",
  "周五 09:00-10:00",
];

/** 台账明文规则，供"规则"面板与阻断记录引用同一措辞 */
export const RULES = {
  R1: "R1 录音同意：未取得有效录音同意（含未登记、已撤回、已过期或范围为不同意）的会谈只能保存文字摘要，不得保存音频。",
  R2: "R2 撤回留痕：同意撤回必须填写原因；撤回后停止新录音，但历史录音与版本记录仍可查阅。",
  R3: "R3 高风险转介：高风险会谈必须生成转介单，写明接收督导、响应期限和安全计划，否则会谈不得登记。",
  R4: "R4 督导排班：同一督导同一时段只接一单；时段已占用时不得再派单。",
  R5: "R5 结案前置：个案存在未被督导接收的转介单时不得结案。",
  R6: "R6 会后更正：会后更正必须填写原因并保留字段旧值，旧值进入版本流水不得覆盖。",
  R7: "R7 一致性：刷新后同意状态、转介接收状态与版本关系必须一致，缺失关联即判定台账异常。",
} as const;

export const todayISO = () => "2026-09-20";

export function daysFromToday(days: number): string {
  const d = new Date(Date.UTC(2026, 8, 20) + days * 86400000);
  return d.toISOString().slice(0, 10);
}

export function nowStamp(): string {
  return new Date().toISOString();
}

/**
 * 同意在某个时点是否有效（用于判定该时点录制的音频是否合规）：
 * 只看范围与日期区间。撤回只影响"此后"的新录音，不溯及既往（R2 历史仍可查）。
 */
export function consentValidAt(consent: Consent | undefined, atISO: string): boolean {
  if (!consent) return false;
  if (consent.scope === "不同意") return false;
  const day = atISO.slice(0, 10);
  return day >= consent.agreedFrom && day <= consent.expiresAt;
}

/** 当前能否进行新录音：时点有效且未撤回 */
export function canRecordNow(consent: Consent | undefined, atISO: string): boolean {
  return !!consent && consent.active && consentValidAt(consent, atISO);
}

export function consentStatus(consent: Consent | undefined): {
  label: string;
  tone: "ok" | "warn" | "muted";
} {
  if (!consent) return { label: "未登记", tone: "muted" };
  if (!consent.active) return { label: "已撤回（历史可查）", tone: "warn" };
  if (consent.scope === "不同意") return { label: "仅文字摘要", tone: "warn" };
  if (todayISO() > consent.expiresAt) return { label: "已过期", tone: "warn" };
  return { label: `有效 · ${consent.scope}`, tone: "ok" };
}

export function caseRisk(file: CaseFile, state: AppState) {
  const risks = file.sessionIds
    .map((id) => state.sessions[id])
    .filter(Boolean)
    .map((s) => s.risk);
  if (risks.includes("高风险")) return "高风险";
  if (risks.includes("关注")) return "关注";
  return "稳定";
}

/** R4：同一督导同一时段是否已被一单占用（可排除当前转介单，用于改派） */
export function slotTaken(
  state: AppState,
  supervisorId: string,
  slot: string,
  excludeReferralId?: string
): Referral | undefined {
  return Object.values(state.referrals).find(
    (r) =>
      r.supervisorId === supervisorId &&
      r.slot === slot &&
      r.id !== excludeReferralId
  );
}

/** R5：个案是否存在未接收转介 */
export function pendingReferrals(state: AppState, caseId: string): Referral[] {
  return Object.values(state.referrals).filter(
    (r) => r.caseId === caseId && r.status === "待接收"
  );
}

export function buildBlocker(
  caseId: string,
  action: string,
  field: string,
  oldValue: string,
  rule: string
): NonNullable<ActionResult["blocker"]> {
  return { caseId, action, field, oldValue, rule };
}

export function diffFields(
  before: Record<string, string>,
  after: Record<string, string>
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const key of Object.keys(after)) {
    if (String(before[key] ?? "") !== String(after[key] ?? "")) {
      changes.push({
        field: key,
        oldValue: String(before[key] ?? ""),
        newValue: String(after[key] ?? ""),
      });
    }
  }
  return changes;
}

let seqCounter = 0;
export function nextVersionSeq(state: AppState): number {
  return Math.max(state.versions.reduce((m, v) => Math.max(m, v.seq), 0), seqCounter) + 1;
}
export function bumpSeq(seq: number) {
  seqCounter = Math.max(seqCounter, seq);
}

export function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

/** R7：刷新后的一致性体检：同意/转介/版本之间的关系必须完整 */
export interface ConsistencyIssue {
  level: "异常" | "提示";
  text: string;
}

export function consistencyCheck(state: AppState): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];

  for (const file of Object.values(state.cases)) {
    // 每个有效同意状态都应有"同意"类版本
    const hasConsentVersion = state.versions.some(
      (v) => v.caseId === file.id && (v.kind === "个案登记" || v.kind === "同意")
    );
    if (!hasConsentVersion) {
      issues.push({ level: "异常", text: `个案 ${file.id} 缺少同意登记版本（R7）` });
    }
    for (const sid of file.sessionIds) {
      const session = state.sessions[sid];
      if (!session) {
        issues.push({ level: "异常", text: `个案 ${file.id} 的会谈 ${sid} 已丢失（R7）` });
        continue;
      }
      // 高风险会谈必须挂转介单，且转介单反向指向该会谈
      if (session.risk === "高风险") {
        const ref = session.referralId ? state.referrals[session.referralId] : undefined;
        if (!ref) {
          issues.push({
            level: "异常",
            text: `高风险会谈 ${session.id}（${file.id}）缺少转介单（R3/R7）`,
          });
        } else if (ref.sessionId !== session.id) {
          issues.push({
            level: "异常",
            text: `转介单 ${ref.id} 与会谈 ${session.id} 的关联不一致（R7）`,
          });
        }
      }
      // 有音频就必须有录制时的有效同意范围
      if (session.recording.audioName && !session.recording.scopeAtRecording) {
        issues.push({
          level: "异常",
          text: `会谈 ${session.id} 存有音频但无录制时同意范围（R1/R7）`,
        });
      }
      // 无同意却存了音频
      if (
        session.recording.audioName &&
        !consentValidAt(file.consent, session.heldAt) &&
        session.recording.scopeAtRecording === null
      ) {
        issues.push({
          level: "异常",
          text: `会谈 ${session.id} 无有效同意却保存音频（R1）`,
        });
      }
    }
  }

  // 转介单必须指向存在的会谈/个案
  for (const ref of Object.values(state.referrals)) {
    if (!state.cases[ref.caseId]) {
      issues.push({ level: "异常", text: `转介单 ${ref.id} 指向的个案 ${ref.caseId} 不存在（R7）` });
    }
    const linked = Object.values(state.sessions).find((s) => s.referralId === ref.id);
    if (!linked) {
      issues.push({ level: "异常", text: `转介单 ${ref.id} 没有任何会谈回指（R7）` });
    }
  }

  // 同一督导同一时段不得两单
  const seen = new Map<string, string>();
  for (const ref of Object.values(state.referrals)) {
    const key = `${ref.supervisorId}|${ref.slot}`;
    const prev = seen.get(key);
    if (prev) {
      issues.push({
        level: "异常",
        text: `督导 ${ref.supervisorId} 时段 ${ref.slot} 同时派单 ${prev} 与 ${ref.id}（R4）`,
      });
    } else seen.set(key, ref.id);
  }

  return issues;
}

export const SCOPE_OPTIONS: ConsentScope[] = ["仅督导抽听", "内部教学", "科研脱敏", "不同意"];
export type { VersionEntry };
