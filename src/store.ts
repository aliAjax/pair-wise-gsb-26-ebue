import type {
  AppState,
  Block,
  CaseDraft,
  CaseRecord,
  Referral,
  ReferralDraft,
  SessionDraft,
  SessionRecord,
  VersionEntry,
} from "./types";
import {
  buildVersionEntries,
  diffSession,
  evaluateCase,
  evaluateSession,
  nowStamp,
  seedState,
  uid,
} from "./domain";

const STORAGE_KEY = "hxwl-12-ledger-v1";

/* ------------------------------ 持久化与载入 ------------------------------ */

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppState;
      if (parsed && Array.isArray(parsed.cases) && Array.isArray(parsed.sessions)) {
        return {
          cases: parsed.cases,
          sessions: parsed.sessions,
          referrals: parsed.referrals ?? [],
          versions: parsed.versions ?? [],
          blocks: parsed.blocks ?? [],
        };
      }
    }
  } catch {
    // 数据损坏时回落到示例数据
  }
  return seedState();
}

export function persistState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存储空间不足等情况忽略，不影响当次操作
  }
}

/* --------------------------------- Action --------------------------------- */

export type Action =
  | { type: "register-case"; draft: CaseDraft }
  | { type: "withdraw-consent"; caseId: string }
  | { type: "close-case"; caseId: string }
  | { type: "save-session"; draft: SessionDraft; referral: ReferralDraft | null }
  | {
      type: "correct-session";
      sessionId: string;
      draft: SessionDraft;
      referral: ReferralDraft | null;
      reason: string;
    }
  | { type: "receive-referral"; referralId: string }
  | { type: "dismiss-block"; blockId: string }
  | { type: "reset-demo" };

export interface ActionResult {
  ok: boolean;
  blocked?: number;
}

