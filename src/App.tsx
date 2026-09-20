import { useEffect, useMemo, useReducer, useState } from "react";
import type { ConsentKey, RiskLevel, SessionRecord } from "./types";
import {
  CONSENT_SCOPES,
  FIELD_LABELS,
  RISK_LEVELS,
  SLOTS,
  SUPERVISORS,
  THEMES,
  consentBadge,
  dateOffset,
  diffSession,
  evaluateCase,
  evaluateSession,
  recordingConsentValid,
  supervisorBusy,
  todayISO,
} from "./domain";
import { loadState, persistState, reducer } from "./store";
import "./styles.css";

type Tab = "cases" | "sessions" | "referrals" | "audit";

interface SessionForm {
  caseId: string;
  date: string;
  slot: string;
  risk: RiskLevel;
  summary: string;
  recordingName: string;
  supervisor: string;
  deadline: string;
  safetyPlan: string;
}

function emptySessionForm(caseId: string): SessionForm {
  return {
    caseId,
    date: todayISO(),
    slot: SLOTS[0],
    risk: "关注",
    summary: "",
    recordingName: "",
    supervisor: SUPERVISORS[0],
    deadline: dateOffset(1),
    safetyPlan: "",
  };
}

function App() {
  const [state, dispatch] = useReducer(reducer, undefined, loadState);
  const [tab, setTab] = useState<Tab>("cases");

  useEffect(() => {
    persistState(state);
  }, [state]);

  const activeCases = state.cases.filter((c) => !c.closed).length;
  const pendingReferrals = state.referrals.filter((r) => r.status === "待接收").length;
  const weekSessions = state.sessions.filter((s) => s.date >= dateOffset(-7) && s.date <= todayISO()).length;

  const [caseForm, setCaseForm] = useState({
    id: "",
    theme: THEMES[0],
    scope: ["recording", "supervision"] as ConsentKey[],
    emergencyName: "",
    emergencyPhone: "",
    consentExpiry: dateOffset(90),
  });

  const [sessionForm, setSessionForm] = useState<SessionForm>(() =>
    emptySessionForm(state.cases[0]?.id ?? ""),
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<SessionForm | null>(null);
  const [editReason, setEditReason] = useState("");

  const caseById = useMemo(() => new Map(state.cases.map((c) => [c.id, c])), [state.cases]);
  const referralBySession = useMemo(
    () => new Map(state.referrals.map((r) => [r.sessionId, r])),
    [state.referrals],
  );

  function submitCase() {
    const draft = { ...caseForm, id: caseForm.id.trim() };
    if (evaluateCase(draft, state).length > 0) {
      dispatch({ type: "register-case", draft });
      return;
    }
    dispatch({ type: "register-case", draft });
    setCaseForm({
      id: "",
      theme: caseForm.theme,
      scope: caseForm.scope,
      emergencyName: "",
      emergencyPhone: "",
      consentExpiry: dateOffset(90),
    });
    setSessionForm((f) => (f.caseId ? f : { ...f, caseId: draft.id }));
  }

  function toggleScope(key: ConsentKey, scope: ConsentKey[], set: (s: ConsentKey[]) => void) {
    set(scope.includes(key) ? scope.filter((k) => k !== key) : [...scope, key]);
  }

  function submitSession() {
    const draft = {
      caseId: sessionForm.caseId,
      date: sessionForm.date,
      slot: sessionForm.slot,
      risk: sessionForm.risk,
      summary: sessionForm.summary,
      recordingName: sessionForm.recordingName.trim() ? sessionForm.recordingName.trim() : null,
    };
    const referral =
      sessionForm.risk === "高风险"
        ? { supervisor: sessionForm.supervisor, deadline: sessionForm.deadline, safetyPlan: sessionForm.safetyPlan }
        : null;
    const blocks = evaluateSession(draft, referral, state, { mode: "create" });
    dispatch({ type: "save-session", draft, referral });
    if (blocks.length === 0) {
      setSessionForm(emptySessionForm(sessionForm.caseId));
    }
  }

  function startCorrect(s: SessionRecord) {
    const ref = referralBySession.get(s.id);
    setEditingId(s.id);
    setEditForm({
      caseId: s.caseId,
      date: s.date,
      slot: s.slot,
      risk: s.risk,
      summary: s.summary,
      recordingName: s.recordingName ?? "",
      supervisor: ref?.supervisor ?? SUPERVISORS[0],
      deadline: ref?.deadline ?? dateOffset(1),
      safetyPlan: ref?.safetyPlan ?? "",
    });
    setEditReason("");
  }

  function submitCorrect() {
    if (!editingId || !editForm) return;
    const original = state.sessions.find((s) => s.id === editingId);
    if (!original) return;
    const existingReferral = referralBySession.get(editingId);
    const draft = {
      caseId: editForm.caseId,
      date: editForm.date,
      slot: editForm.slot,
      risk: editForm.risk,
      summary: editForm.summary,
      recordingName: editForm.recordingName.trim() ? editForm.recordingName.trim() : null,
    };
    const referral =
      editForm.risk === "高风险"
        ? { supervisor: editForm.supervisor, deadline: editForm.deadline, safetyPlan: editForm.safetyPlan }
        : null;
    const blocks = evaluateSession(draft, referral, state, { mode: "correct", original, existingReferral });
    const changes = diffSession(draft, original);
    dispatch({ type: "correct-session", sessionId: editingId, draft, referral, reason: editReason });
    if (editReason.trim() && blocks.length === 0 && changes.length > 0) {
      setEditingId(null);
      setEditForm(null);
      setEditReason("");
    }
  }

  const formCase = caseById.get(sessionForm.caseId);
  const recentBlocks = state.blocks.slice(0, 3);

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-12 · 录音同意与高风险转介台账</p>
          <h1>心理咨询个案记录</h1>
          <p className="subtitle">
            个案登记同意范围、紧急联系人与到期日；未取得录音同意仅保存文字摘要，同意撤回后历史仍可查；
            高风险会谈生成转介单，督导同时段只接一单，未接收前不得结案。
          </p>
        </div>
        <div className="stack-card">
          <span>数据持久化</span>
          <strong>localStorage 自动保存，刷新后同意、转介与版本关系一致</strong>
          <button className="ghost-action" onClick={() => dispatch({ type: "reset-demo" })}>
            重置为示例数据
          </button>
        </div>
      </section>

      <section className="metrics-grid">
        <MetricCard label="活跃个案" value={String(activeCases)} tone="ok" />
        <MetricCard label="高风险待接收" value={String(pendingReferrals)} tone="danger" />
        <MetricCard label="近 7 日会谈" value={String(weekSessions)} tone="watch" />
        <MetricCard label="累计受阻记录" value={String(state.blocks.length)} tone="muted" />
      </section>

      {recentBlocks.length > 0 && (
        <section className="block-banner">
          <div className="block-banner-head">
            <strong>⚠ 操作受阻（{state.blocks.length} 条）— 已记录个案、字段、原值与触发规则</strong>
              <button className="ghost-action" onClick={() => setTab("audit")}>查看全部</button>
          </div>
          {recentBlocks.map((b) => (
            <div key={b.id} className="block-row">
              <span className="tag tag-danger">受阻</span>
              <div className="block-grid">
                <div><em>个案</em><b>{b.caseId}</b></div>
                <div><em>字段</em><b>{b.field}</b></div>
                <div><em>原值</em><b title={b.oldValue}>{b.oldValue}</b></div>
                <div className="block-rule"><em>规则</em><b>{b.rule}</b></div>
              </div>
              <button className="ghost-action" onClick={() => dispatch({ type: "dismiss-block", blockId: b.id })}>知道了</button>
            </div>
          ))}
        </section>
      )}

      <nav className="tabs">
        {([
          ["cases", "① 个案登记与同意"],
          ["sessions", "② 会谈记录"],
          ["referrals", "③ 高风险转介台账"],
          ["audit", `④ 更正版本与受阻（${state.blocks.length}）`],
        ] as [Tab, string][]).map(([key, label]) => (
          <button key={key} className={tab === key ? "tab active" : "tab"} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </nav>

      {tab === "cases" && (
        <section className="workspace">
          <aside className="panel narrow">
            <h2>个案登记</h2>
            <p className="hint">登记同意范围、紧急联系人和同意到期日，后方可录入会谈。</p>
            <label>
              <span>{FIELD_LABELS.id}</span>
              <input value={caseForm.id} placeholder="如 C-421" onChange={(e) => setCaseForm({ ...caseForm, id: e.target.value })} />
            </label>
            <label>
              <span>{FIELD_LABELS.theme}</span>
              <select value={caseForm.theme} onChange={(e) => setCaseForm({ ...caseForm, theme: e.target.value })}>
                {THEMES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <div className="scope-box">
              <span>{FIELD_LABELS.scope}（至少一项）</span>
              {CONSENT_SCOPES.map((s) => (
                <label key={s.key} className="check">
                  <input
                    type="checkbox"
                    checked={caseForm.scope.includes(s.key)}
                    onChange={() => toggleScope(s.key, caseForm.scope, (scope) => setCaseForm({ ...caseForm, scope }))}
                  />
                  <span><b>{s.label}</b><em>{s.hint}</em></span>
                </label>
              ))}
            </div>
            <label>
              <span>{FIELD_LABELS.emergencyName}</span>
              <input value={caseForm.emergencyName} placeholder="姓名（与来访者关系）" onChange={(e) => setCaseForm({ ...caseForm, emergencyName: e.target.value })} />
            </label>
            <label>
              <span>{FIELD_LABELS.emergencyPhone}</span>
              <input value={caseForm.emergencyPhone} placeholder="紧急联系电话" onChange={(e) => setCaseForm({ ...caseForm, emergencyPhone: e.target.value })} />
            </label>
            <label>
              <span>{FIELD_LABELS.consentExpiry}</span>
              <input type="date" value={caseForm.consentExpiry} onChange={(e) => setCaseForm({ ...caseForm, consentExpiry: e.target.value })} />
            </label>
            <button className="primary-action" onClick={submitCase}>登记个案</button>
          </aside>

          <section className="panel">
            <div className="section-heading">
              <div><p>在档名册</p><h2>个案与录音同意状态</h2></div>
            </div>
            <div className="table-wrap">
              <table className="ledger">
                <thead>
                  <tr>
                    <th>代号</th><th>主题</th><th>同意范围</th><th>紧急联系人</th><th>到期日</th><th>录音同意</th><th>状态</th><th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {state.cases.map((c) => {
                    const badge = consentBadge(c);
                    return (
                      <tr key={c.id} className={c.closed ? "row-closed" : ""}>
                        <td><b>{c.id}</b></td>
                        <td>{c.theme}</td>
                        <td>
                          <div className="mini-chips">
                            {CONSENT_SCOPES.map((s) => (
                              <span key={s.key} className={c.scope.includes(s.key) ? "chip-on" : "chip-off"}>{s.label}</span>
                            ))}
                          </div>
                        </td>
                        <td>{c.emergencyName}<br /><em>{c.emergencyPhone}</em></td>
                        <td>{c.consentExpiry}{c.withdrawnAt && <><br /><em>撤回于 {c.withdrawnAt}</em></>}</td>
                        <td><span className={`badge badge-${badge.tone}`}>{badge.text}</span></td>
                        <td>{c.closed ? <span className="badge badge-muted">已结案 {c.closedAt}</span> : <span className="badge badge-ok">在档</span>}</td>
                        <td className="cell-actions">
                          <button disabled={c.withdrawn || c.closed} title={c.withdrawn ? "同意已撤回，历史记录仍可查" : ""}
                            onClick={() => dispatch({ type: "withdraw-consent", caseId: c.id })}>
                            撤回同意
                          </button>
                          <button disabled={c.closed} onClick={() => dispatch({ type: "close-case", caseId: c.id })}>结案</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="hint">撤回同意不删除任何历史数据：已有录音保留可查，仅阻止新增/替换录音；有「待接收」转介单的个案结案会被拦截。</p>
          </section>
        </section>
      )}

      {tab === "sessions" && (
        <section className="panel">
          <div className="section-heading">
            <div><p>会谈录入</p><h2>{editingId ? "会后更正" : "新增会谈记录"}</h2></div>
            {editingId && (
              <button className="ghost-action" onClick={() => { setEditingId(null); setEditForm(null); setEditReason(""); }}>取消更正</button>
            )}
          </div>

          {!editingId ? (
            <SessionFormView
              form={sessionForm}
              set={setSessionForm}
              caseBadge={formCase ? consentBadge(formCase, sessionForm.date) : { text: "请先选择个案", tone: "muted" as const }}
              recordingAllowed={formCase ? recordingConsentValid(formCase, sessionForm.date) : false}
              state={state}
            />
          ) : (
            editForm && (
              <>
                <SessionFormView
                  form={editForm}
                  set={setEditForm}
                  caseBadge={(() => {
                    const c = caseById.get(editForm.caseId);
                    const b = consentBadge(c, editForm.date);
                    return b;
                  })()}
                  recordingAllowed={recordingConsentValid(caseById.get(editForm.caseId), editForm.date)}
                  state={state}
                  excludeReferralId={referralBySession.get(editingId)?.id}
                  lockedCase
                />
                <label className="reason-box">
                  <span>更正原因（必填，将随每个变更字段留痕）</span>
                  <textarea rows={2} value={editReason} placeholder="如：来访者补充说明，修正风险等级与安全计划" onChange={(e) => setEditReason(e.target.value)} />
                </label>
                <div className="form-actions">
                  <button className="primary-action" onClick={submitCorrect}>提交更正并生成版本</button>
                </div>
              </>
            )
          )}
          {!editingId && (
            <div className="form-actions">
              <button className="primary-action" onClick={submitSession} disabled={state.cases.length === 0}>保存会谈</button>
            </div>
          )}

          <div className="section-heading list-head">
            <div><p>会谈时间线</p><h2>历史会谈（同意撤回后仍可查）</h2></div>
          </div>
          <div className="record-list">
            {[...state.sessions].reverse().map((s) => {
              const c = caseById.get(s.caseId);
              const ref = referralBySession.get(s.id);
              return (
                <article key={s.id} className={`session-card risk-${s.risk}`}>
                  <div className="session-main">
                    <div className="session-top">
                      <h3>{s.caseId} · {s.date} {s.slot}</h3>
                      <span className={`badge badge-risk-${s.risk}`}>{s.risk}</span>
                    </div>
                    <p className="summary">{s.summary}</p>
                    <div className="session-meta">
                      {s.recordingName ? (
                        <span className="badge badge-ok">🎙 录音：{s.recordingName}</span>
                      ) : (
                        <span className="badge badge-muted">仅文字摘要（未保存录音）</span>
                      )}
                      {ref && (
                        <span className={`badge ${ref.status === "待接收" ? "badge-danger" : "badge-ok"}`}>
                          转介 → {ref.supervisor} · {ref.status}
                        </span>
                      )}
                      {c?.withdrawn && <span className="badge badge-danger">同意已撤回 · 历史留存</span>}
                    </div>
                  </div>
                  <button disabled={!!editingId || c?.closed} onClick={() => startCorrect(s)}>会后更正</button>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {tab === "referrals" && (
        <section className="panel">
          <div className="section-heading">
            <div><p>高风险转介台账</p><h2>转介单（同一督导同一时段只接一单）</h2></div>
          </div>
          <div className="referral-list">
            {state.referrals.length === 0 && <p className="hint">暂无转介单。风险等级标记为「高风险」的会谈保存时会自动生成。</p>}
            {state.referrals.map((r) => {
              const overdue = r.status === "待接收" && r.deadline < todayISO();
              return (
                <article key={r.id} className="referral-card">
                  <div className="referral-head">
                    <h3>个案 {r.caseId} · {r.date} {r.slot}</h3>
                    <span className={`badge ${r.status === "待接收" ? "badge-danger" : "badge-ok"}`}>
                      {r.status}{r.receivedAt ? ` · ${r.receivedAt}` : ""}
                    </span>
                  </div>
                  <div className="referral-grid">
                    <div><em>接收督导</em><b>{r.supervisor}</b></div>
                    <div><em>响应期限</em><b className={overdue ? "overdue" : ""}>{r.deadline}{overdue && "（已逾期）"}</b></div>
                    <div className="span2"><em>安全计划</em><p>{r.safetyPlan}</p></div>
                  </div>
                  <div className="referral-foot">
                    <span className="hint">关联会谈 {r.sessionId}</span>
                    {r.status === "待接收" ? (
                      <button className="primary-action" onClick={() => dispatch({ type: "receive-referral", referralId: r.id })}>督导确认接收</button>
                    ) : (
                      <button onClick={() => dispatch({ type: "close-case", caseId: r.caseId })}>该个案可结案 →</button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {tab === "audit" && (
        <>
          <section className="panel audit-panel">
            <div className="section-heading">
              <div><p>会后更正留痕</p><h2>版本关系（字段 · 原值 → 新值 · 原因）</h2></div>
            </div>
            <div className="table-wrap">
              <table className="ledger">
                <thead>
                  <tr><th>时间</th><th>个案</th><th>会谈</th><th>字段</th><th>原值</th><th>新值</th><th>更正原因</th></tr>
                </thead>
                <tbody>
                  {state.versions.length === 0 && (
                    <tr><td colSpan={7} className="hint">暂无更正记录。使用会谈卡片上的「会后更正」并填写原因后，每个变更字段都会在此留一版。</td></tr>
                  )}
                  {state.versions.map((v) => (
                    <tr key={v.id}>
                      <td className="nowrap">{v.at}</td>
                      <td><b>{v.caseId}</b></td>
                      <td className="nowrap">{v.sessionId.slice(0, 14)}</td>
                      <td>{v.field}</td>
                      <td className="old-val">{v.oldValue}</td>
                      <td className="new-val">{v.newValue}</td>
                      <td>{v.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel audit-panel">
            <div className="section-heading">
              <div><p>受阻台账</p><h2>被规则拦截的操作</h2></div>
              {state.blocks.length > 0 && <button className="ghost-action" onClick={() => state.blocks.forEach((b) => dispatch({ type: "dismiss-block", blockId: b.id }))}>全部清除</button>}
            </div>
            <div className="table-wrap">
              <table className="ledger">
                <thead>
                  <tr><th>时间</th><th>个案</th><th>字段</th><th>原值</th><th>触发规则</th></tr>
                </thead>
                <tbody>
                  {state.blocks.length === 0 && <tr><td colSpan={5} className="hint">暂无受阻记录。</td></tr>}
                  {state.blocks.map((b) => (
                    <tr key={b.id}>
                      <td className="nowrap">{b.at}</td>
                      <td><b>{b.caseId}</b></td>
                      <td>{b.field}</td>
                      <td className="old-val">{b.oldValue}</td>
                      <td>{b.rule}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}

/* -------------------------------- 子组件 --------------------------------- */

function MetricCard({ label, value, tone }: { label: string; value: string; tone: "ok" | "danger" | "watch" | "muted" }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <i className={`status-${tone}`} />
    </article>
  );
}

function SessionFormView({
  form,
  set,
  caseBadge,
  recordingAllowed,
  state,
  excludeReferralId,
  lockedCase,
}: {
  form: SessionForm;
  set: (f: SessionForm) => void;
  caseBadge: { text: string; tone: "ok" | "muted" | "warn" | "danger" };
  recordingAllowed: boolean;
  state: ReturnType<typeof loadState>;
  excludeReferralId?: string;
  lockedCase?: boolean;
}) {
  const busy = SUPERVISORS.map((sup) => ({
    sup,
    clash: supervisorBusy(state, form.date, form.slot, sup, excludeReferralId),
  }));

  return (
    <div className="session-form">
      <div className="field-grid">
        <label>
          <span>来访者代号</span>
          <select value={form.caseId} disabled={lockedCase} onChange={(e) => set({ ...form, caseId: e.target.value })}>
            {state.cases.map((c) => (
              <option key={c.id} value={c.id}>{c.id} · {c.theme}{c.closed ? "（已结案）" : ""}</option>
            ))}
          </select>
        </label>
        <label>
          <span>会谈日期</span>
          <input type="date" value={form.date} onChange={(e) => set({ ...form, date: e.target.value })} />
        </label>
        <label>
          <span>会谈时段</span>
          <select value={form.slot} onChange={(e) => set({ ...form, slot: e.target.value })}>
            {SLOTS.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label>
          <span>风险等级</span>
          <select value={form.risk} onChange={(e) => set({ ...form, risk: e.target.value as RiskLevel })}>
            {RISK_LEVELS.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
      </div>

      <label className="full-line">
        <span>文字摘要（始终必填）</span>
        <textarea rows={3} value={form.summary} placeholder="主诉、情绪状态、干预方法与下次目标" onChange={(e) => set({ ...form, summary: e.target.value })} />
      </label>

      <div className="consent-strip">
        <span className={`badge badge-${caseBadge.tone}`}>{caseBadge.text}</span>
      </div>
      <label className="full-line">
        <span>录音文件 {recordingAllowed ? "" : "（当前无有效录音同意，填写将被拦截；历史录音可在下方查看）"}</span>
        <input
          value={form.recordingName}
          disabled={!recordingAllowed}
          placeholder={recordingAllowed ? "如 C-421_session02.m4a" : "只能保存文字摘要"}
          onChange={(e) => set({ ...form, recordingName: e.target.value })}
        />
      </label>

      {form.risk === "高风险" && (
        <div className="referral-form">
          <h4>高风险转介单（保存会谈时一并生成）</h4>
          <div className="field-grid">
            <label>
              <span>接收督导</span>
              <select value={form.supervisor} onChange={(e) => set({ ...form, supervisor: e.target.value })}>
                {busy.map(({ sup, clash }) => (
                  <option key={sup} value={sup} disabled={!!clash}>
                    {sup}{clash ? `（该时段已接 ${clash.caseId}）` : " · 可接收"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>响应期限（不早于会谈日）</span>
              <input type="date" value={form.deadline} onChange={(e) => set({ ...form, deadline: e.target.value })} />
            </label>
          </div>
          <label className="full-line">
            <span>安全计划</span>
            <textarea
              rows={3}
              value={form.safetyPlan}
              placeholder="如：24 小时回访、移除危险物品、紧急联系人陪护、危机热线与急诊指征"
              onChange={(e) => set({ ...form, safetyPlan: e.target.value })}
            />
          </label>
        </div>
      )}
    </div>
  );
}

export default App;
