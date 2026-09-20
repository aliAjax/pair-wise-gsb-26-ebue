import { useMemo, useState } from "react";
import "./styles.css";
import type { ActionResult, CaseFile, ConsentScope, Referral, RiskLevel, Session } from "./types";
import {
  RULES,
  SUPERVISOR_SLOTS,
  SCOPE_OPTIONS,
  canRecordNow,
  caseRisk,
  consentStatus,
  consentValidAt,
  consistencyCheck,
  daysFromToday,
  slotTaken,
  todayISO,
} from "./rules";
import { useLedgerStore } from "./store";

type Tab = "cases" | "referrals" | "audit";

interface Banner {
  caseId: string;
  action: string;
  field: string;
  oldValue: string;
  rule: string;
}

function fmtDate(iso: string): string {
  if (!iso) return "—";
  return iso.length >= 10 ? iso.slice(0, 10) : iso;
}
function fmtDateTime(iso: string): string {
  if (!iso) return "—";
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

function RiskBadge({ risk }: { risk: string }) {
  const cls = risk === "高风险" ? "badge-danger" : risk === "关注" ? "badge-watch" : "badge-ok";
  return <span className={`badge ${cls}`}>{risk}</span>;
}

function ConsentBadge({ file }: { file: CaseFile }) {
  const s = consentStatus(file.consent);
  return <span className={`badge badge-consent-${s.tone}`}>{s.label}</span>;
}

export default function App() {
  const store = useLedgerStore();
  const { state } = store;
  const [tab, setTab] = useState<Tab>("cases");
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>("C-042");
  const [banner, setBanner] = useState<Banner | null>(null);
  const [sessionModalCase, setSessionModalCase] = useState<string | null>(null);
  const [correctSession, setCorrectSession] = useState<string | null>(null);

  const issues = useMemo(() => consistencyCheck(state), [state]);

  const run = (res: ActionResult) => {
    if (!res.ok && res.blocker) setBanner(res.blocker);
    return res.ok;
  };

  const activeCases = Object.values(state.cases).filter((c) => c.status === "进行中");
  const highRiskCases = activeCases.filter((c) => caseRisk(c, state) === "高风险");
  const pending = Object.values(state.referrals).filter((r) => r.status === "待接收");
  const weekSessions = Object.values(state.sessions).filter((s) => {
    const d = s.heldAt.slice(0, 10);
    return d >= "2026-09-14" && d <= "2026-09-20";
  });

  const selectedCase = selectedCaseId ? state.cases[selectedCaseId] : null;

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-12 · 录音同意与高风险转介台账</p>
          <h1>心理咨询个案记录</h1>
          <p className="subtitle">
            登记录音同意范围、紧急联系人与到期日；高风险会谈自动生成转介单。
            未取得录音同意只存文字摘要，同意撤回后历史仍可查；督导接收前不得结案。
          </p>
          <div className={`health-pill ${issues.length ? "health-bad" : "health-ok"}`}>
            {issues.length === 0
              ? `刷新体检通过：${todayISO()} 同意、转介与版本关系一致（R7）`
              : `刷新体检发现 ${issues.length} 项异常：同意/转介/版本关系不一致（R7）`}
          </div>
        </div>
        <div className="stack-card">
          <span>台账基准日</span>
          <strong>{todayISO()}</strong>
          <span>同意到期 / 响应期限均按此日期判定</span>
        </div>
      </section>

      {banner && (
        <div className="blocker-banner" role="alert">
          <div>
            <strong>⛔ 操作被规则阻止</strong>
            <p>
              个案 <b>{banner.caseId}</b> · {banner.action} · 字段「{banner.field}」
              {banner.oldValue ? <> · 原值：<b>{banner.oldValue}</b></> : null}
            </p>
            <p className="rule-text">{banner.rule}</p>
          </div>
          <button onClick={() => setBanner(null)}>知道了</button>
        </div>
      )}

      <section className="metrics-grid">
        <MetricCard label="活跃个案" value={String(activeCases.length)} tone="ok" sub="进行中档案" />
        <MetricCard label="高风险关注" value={String(highRiskCases.length)} tone="danger" sub="最新会谈评为高风险" />
        <MetricCard label="待接收转介" value={String(pending.length)} tone="warn" sub="督导接收前不得结案" />
        <MetricCard label="本周会谈" value={String(weekSessions.length)} tone="ok" sub="09-14 至 09-20" />
      </section>

      <nav className="tabs">
        <button className={tab === "cases" ? "active" : ""} onClick={() => setTab("cases")}>个案台账</button>
        <button className={tab === "referrals" ? "active" : ""} onClick={() => setTab("referrals")}>
          高风险转介单{pending.length > 0 ? <em className="tab-dot">{pending.length}</em> : null}
        </button>
        <button className={tab === "audit" ? "active" : ""} onClick={() => setTab("audit")}>
          版本与阻断
        </button>
      </nav>

      <section className="workspace">
        <aside className="panel narrow">
          <h2>督导排班</h2>
          <p className="aside-note">同一督导同一时段只接一单（R4）</p>
          <div className="supervisor-list">
            {state.supervisors.map((sup) => (
              <div key={sup.id} className="supervisor-card">
                <h3>{sup.name} <small>{sup.title}</small></h3>
                <ul>
                  {sup.slots.map((slot) => {
                    const taken = slotTaken(state, sup.id, slot);
                    return (
                      <li key={slot} className={taken ? "slot-taken" : "slot-free"}>
                        <span>{slot}</span>
                        {taken ? (
                          <b>{taken.id} · {taken.caseId}</b>
                        ) : (
                          <em>可派单</em>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
          <h2>台账规则</h2>
          <ul className="rule-list">
            {Object.values(RULES).map((r) => (
              <li key={r.slice(0, 2)}>{r}</li>
            ))}
          </ul>
          <button className="ghost-btn" onClick={store.resetDemo}>恢复演示数据</button>
        </aside>

        <section className="panel main-panel">
          {tab === "cases" && (
            <CasesTab
              store={store}
              selectedCaseId={selectedCaseId}
              onSelect={setSelectedCaseId}
              run={run}
              onNewSession={setSessionModalCase}
              onCorrect={setCorrectSession}
            />
          )}
          {tab === "referrals" && (
            <ReferralsTab store={store} run={run} onOpenCase={(id) => { setSelectedCaseId(id); setTab("cases"); }} />
          )}
          {tab === "audit" && <AuditTab store={store} issues={issues} />}
        </section>
      </section>

      {sessionModalCase && (
        <NewSessionModal
          file={state.cases[sessionModalCase]}
          store={store}
          run={run}
          onClose={() => setSessionModalCase(null)}
        />
      )}
      {correctSession && (
        <CorrectModal
          session={state.sessions[correctSession]}
          store={store}
          run={run}
          onClose={() => setCorrectSession(null)}
        />
      )}
    </main>
  );
}

function MetricCard({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: "ok" | "warn" | "danger" }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <i className={`status-${tone}`} />
      <small className="metric-sub">{sub}</small>
    </article>
  );
}

/* ---------------- 个案台账页 ---------------- */

function CasesTab({
  store,
  selectedCaseId,
  onSelect,
  run,
  onNewSession,
  onCorrect,
}: {
  store: ReturnType<typeof useLedgerStore>;
  selectedCaseId: string | null;
  onSelect: (id: string) => void;
  run: (r: ActionResult) => boolean;
  onNewSession: (caseId: string) => void;
  onCorrect: (sessionId: string) => void;
}) {
  const { state } = store;
  const [showRegister, setShowRegister] = useState(false);
  const files = Object.values(state.cases).sort((a, b) => a.id.localeCompare(b.id));

  return (
    <>
      <div className="section-heading">
        <div>
          <p>个案登记</p>
          <h2>录音同意与个案档案</h2>
        </div>
        <button className="primary-action" onClick={() => setShowRegister((v) => !v)}>
          {showRegister ? "收起登记表" : "＋ 新登记个案"}
        </button>
      </div>

      {showRegister && <RegisterForm store={store} run={run} onDone={() => setShowRegister(false)} onSelect={onSelect} />}

      <div className="case-layout">
        <div className="case-list">
          {files.map((file) => {
            const risk = caseRisk(file, state);
            const pendingCount = Object.values(state.referrals).filter(
              (r) => r.caseId === file.id && r.status === "待接收"
            ).length;
            return (
              <button
                key={file.id}
                className={`case-row ${selectedCaseId === file.id ? "selected" : ""}`}
                onClick={() => onSelect(file.id)}
              >
                <span className="case-id">{file.id}</span>
                <span className="case-main">
                  <b>{file.code}</b>
                  <small>{file.topic} · {file.sessionIds.length} 次会谈</small>
                </span>
                <span className="case-tags">
                  <RiskBadge risk={risk} />
                  {file.status === "已结案" ? <span className="badge badge-closed">已结案</span> : null}
                  {pendingCount > 0 && <span className="badge badge-danger">待接收×{pendingCount}</span>}
                </span>
              </button>
            );
          })}
        </div>

        <div className="case-detail">
          {selectedCaseId && state.cases[selectedCaseId] ? (
            <CaseDetail
              key={selectedCaseId}
              file={state.cases[selectedCaseId]}
              store={store}
              run={run}
              onNewSession={() => onNewSession(selectedCaseId)}
              onCorrect={onCorrect}
            />
          ) : (
            <p className="empty-hint">请选择左侧个案查看同意、会谈与转介详情。</p>
          )}
        </div>
      </div>
    </>
  );
}

function RegisterForm({
  store,
  run,
  onDone,
  onSelect,
}: {
  store: ReturnType<typeof useLedgerStore>;
  run: (r: ActionResult) => boolean;
  onDone: () => void;
  onSelect: (id: string) => void;
}) {
  const [code, setCode] = useState("");
  const [topic, setTopic] = useState("");
  const [emergencyName, setEmergencyName] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [scope, setScope] = useState<ConsentScope>("仅督导抽听");
  const [agreedFrom, setAgreedFrom] = useState(todayISO());
  const [expiresAt, setExpiresAt] = useState(daysFromToday(180));

  const submit = () => {
    const res = store.registerCase({
      code, topic, emergencyName, emergencyPhone, scope, agreedFrom, expiresAt,
    });
    if (run(res) && res.id) {
      onSelect(res.id);
      onDone();
    }
  };

  return (
    <div className="register-form">
      <div className="field-grid">
        <label><span>来访者代号 *</span><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="如：李某（28岁/设计）" /></label>
        <label><span>咨询主题 *</span><input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="如：焦虑 / 亲子" /></label>
        <label><span>紧急联系人 *</span><input value={emergencyName} onChange={(e) => setEmergencyName(e.target.value)} placeholder="姓名（关系）" /></label>
        <label><span>紧急联系电话 *</span><input value={emergencyPhone} onChange={(e) => setEmergencyPhone(e.target.value)} placeholder="如：138-0000-0000" /></label>
        <label>
          <span>录音同意范围 *</span>
          <select value={scope} onChange={(e) => setScope(e.target.value as ConsentScope)}>
            {SCOPE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="hint-label">
          <span>范围为"不同意"时，会谈只能保存文字摘要（R1）</span>
        </label>
        <label><span>同意生效日 *</span><input type="date" value={agreedFrom} onChange={(e) => setAgreedFrom(e.target.value)} /></label>
        <label><span>同意到期日 *</span><input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} /></label>
      </div>
      <div className="form-actions">
        <button className="primary-action" onClick={submit}>登记并生成版本记录</button>
      </div>
    </div>
  );
}

function CaseDetail({
  file,
  store,
  run,
  onNewSession,
  onCorrect,
}: {
  file: CaseFile;
  store: ReturnType<typeof useLedgerStore>;
  run: (r: ActionResult) => boolean;
  onNewSession: () => void;
  onCorrect: (id: string) => void;
}) {
  const { state } = store;
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [reason, setReason] = useState("");
  const pendingRefs = Object.values(state.referrals).filter(
    (r) => r.caseId === file.id && r.status === "待接收"
  );
  const sessions = file.sessionIds.map((id) => state.sessions[id]).filter(Boolean);

  return (
    <div className="detail-wrap">
      <div className="detail-head">
        <div>
          <h3>{file.code} <small>{file.id} · {file.topic}</small></h3>
          <div className="detail-badges">
            <RiskBadge risk={caseRisk(file, state)} />
            <ConsentBadge file={file} />
            {file.status === "已结案" && <span className="badge badge-closed">已结案</span>}
          </div>
        </div>
        <div className="detail-actions">
          <button onClick={onNewSession} disabled={file.status === "已结案"}>＋ 新增会谈</button>
          <button
            className="danger-outline"
            onClick={() => run(store.closeCase(file.id))}
            disabled={file.status === "已结案"}
            title={pendingRefs.length > 0 ? "存在待接收转介单，不得结案（R5）" : "无未接收转介，可结案"}
          >
            结案
          </button>
        </div>
      </div>

      <div className="info-grid">
        <div className="info-box">
          <h4>录音同意</h4>
          <dl>
            <dt>同意范围</dt><dd>{file.consent.scope}</dd>
            <dt>生效日 / 到期日</dt><dd>{fmtDate(file.consent.agreedFrom)} ～ {fmtDate(file.consent.expiresAt)}</dd>
            <dt>状态</dt><dd>{consentStatus(file.consent).label}</dd>
          </dl>
          {file.consent.active ? (
            withdrawOpen ? (
              <div className="withdraw-box">
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="撤回原因（必填，R2）。撤回后停止新录音，历史录音与版本仍可查。"
                />
                <div className="inline-actions">
                  <button
                    className="danger-btn"
                    onClick={() => {
                      if (run(store.withdrawConsent(file.id, reason))) {
                        setWithdrawOpen(false);
                        setReason("");
                      }
                    }}
                  >确认撤回</button>
                  <button onClick={() => setWithdrawOpen(false)}>取消</button>
                </div>
              </div>
            ) : (
              <button className="ghost-btn" onClick={() => setWithdrawOpen(true)}>撤回录音同意</button>
            )
          ) : (
            <p className="notice">同意已撤回：此后会谈仅保存文字摘要；下方撤回前的历史录音仍可查阅（R2）。</p>
          )}
          {file.consent.history.length > 0 && (
            <details className="history-details">
              <summary>同意变更历史（{file.consent.history.length}）</summary>
              {file.consent.history.map((h, i) => (
                <div key={i} className="history-item">
                  <b>{h.action}</b> · {fmtDateTime(h.at)} · {h.scope}
                  <p>{h.reason}</p>
                  <small>版本 {h.versionId || "—"}</small>
                </div>
              ))}
            </details>
          )}
        </div>
        <div className="info-box">
          <h4>紧急联系</h4>
          <dl>
            <dt>联系人</dt><dd>{file.emergencyName}</dd>
            <dt>电话</dt><dd>{file.emergencyPhone}</dd>
            <dt>建档时间</dt><dd>{fmtDateTime(file.createdAt)}</dd>
          </dl>
        </div>
      </div>

      {pendingRefs.length > 0 && (
        <div className="pending-strip">
          ⚠ 有 {pendingRefs.length} 张转介单待督导接收（{pendingRefs.map((r) => r.id).join("、")}），
          在接收前不得结案（R5）。
        </div>
      )}

      <h4 className="sessions-title">会谈记录（{sessions.length}）</h4>
      <div className="session-list">
        {sessions.map((s) => (
          <SessionCard
            key={s.id}
            session={s}
            file={file}
            referral={s.referralId ? state.referrals[s.referralId] : undefined}
            supervisor={
              s.referralId
                ? state.supervisors.find((x) => x.id === state.referrals[s.referralId!].supervisorId)
                : undefined
            }
            canCorrect={file.status !== "已结案"}
            onCorrect={() => onCorrect(s.id)}
          />
        ))}
      </div>
    </div>
  );
}

function SessionCard({
  session,
  file,
  referral,
  supervisor,
  canCorrect,
  onCorrect,
}: {
  session: Session;
  file: CaseFile;
  referral?: Referral;
  supervisor?: { name: string };
  canCorrect: boolean;
  onCorrect: () => void;
}) {
  const validAtRecording = consentValidAt(file.consent, session.heldAt);
  const currentlyActive = file.consent.active && validAtRecording;
  return (
    <article className={`session-card ${session.risk === "高风险" ? "is-high" : ""}`}>
      <header>
        <div>
          <b>{fmtDateTime(session.heldAt)}</b>
          <span className="session-id">{session.id}</span>
        </div>
        <RiskBadge risk={session.risk} />
      </header>
      <dl className="session-fields">
        <dt>主要困扰</dt><dd>{session.concern}</dd>
        <dt>干预方法</dt><dd>{session.intervention}</dd>
        <dt>下次目标</dt><dd>{session.nextGoal}</dd>
      </dl>

      <div className={`recording-box ${session.recording.audioName ? "has-audio" : "text-only"}`}>
        <div className="recording-head">
          <b>{session.recording.audioName ? "🔊 音频 + 文字摘要" : "📝 仅文字摘要"}</b>
          {session.recording.audioName && (
            <span className="scope-chip">录制时同意：{session.recording.scopeAtRecording}</span>
          )}
        </div>
        <p>{session.recording.summary}</p>
        {session.recording.audioName ? (
          <div className="audio-row">
            <span className="audio-file">🎧 {session.recording.audioName}</span>
            {!currentlyActive && <small>{!file.consent.active ? "同意已撤回" : "同意已过期"}：历史录音仅留档查阅，不再用于新用途（R2）</small>}
          </div>
        ) : (
          <small>{file.consent.active ? "依据 R1，本次会谈无有效同意范围，音频未保存。" : "同意已撤回，依据 R1 仅保存文字摘要。"}</small>
        )}
      </div>

      {referral && (
        <div className={`referral-strip ${referral.status === "待接收" ? "pending" : "accepted"}`}>
          <b>转介单 {referral.id}</b>
          <span>督导：{supervisor?.name ?? referral.supervisorId} · {referral.slot}</span>
          <span>响应期限：{fmtDate(referral.responseDue)}
            {referral.status === "待接收" && referral.responseDue < todayISO() && <em className="overdue">（已逾期）</em>}
          </span>
          <span className={`ref-status ${referral.status === "待接收" ? "st-pending" : "st-accepted"}`}>{referral.status}</span>
        </div>
      )}

      <div className="card-foot">
        <button className="ghost-btn" onClick={onCorrect} disabled={!canCorrect}>会后更正（保留旧值）</button>
        {session.closed && <small>随个案已结案</small>}
      </div>
    </article>
  );
}

/* ---------------- 新增会谈弹窗（含高风险转介单） ---------------- */

function NewSessionModal({
  file,
  store,
  run,
  onClose,
}: {
  file: CaseFile;
  store: ReturnType<typeof useLedgerStore>;
  run: (r: ActionResult) => boolean;
  onClose: () => void;
}) {
  const { state } = store;
  const [heldAt, setHeldAt] = useState(`${todayISO()}T10:00`);
  const [risk, setRisk] = useState<RiskLevel>("稳定");
  const [concern, setConcern] = useState("");
  const [intervention, setIntervention] = useState("");
  const [nextGoal, setNextGoal] = useState("");
  const [summary, setSummary] = useState("");
  const [wantAudio, setWantAudio] = useState(false);
  const [audioName, setAudioName] = useState("");
  const [supervisorId, setSupervisorId] = useState(state.supervisors[0]?.id ?? "");
  const [slot, setSlot] = useState(SUPERVISOR_SLOTS[0]);
  const [responseDue, setResponseDue] = useState(daysFromToday(3));
  const [safetyPlan, setSafetyPlan] = useState("");

  const valid = canRecordNow(file.consent, heldAt);
  const clash = risk === "高风险" ? slotTaken(state, supervisorId, slot) : undefined;

  const submit = () => {
    const name = wantAudio && audioName.trim() ? audioName.trim() : null;
    const res = store.addSession(file.id, {
      heldAt,
      risk,
      concern: concern || "（未填写）",
      intervention: intervention || "（未填写）",
      nextGoal: nextGoal || "（未填写）",
      summary,
      audioName: name,
      supervisorId,
      slot,
      responseDue,
      safetyPlan,
    });
    if (run(res)) onClose();
  };

  return (
    <Modal title={`新增会谈 · ${file.id} ${file.code}`} onClose={onClose}>
      <div className="consent-reminder">
        {valid ? (
          <span className="reminder-ok">本次会谈日期在同意有效期内（{file.consent.scope}，至 {fmtDate(file.consent.expiresAt)}），可保存音频。</span>
        ) : (
          <span className="reminder-warn">本次会谈无有效录音同意{!file.consent.active ? "（已撤回）" : file.consent.scope === "不同意" ? "（范围：不同意）" : "（已过期）"}：只能保存文字摘要，上传音频将被 R1 阻止。</span>
        )}
      </div>
      <div className="field-grid">
        <label><span>会谈时间</span><input type="datetime-local" value={heldAt} onChange={(e) => setHeldAt(e.target.value)} /></label>
        <label>
          <span>风险等级</span>
          <select value={risk} onChange={(e) => setRisk(e.target.value as RiskLevel)}>
            <option value="稳定">稳定</option>
            <option value="关注">关注</option>
            <option value="高风险">高风险（必须转介）</option>
          </select>
        </label>
      </div>
      <div className="field-grid">
        <label><span>主要困扰</span><textarea value={concern} onChange={(e) => setConcern(e.target.value)} /></label>
        <label><span>干预方法</span><textarea value={intervention} onChange={(e) => setIntervention(e.target.value)} /></label>
      </div>
      <label className="full-label"><span>文字摘要 *（始终可保存）</span><textarea value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="会谈内容摘要" /></label>
      <label className="full-label"><span>下次目标</span><input value={nextGoal} onChange={(e) => setNextGoal(e.target.value)} /></label>

      <div className="audio-toggle">
        <label className="check-line">
          <input type="checkbox" checked={wantAudio} onChange={(e) => setWantAudio(e.target.checked)} />
          <span>保存音频文件</span>
        </label>
        {wantAudio && (
          <input value={audioName} onChange={(e) => setAudioName(e.target.value)} placeholder="音频文件名，如 C-042-0920.m4a" />
        )}
      </div>

      {risk === "高风险" && (
        <div className="referral-form">
          <h4>高风险转介单（R3，必须填写）</h4>
          <div className="field-grid">
            <label>
              <span>接收督导</span>
              <select value={supervisorId} onChange={(e) => setSupervisorId(e.target.value)}>
                {state.supervisors.map((s) => <option key={s.id} value={s.id}>{s.name}（{s.title}）</option>)}
              </select>
            </label>
            <label>
              <span>督导时段（同一督导同一时段只接一单 · R4）</span>
              <select value={slot} onChange={(e) => setSlot(e.target.value)}>
                {(state.supervisors.find((s) => s.id === supervisorId)?.slots ?? SUPERVISOR_SLOTS).map((x) => (
                  <option key={x} value={x}>{x}{slotTaken(state, supervisorId, x) ? "（已占用）" : ""}</option>
                ))}
              </select>
            </label>
            <label><span>响应期限 *</span><input type="date" value={responseDue} onChange={(e) => setResponseDue(e.target.value)} /></label>
          </div>
          <label className="full-label">
            <span>安全计划 *（紧急联络 / 风险物品 / 求助通道 / 复盘安排）</span>
            <textarea rows={4} value={safetyPlan} onChange={(e) => setSafetyPlan(e.target.value)} />
          </label>
          {clash && <p className="inline-error">该时段已被转介单 {clash.id}（个案 {clash.caseId}）占用，提交将被 R4 阻止。</p>}
        </div>
      )}

      <div className="form-actions">
        <button className="primary-action" onClick={submit}>登记会谈{risk === "高风险" ? "并生成转介单" : ""}</button>
        <button onClick={onClose}>取消</button>
      </div>
    </Modal>
  );
}

/* ---------------- 会后更正弹窗 ---------------- */

function CorrectModal({
  session,
  store,
  run,
  onClose,
}: {
  session: Session;
  store: ReturnType<typeof useLedgerStore>;
  run: (r: ActionResult) => boolean;
  onClose: () => void;
}) {
  const [risk, setRisk] = useState<RiskLevel>(session.risk);
  const [concern, setConcern] = useState(session.concern);
  const [intervention, setIntervention] = useState(session.intervention);
  const [nextGoal, setNextGoal] = useState(session.nextGoal);
  const [summary, setSummary] = useState(session.recording.summary);
  const [reason, setReason] = useState("");

  const upgradedToHigh = risk === "高风险" && session.risk !== "高风险";

  const submit = () => {
    const res = store.correctSession(session.id, {
      reason, risk, concern, intervention, nextGoal, summary,
    });
    if (run(res)) onClose();
  };

  return (
    <Modal title={`会后更正 · ${session.id}`} onClose={onClose}>
      <p className="modal-note">更正不会覆盖原值：每个发生变化的字段都会连同<b>旧值</b>与<b>更正原因</b>写入版本流水（R6）。</p>
      <div className="field-grid">
        <label>
          <span>风险等级</span>
          <select value={risk} onChange={(e) => setRisk(e.target.value as RiskLevel)}>
            <option value="稳定">稳定</option>
            <option value="关注">关注</option>
            <option value="高风险">高风险</option>
          </select>
        </label>
      </div>
      {upgradedToHigh && (
        <p className="inline-error">
          将会谈升级为高风险必须先有转介单（R3）。请先在「高风险转介单」页完成派单，或改由新增会谈登记。
        </p>
      )}
      <label className="full-label"><span>主要困扰</span><textarea value={concern} onChange={(e) => setConcern(e.target.value)} /></label>
      <label className="full-label"><span>干预方法</span><textarea value={intervention} onChange={(e) => setIntervention(e.target.value)} /></label>
      <label className="full-label"><span>下次目标</span><input value={nextGoal} onChange={(e) => setNextGoal(e.target.value)} /></label>
      <label className="full-label"><span>文字摘要</span><textarea value={summary} onChange={(e) => setSummary(e.target.value)} /></label>
      <label className="full-label">
        <span>更正原因 *（R6）</span>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="如：来访者会后补充信息 / 录入笔误" />
      </label>
      <div className="form-actions">
        <button className="primary-action" onClick={submit} disabled={upgradedToHigh}>保存更正（旧值留档）</button>
        <button onClick={onClose}>取消</button>
      </div>
    </Modal>
  );
}

/* ---------------- 转介单页 ---------------- */

function ReferralsTab({
  store,
  run,
  onOpenCase,
}: {
  store: ReturnType<typeof useLedgerStore>;
  run: (r: ActionResult) => boolean;
  onOpenCase: (id: string) => void;
}) {
  const { state } = store;
  const refs = Object.values(state.referrals).sort((a, b) =>
    a.status === b.status ? a.responseDue.localeCompare(b.responseDue) : a.status === "待接收" ? -1 : 1
  );

  return (
    <>
      <div className="section-heading">
        <div>
          <p>R3 / R4 / R5</p>
          <h2>高风险转介单</h2>
        </div>
      </div>
      <div className="referral-list">
        {refs.map((ref) => {
          const file = state.cases[ref.caseId];
          const session = state.sessions[ref.sessionId];
          const sup = state.supervisors.find((s) => s.id === ref.supervisorId);
          const overdue = ref.status === "待接收" && ref.responseDue < todayISO();
          return (
            <article key={ref.id} className={`referral-card ${ref.status === "待接收" ? "pending" : "accepted"}`}>
              <header>
                <div>
                  <h3>{ref.id}</h3>
                  <button className="link-btn" onClick={() => onOpenCase(ref.caseId)}>
                    {ref.caseId} · {file?.code}
                  </button>
                  <small> 关联会谈 {ref.sessionId}（{fmtDateTime(session?.heldAt ?? "")}）</small>
                </div>
                <span className={`ref-status big ${ref.status === "待接收" ? "st-pending" : "st-accepted"}`}>
                  {ref.status}
                </span>
              </header>
              <div className="referral-grid">
                <div><dt>接收督导</dt><dd>{sup?.name ?? ref.supervisorId}（{sup?.title}）</dd></div>
                <div><dt>督导时段</dt><dd>{ref.slot}</dd></div>
                <div>
                  <dt>响应期限</dt>
                  <dd>{fmtDate(ref.responseDue)} {overdue && <em className="overdue">已逾期</em>}</dd>
                </div>
                <div><dt>派单时间</dt><dd>{fmtDateTime(ref.createdAt)}</dd></div>
              </div>
              <div className="safety-box">
                <h4>安全计划</h4>
                <p>{ref.safetyPlan}</p>
              </div>
              <footer>
                {ref.status === "待接收" ? (
                  <button
                    className="primary-action"
                    onClick={() => run(store.acceptReferral(ref.id))}
                  >
                    {sup?.name ?? "督导"} 确认接收
                  </button>
                ) : (
                  <span className="accepted-note">已于 {fmtDateTime(ref.acceptedAt ?? "")} 接收；个案方可进入结案流程（R5）</span>
                )}
              </footer>
            </article>
          );
        })}
      </div>
    </>
  );
}

/* ---------------- 审计页：版本关系 + 阻断台账 ---------------- */

function AuditTab({ store, issues }: { store: ReturnType<typeof useLedgerStore>; issues: ReturnType<typeof consistencyCheck> }) {
  const { state } = store;
  const versions = [...state.versions].sort((a, b) => b.seq - a.seq);
  const blockers = state.blockers;

  return (
    <>
      <div className="section-heading">
        <div>
          <p>R6 / R7</p>
          <h2>版本流水与阻断记录</h2>
        </div>
      </div>

      {issues.length > 0 && (
        <div className="issue-box">
          <h4>刷新体检异常（R7）</h4>
          <ul>{issues.map((x, i) => <li key={i} className={x.level === "异常" ? "issue-bad" : ""}>[{x.level}] {x.text}</li>)}</ul>
        </div>
      )}

      <h4 className="sessions-title">被规则阻止的操作（{blockers.length}）</h4>
      <div className="table-wrap">
        <table className="ledger-table">
          <thead>
            <tr><th>时间</th><th>个案</th><th>操作</th><th>字段</th><th>原值</th><th>命中规则</th></tr>
          </thead>
          <tbody>
            {blockers.map((b) => (
              <tr key={b.id}>
                <td>{fmtDateTime(b.at)}</td>
                <td><b>{b.caseId}</b></td>
                <td>{b.action}</td>
                <td>{b.field}</td>
                <td className="old-value">{b.oldValue || "—"}</td>
                <td className="rule-cell">{b.rule}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4 className="sessions-title">版本流水（{versions.length}，倒序）</h4>
      <div className="version-list">
        {versions.map((v) => (
          <article key={v.id} className="version-card">
            <header>
              <span className="version-seq">#{String(v.seq).padStart(3, "0")}</span>
              <span className={`version-kind kind-${v.kind}`}>{v.kind}</span>
              <b>{v.id}</b>
              <small>{fmtDateTime(v.at)}</small>
            </header>
            <p className="version-rel">
              个案 <b>{v.caseId}</b>
              {v.sessionId && <> · 会谈 <b>{v.sessionId}</b></>}
              {v.referralId && <> · 转介单 <b>{v.referralId}</b></>}
            </p>
            <p className="version-reason">{v.reason}</p>
            <div className="change-list">
              {v.changes.map((c, i) => (
                <div key={i} className="change-row">
                  <span className="change-field">{c.field}</span>
                  <span className="change-old" title="旧值（保留）">{c.oldValue || "（空）"}</span>
                  <span className="change-arrow">→</span>
                  <span className="change-new">{c.newValue}</span>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

/* ---------------- 通用组件 ---------------- */

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