/* --------------------------------- Reducer -------------------------------- */

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "register-case": {
      const blocks = evaluateCase(action.draft, state);
      if (blocks.length > 0) return { ...state, blocks: [...blocks, ...state.blocks] };

      const c: CaseRecord = {
        id: action.draft.id.trim(),
        theme: action.draft.theme,
        scope: action.draft.scope,
        emergencyName: action.draft.emergencyName.trim(),
        emergencyPhone: action.draft.emergencyPhone.trim(),
        consentExpiry: action.draft.consentExpiry,
        withdrawn: false,
        withdrawnAt: null,
        closed: false,
        closedAt: null,
        createdAt: nowStamp(),
      };
      return { ...state, cases: [...state.cases, c] };
    }

    case "withdraw-consent": {
      // 撤回后：不得新增录音，但历史录音与历史会谈仍可查（数据不删除）
      return {
        ...state,
        cases: state.cases.map((c) =>
          c.id === action.caseId && !c.withdrawn
            ? { ...c, withdrawn: true, withdrawnAt: nowStamp() }
            : c,
        ),
      };
    }

    case "close-case": {
      // 规则：存在未接收的高风险转介时不得结案
      const pending = state.referrals.some(
        (r) => r.caseId === action.caseId && r.status === "待接收",
      );
      if (pending) {
        return {
          ...state,
          blocks: [
            {
              id: uid("blk"),
              at: nowStamp(),
              caseId: action.caseId,
              field: "结案状态",
              oldValue: "在档",
              rule: "高风险转介单尚未被督导接收，接收前不得结案",
            },
            ...state.blocks,
          ],
        };
      }
      return {
        ...state,
        cases: state.cases.map((c) =>
          c.id === action.caseId ? { ...c, closed: true, closedAt: nowStamp() } : c,
        ),
      };
    }

    case "save-session": {
      const blocks = evaluateSession(action.draft, action.referral, state, { mode: "create" });
      if (blocks.length > 0) return { ...state, blocks: [...blocks, ...state.blocks] };

      const session: SessionRecord = {
        id: uid("ses"),
        caseId: action.draft.caseId,
        date: action.draft.date,
        slot: action.draft.slot,
        risk: action.draft.risk,
        summary: action.draft.summary.trim(),
        recordingName: action.draft.recordingName?.trim() ? action.draft.recordingName!.trim() : null,
        createdAt: nowStamp(),
      };

      let referrals = state.referrals;
      if (action.draft.risk === "高风险" && action.referral) {
        referrals = [
          ...referrals,
          {
            id: uid("ref"),
            caseId: session.caseId,
            sessionId: session.id,
            supervisor: action.referral.supervisor,
            date: session.date,
            slot: session.slot,
            deadline: action.referral.deadline,
            safetyPlan: action.referral.safetyPlan.trim(),
            status: "待接收",
            createdAt: nowStamp(),
            receivedAt: null,
          },
        ];
      }
      return { ...state, sessions: [...state.sessions, session], referrals };
    }

    case "correct-session": {
      const original = state.sessions.find((s) => s.id === action.sessionId);
      if (!original) return state;

      const reason = action.reason.trim();
      const extra: Block[] = [];
      if (!reason) {
        extra.push({
          id: uid("blk"),
          at: nowStamp(),
          caseId: original.caseId,
          field: "更正原因",
          oldValue: "（空）",
          rule: "会后更正必须填写更正原因，原因随版本留痕",
        });
      }

      const existingReferral = state.referrals.find((r) => r.sessionId === original.id);
      const blocks = [
        ...extra,
        ...evaluateSession(action.draft, action.referral, state, {
          mode: "correct",
          original,
          existingReferral,
        }),
      ];

      const changes = diffSession(action.draft, original);
      if (reason && changes.length === 0) {
        blocks.push({
          id: uid("blk"),
          at: nowStamp(),
          caseId: original.caseId,
          field: "会谈记录",
          oldValue: "与现值一致",
          rule: "未检测到字段变更，无需生成更正版本",
        });
      }
      if (blocks.length > 0) return { ...state, blocks: [...blocks, ...state.blocks] };

      const updated: SessionRecord = {
        ...original,
        date: action.draft.date,
        slot: action.draft.slot,
        risk: action.draft.risk,
        summary: action.draft.summary.trim(),
        recordingName: action.draft.recordingName?.trim() ? action.draft.recordingName!.trim() : null,
      };
      const newVersions: VersionEntry[] = buildVersionEntries(changes, updated.caseId, updated.id, reason);

      // 高风险转介随会谈更正同步（督导、响应期限、安全计划），并在日期/时段变更时同步排班
      let referrals = state.referrals;
      if (updated.risk === "高风险") {
        const refDraft = action.referral!;
        const refChanges: { field: string; oldValue: string; newValue: string }[] = [];
        if (existingReferral) {
          const pairs: [keyof Referral, string][] = [
            ["supervisor", refDraft.supervisor],
            ["deadline", refDraft.deadline],
            ["safetyPlan", refDraft.safetyPlan.trim()],
            ["date", updated.date],
            ["slot", updated.slot],
          ];
          const labels: Record<keyof Referral, string> = {
            supervisor: "接收督导",
            deadline: "响应期限",
            safetyPlan: "安全计划",
            date: "转介会谈日期",
            slot: "转介会谈时段",
          } as Record<keyof Referral, string>;
          for (const [key, nv] of pairs) {
            const ov = String(existingReferral[key]);
            if (ov !== nv) refChanges.push({ field: labels[key], oldValue: ov, newValue: nv });
          }
          referrals = referrals.map((r) =>
            r.id === existingReferral.id
              ? {
                  ...r,
                  supervisor: refDraft.supervisor,
                  deadline: refDraft.deadline,
                  safetyPlan: refDraft.safetyPlan.trim(),
                  date: updated.date,
                  slot: updated.slot,
                }
              : r,
          );
        } else {
          // 更正时风险升级为高风险：随更正补建转介单
          referrals = [
            ...referrals,
            {
              id: uid("ref"),
              caseId: updated.caseId,
              sessionId: updated.id,
              supervisor: refDraft.supervisor,
              date: updated.date,
              slot: updated.slot,
              deadline: refDraft.deadline,
              safetyPlan: refDraft.safetyPlan.trim(),
              status: "待接收",
              createdAt: nowStamp(),
              receivedAt: null,
            },
          ];
        }
        newVersions.push(...buildVersionEntries(
          refChanges.map((rc) => ({ field: rc.field, oldValue: rc.oldValue, newValue: rc.newValue })),
          updated.caseId,
          updated.id,
          reason,
        ));
      }

      return {
        ...state,
        sessions: state.sessions.map((s) => (s.id === updated.id ? updated : s)),
        referrals,
        versions: [...newVersions, ...state.versions],
      };
    }

    case "receive-referral": {
      return {
        ...state,
        referrals: state.referrals.map((r) =>
          r.id === action.referralId && r.status === "待接收"
            ? { ...r, status: "已接收", receivedAt: nowStamp() }
            : r,
        ),
      };
    }

    case "dismiss-block": {
      return { ...state, blocks: state.blocks.filter((b) => b.id !== action.blockId) };
    }

    case "reset-demo":
      return seedState();

    default:
      return state;
  }
}
