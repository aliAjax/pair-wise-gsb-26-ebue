import { useCallback, useEffect, useReducer } from "react";
import type {
  ActionResult,
  AppState,
  Blocker,
  CaseFile,
  Consent,
  ConsentScope,
  FieldChange,
  Referral,
  RiskLevel,
  Session,
  VersionEntry,
  VersionKind,
} from "./types";
import { buildSeed } from "./seed";
import {
  RULES,
  buildBlocker,
  canRecordNow,
  diffFields,
  nextVersionSeq,
  nowStamp,
  pendingReferrals,
  slotTaken,
  uid,
} from "./rules";

const STORAGE_KEY = "hxwl-ledger-v1";

function loadInitial(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as AppState;
  } catch {
    /* 损坏则回落演示数据 */
  }
  return buildSeed();
}

type StoreAction = { type: "__replace__"; state: AppState };

function reducer(state: AppState, action: StoreAction): AppState {
  if (action.type === "__replace__") return action.state;
  return state;
}

function addVersion(
  state: AppState,
  entry: Omit<VersionEntry, "id" | "seq" | "at"> & { at?: string }
): { state: AppState; version: VersionEntry } {
  const version: VersionEntry = {
    id: uid("V"),
    seq: nextVersionSeq(state),
    at: entry.at ?? nowStamp(),
    kind: entry.kind,
    caseId: entry.caseId,
    sessionId: entry.sessionId,
    referralId: entry.referralId,
    reason: entry.reason,
    changes: entry.changes,
  };
  return { state: { ...state, versions: [...state.versions, version] }, version };
}

function withBlocker(state: AppState, b: NonNullable<ActionResult["blocker"]>): AppState {
  const blocker: Blocker = { id: uid("BL"), at: nowStamp(), ...b };
  return { ...state, blockers: [blocker, ...state.blockers] };
}

export interface RegisterInput {
  code: string;
  topic: string;
  emergencyName: string;
  emergencyPhone: string;
  scope: ConsentScope;
  agreedFrom: string;
  expiresAt: string;
}

export interface SessionInput {
  heldAt: string;
  risk: RiskLevel;
  concern: string;
  intervention: string;
  nextGoal: string;
  summary: string;
  audioName: string | null;
  supervisorId?: string;
  slot?: string;
  responseDue?: string;
  safetyPlan?: string;
}

export interface CorrectInput {
  reason: string;
  risk?: RiskLevel;
  concern?: string;
  intervention?: string;
  nextGoal?: string;
  summary?: string;
}

export function useLedgerStore() {
  const [state, dispatch] = useReducer(reducer, undefined, loadInitial);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* 存储满或被禁用时只保留内存态 */
    }
  }, [state]);

  const commit = useCallback((next: AppState) => {
    dispatch({ type: "__replace__", state: next });
  }, []);

  const resetDemo = useCallback(() => commit(buildSeed()), [commit]);

  /** 个案登记：同意范围、紧急联系人、到期日，同事务生成登记版本 */
  const registerCase = useCallback(
    (input: RegisterInput): ActionResult => {
      if (!input.code.trim() || !input.topic.trim()) {
        const blk = buildBlocker("（新建）", "个案登记", "来访者代号/咨询主题", "", RULES.R7);
        commit(withBlocker(state, blk));
        return { ok: false, blocker: blk };
      }
      if (!input.emergencyName.trim() || !input.emergencyPhone.trim()) {
        const blk = buildBlocker("（新建）", "个案登记", "紧急联系人", "", RULES.R7);
        commit(withBlocker(state, blk));
        return { ok: false, blocker: blk };
      }
      if (!input.agreedFrom || !input.expiresAt || input.expiresAt < input.agreedFrom) {
        const blk = buildBlocker("（新建）", "个案登记", "同意到期日", input.expiresAt, RULES.R1);
        commit(withBlocker(state, blk));
        return { ok: false, blocker: blk };
      }

      const id = uid("C");
      const consent: Consent = {
        scope: input.scope,
        agreedFrom: input.agreedFrom,
        expiresAt: input.expiresAt,
        active: input.scope !== "不同意",
        history: [
          {
            at: nowStamp(),
            scope: input.scope,
            action: "登记",
            reason: "个案登记时确认",
            versionId: "",
          },
        ],
      };
      const file: CaseFile = {
        id,
        code: input.code.trim(),
        topic: input.topic.trim(),
        status: "进行中",
        emergencyName: input.emergencyName.trim(),
        emergencyPhone: input.emergencyPhone.trim(),
        consent,
        sessionIds: [],
        createdAt: nowStamp(),
      };

      let next: AppState = { ...state, cases: { ...state.cases, [id]: file } };
      const built = addVersion(next, {
        kind: "个案登记",
        caseId: id,
        sessionId: null,
        referralId: null,
        reason: "首次建档登记",
        changes: [
          { field: "来访者代号", oldValue: "", newValue: file.code },
          { field: "咨询主题", oldValue: "", newValue: file.topic },
          { field: "紧急联系人", oldValue: "", newValue: `${file.emergencyName} ${file.emergencyPhone}` },
          {
            field: "同意范围",
            oldValue: "",
            newValue: `${file.consent.scope}（${file.consent.agreedFrom} 至 ${file.consent.expiresAt}）`,
          },
        ],
      });
      next = built.state;
      // 回填同意历史中的版本号
      const withHistory = {
        ...next,
        cases: {
          ...next.cases,
          [id]: {
            ...file,
            consent: {
              ...file.consent,
              history: [{ ...file.consent.history[0], versionId: built.version.id }],
            },
          },
        },
      };
      commit(withHistory);
      return { ok: true, id };
    },
    [state, commit]
  );

  /** 新增会谈；高风险会谈在同一事务中生成转介单，全部规则通过才落库 */
  const addSession = useCallback(
    (caseId: string, input: SessionInput): ActionResult => {
      const file = state.cases[caseId];
      if (!file) return { ok: false };

      const heldDay = input.heldAt.slice(0, 10);
      const canRecord = canRecordNow(file.consent, heldDay);

      // R1：未取得有效录音同意（未登记/撤回后/过期/不同意）只能保存文字摘要
      if (input.audioName && !canRecord) {
        const old = input.audioName;
        const reason =
          file.consent.scope === "不同意"
            ? RULES.R1 + "（同意范围：不同意）"
            : !file.consent.active
              ? RULES.R1 + "（同意已撤回）"
              : heldDay > file.consent.expiresAt
                ? RULES.R1 + "（同意已过期）"
                : RULES.R1;
        const blk = buildBlocker(caseId, "会谈录音保存", "录音文件", old, reason);
        commit(withBlocker(state, blk));
        return { ok: false, blocker: blk };
      }

      // R3：高风险会谈必须生成转介单
      if (input.risk === "高风险") {
        if (!input.supervisorId || !input.slot) {
          const blk = buildBlocker(caseId, "高风险转介", "接收督导/时段", "", RULES.R3);
          commit(withBlocker(state, blk));
          return { ok: false, blocker: blk };
        }
        if (!input.responseDue || input.responseDue < heldDay) {
          const blk = buildBlocker(caseId, "高风险转介", "响应期限", input.responseDue ?? "", RULES.R3);
          commit(withBlocker(state, blk));
          return { ok: false, blocker: blk };
        }
        if (!input.safetyPlan?.trim()) {
          const blk = buildBlocker(caseId, "高风险转介", "安全计划", "", RULES.R3);
          commit(withBlocker(state, blk));
          return { ok: false, blocker: blk };
        }
        // R4：同一督导同一时段只接一单
        const clash = slotTaken(state, input.supervisorId, input.slot);
        if (clash) {
          const sup = state.supervisors.find((s) => s.id === input.supervisorId);
          const old = `${sup?.name ?? input.supervisorId} / ${input.slot}`;
          const blk = buildBlocker(
            caseId,
            "高风险转介派单",
            "督导时段",
            old,
            `${RULES.R4}（已占用：转介单 ${clash.id} / 个案 ${clash.caseId}）`
          );
          commit(withBlocker(state, blk));
          return { ok: false, blocker: blk };
        }
      }

      const sessionId = uid("S");
      let next: AppState = state;

      const session: Session = {
        id: sessionId,
        caseId,
        heldAt: input.heldAt,
        risk: input.risk,
        concern: input.concern.trim(),
        intervention: input.intervention.trim(),
        nextGoal: input.nextGoal.trim(),
        recording: {
          summary: input.summary.trim(),
          audioName: canRecord ? input.audioName : null,
          scopeAtRecording:
            canRecord && input.audioName
              ? (file.consent.scope as Exclude<ConsentScope, "不同意">)
              : null,
        },
        referralId: null,
        closed: file.status === "已结案",
      };
      next = {
        ...next,
        sessions: { ...next.sessions, [sessionId]: session },
        cases: {
          ...next.cases,
          [caseId]: { ...file, sessionIds: [...file.sessionIds, sessionId] },
        },
      };

      let referralId: string | null = null;
      if (input.risk === "高风险") {
        const referral: Referral = {
          id: uid("R"),
          caseId,
          sessionId,
          supervisorId: input.supervisorId!,
          slot: input.slot!,
          responseDue: input.responseDue!,
          safetyPlan: input.safetyPlan!.trim(),
          status: "待接收",
          acceptedAt: null,
          createdAt: nowStamp(),
        };
        referralId = referral.id;
        next = { ...next, referrals: { ...next.referrals, [referral.id]: referral } };
        next = {
          ...next,
          sessions: {
            ...next.sessions,
            [sessionId]: { ...session, referralId: referral.id },
          },
        };
      }

      const sessionChanges: FieldChange[] = [
        { field: "风险等级", oldValue: "", newValue: input.risk },
        ...(session.recording.audioName
          ? [
              {
                field: "录音",
                oldValue: "",
                newValue: `${session.recording.audioName}（录制时同意：${session.recording.scopeAtRecording}）`,
              },
            ]
          : [{ field: "录音", oldValue: input.audioName ? input.audioName : "（拟上传音频）", newValue: "仅文字摘要（R1）" }]),
      ];
      const sessionBuilt = addVersion(next, {
        kind: "会谈",
        caseId,
        sessionId,
        referralId: null,
        reason:
          input.risk === "高风险"
                ? "高风险会谈记录归档，并于同事务生成转介单"
                : canRecord
                  ? "会谈记录归档"
                  : "无有效录音同意：仅文字摘要",
        changes: sessionChanges,
      });
      next = sessionBuilt.state;

      if (referralId) {
        const ref = next.referrals[referralId];
        const sup = next.supervisors.find((s) => s.id === ref.supervisorId);
        const refBuilt = addVersion(next, {
          kind: "转介",
          caseId,
          sessionId,
          referralId,
          reason: "高风险会谈自动生成转介单",
          changes: [
            { field: "接收督导", oldValue: "", newValue: `${sup?.name ?? ref.supervisorId} · ${ref.slot}` },
            { field: "响应期限", oldValue: "", newValue: ref.responseDue },
            { field: "安全计划", oldValue: "", newValue: "已录入安全计划" },
            { field: "状态", oldValue: "", newValue: "待接收" },
          ],
        });
        next = refBuilt.state;
      }

      commit(next);
      return { ok: true, id: sessionId };
    },
    [state, commit]
  );

  /** R2：同意撤回必须填写原因；撤回后历史仍可查 */
  const withdrawConsent = useCallback(
    (caseId: string, reason: string): ActionResult => {
      const file = state.cases[caseId];
      if (!file) return { ok: false };
      if (!reason.trim()) {
        const blk = buildBlocker(caseId, "同意撤回", "撤回原因", "", RULES.R2);
        commit(withBlocker(state, blk));
        return { ok: false, blocker: blk };
      }
      if (!file.consent.active) {
        const blk = buildBlocker(caseId, "同意撤回", "同意状态", "已撤回（历史可查）", RULES.R2);
        commit(withBlocker(state, blk));
        return { ok: false, blocker: blk };
      }

      let next: AppState = state;
      const built = addVersion(next, {
        kind: "同意",
        caseId,
        sessionId: null,
        referralId: null,
        reason: reason.trim(),
        changes: [
          {
            field: "同意状态",
            oldValue: `有效（${file.consent.scope}）`,
            newValue: "已撤回（历史仍可查）",
          },
        ],
      });
      next = built.state;
      const updated: CaseFile = {
        ...file,
        consent: {
          ...file.consent,
          active: false,
          history: [
            {
              at: nowStamp(),
              scope: file.consent.scope,
              action: "撤回",
              reason: reason.trim(),
              versionId: built.version.id,
            },
            ...file.consent.history,
          ],
        },
      };
      next = { ...next, cases: { ...next.cases, [caseId]: updated } };
      commit(next);
      return { ok: true, id: built.version.id };
    },
    [state, commit]
  );

  /** 督导接收转介单；接收后版本关系同步更新 */
  const acceptReferral = useCallback(
    (referralId: string): ActionResult => {
      const ref = state.referrals[referralId];
      if (!ref) return { ok: false };
      if (ref.status === "已接收") {
        const blk = buildBlocker(ref.caseId, "转介接收", "状态", "已接收", RULES.R7);
        commit(withBlocker(state, blk));
        return { ok: false, blocker: blk };
      }
      let next: AppState = {
        ...state,
        referrals: {
          ...state.referrals,
          [referralId]: { ...ref, status: "已接收", acceptedAt: nowStamp() },
        },
      };
      const built = addVersion(next, {
        kind: "转介",
        caseId: ref.caseId,
        sessionId: ref.sessionId,
        referralId,
        reason: "督导完成接收并确认安全计划",
        changes: [{ field: "状态", oldValue: "待接收", newValue: "已接收" }],
      });
      commit(built.state);
      return { ok: true, id: referralId };
    },
    [state, commit]
  );

  /** R5：未接收前不得结案 */
  const closeCase = useCallback(
    (caseId: string): ActionResult => {
      const file = state.cases[caseId];
      if (!file) return { ok: false };
      const pending = pendingReferrals(state, caseId);
      if (pending.length > 0) {
        const blk = buildBlocker(
          caseId,
          "个案结案",
          "个案状态",
          "进行中",
          `${RULES.R5}（待接收转介单：${pending.map((r) => r.id).join("、")}）`
        );
        commit(withBlocker(state, blk));
        return { ok: false, blocker: blk };
      }
      let next: AppState = {
        ...state,
        cases: { ...state.cases, [caseId]: { ...file, status: "已结案" } },
        sessions: Object.fromEntries(
          Object.values(state.sessions).map((s) =>
            s.caseId === caseId ? [s.id, { ...s, closed: true }] : [s.id, s]
          )
        ),
      };
      const built = addVersion(next, {
        kind: "结案",
        caseId,
        sessionId: null,
        referralId: null,
        reason: "无未接收转介，结案自评通过，予以结案",
        changes: [{ field: "个案状态", oldValue: "进行中", newValue: "已结案" }],
      });
      commit(built.state);
      return { ok: true, id: caseId };
    },
    [state, commit]
  );

  /** R6：会后更正保留原因和旧值 */
  const correctSession = useCallback(
    (sessionId: string, input: CorrectInput): ActionResult => {
      const session = state.sessions[sessionId];
      if (!session) return { ok: false };
      if (!input.reason.trim()) {
        const blk = buildBlocker(session.caseId, "会后更正", "更正原因", "（空）", RULES.R6);
        commit(withBlocker(state, blk));
        return { ok: false, blocker: blk };
      }

      const before: Record<string, string> = {
        风险等级: session.risk,
        主要困扰: session.concern,
        干预方法: session.intervention,
        下次目标: session.nextGoal,
        文字摘要: session.recording.summary,
      };
      const after: Record<string, string> = {
        风险等级: input.risk ?? session.risk,
        主要困扰: input.concern ?? session.concern,
        干预方法: input.intervention ?? session.intervention,
        下次目标: input.nextGoal ?? session.nextGoal,
        文字摘要: input.summary ?? session.recording.summary,
      };
      const changes = diffFields(before, after);
      if (changes.length === 0) {
        const blk = buildBlocker(session.caseId, "会后更正", "字段值", "无变更", RULES.R6);
        commit(withBlocker(state, blk));
        return { ok: false, blocker: blk };
      }

      const newRisk = (input.risk ?? session.risk) as RiskLevel;
      if (newRisk === "高风险" && !session.referralId) {
        const blk = buildBlocker(session.caseId, "会后更正风险升级", "风险等级", session.risk, RULES.R3);
        commit(withBlocker(state, blk));
        return { ok: false, blocker: blk };
      }

      const updated: Session = {
        ...session,
        risk: newRisk,
        concern: after.主要困扰,
        intervention: after.干预方法,
        nextGoal: after.下次目标,
        recording: { ...session.recording, summary: after.文字摘要 },
      };
      let next: AppState = {
        ...state,
        sessions: { ...state.sessions, [sessionId]: updated },
      };
      const built = addVersion(next, {
        kind: "会后更正",
        caseId: session.caseId,
        sessionId,
        referralId: session.referralId,
        reason: input.reason.trim(),
        changes,
      });
      commit(built.state);
      return { ok: true, id: built.version.id };
    },
    [state, commit]
  );

  return {
    state,
    registerCase,
    addSession,
    withdrawConsent,
    acceptReferral,
    closeCase,
    correctSession,
    resetDemo,
  };
}

export type LedgerStore = ReturnType<typeof useLedgerStore>;
export type { VersionKind };
