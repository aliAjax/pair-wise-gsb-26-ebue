import assert from "node:assert";
import {
  CONSENT_SCOPES,
  SLOTS,
  SUPERVISORS,
  dateOffset,
  diffSession,
  evaluateCase,
  evaluateSession,
  recordingConsentValid,
  seedState,
  todayISO,
} from "../src/domain";
import { reducer } from "../src/store";
import type { CaseDraft, SessionDraft } from "../src/types";

let pass = 0;
function ok(name: string, cond: boolean) {
  assert.ok(cond, name);
  pass += 1;
  console.log("✓", name);
}

// 刷新一致性：state 以 JSON 序列化/反序列化模拟 localStorage 往返
function refresh<T>(s: T): T {
  return JSON.parse(JSON.stringify(s)) as T;
}

/* 1. 个案登记：缺紧急联系人/到期日受阻 */
{
  let s = seedState();
  const bad: CaseDraft = {
    id: "C-900",
    theme: "焦虑",
    scope: ["recording"],
    emergencyName: "",
    emergencyPhone: "",
    consentExpiry: "",
  };
  const blocks = evaluateCase(bad, s);
  ok("登记缺联系人/电话/到期日产生 3 条受阻", blocks.length === 3);
  ok("受阻含个案、字段、原值、规则四要素", blocks.every((b) => b.caseId && b.field && b.oldValue !== undefined && b.rule));
  s = reducer(s, { type: "register-case", draft: bad });
  ok("未通过校验不创建个案", s.cases.every((c) => c.id !== "C-900"));

  const good: CaseDraft = { ...bad, emergencyName: "林某（配偶）", emergencyPhone: "13800001234", consentExpiry: dateOffset(30) };
  s = reducer(s, { type: "register-case", draft: good });
  ok("登记成功", s.cases.some((c) => c.id === "C-900"));
}

/* 2. 未取得录音同意：只能保存文字摘要 */
{
  let s = seedState();
  const draft: SessionDraft = {
    caseId: "C-315", // scope 无录音且已撤回
    date: todayISO(),
    slot: SLOTS[0],
    risk: "稳定",
    summary: "仅文字摘要会谈",
    recordingName: "x.m4a",
  };
  const blocks = evaluateSession(draft, null, s, { mode: "create" });
  ok("无录音同意保存录音被拦截", blocks.some((b) => b.rule.includes("录音")));
  s = reducer(s, { type: "save-session", draft, referral: null });
  ok("被拦截后不产生会谈", s.sessions.length === 4);

  const draftText = { ...draft, recordingName: null };
  s = reducer(s, { type: "save-session", draft: draftText, referral: null });
  const saved = s.sessions.find((x) => x.summary === "仅文字摘要会谈");
  ok("仅文字摘要可以保存且 recordingName 为 null", !!saved && saved.recordingName === null);
}

/* 3. 撤回后历史仍可查、不得新增录音 */
{
  let s = seedState();
  const c042 = s.cases.find((c) => c.id === "C-042")!;
  ok("撤回前录音同意有效", recordingConsentValid(c042));
  s = reducer(s, { type: "withdraw-consent", caseId: "C-042" });
  const c = s.cases.find((x) => x.id === "C-042")!;
  ok("撤回后录音同意无效", !recordingConsentValid(c) && c.withdrawn);
  const oldSession = s.sessions.find((x) => x.id === "S-042-1");
  ok("历史录音保留可查", oldSession?.recordingName === "C-042_2026_session08.m4a");

  const draft: SessionDraft = {
    caseId: "C-042",
    date: todayISO(),
    slot: SLOTS[1],
    risk: "稳定",
    summary: "撤回后会谈",
    recordingName: "new.m4a",
  };
  s = reducer(s, { type: "save-session", draft, referral: null });
  ok("撤回后新增录音被拦截", s.sessions.every((x) => x.recordingName !== "new.m4a"));
  ok("拦截规则写入受阻台账", s.blocks.some((b) => b.rule.includes("已撤回")));
}

/* 4. 高风险转介单：必填三要素 + 督导排班唯一 */
{
  let s = seedState();
  const draft: SessionDraft = {
    caseId: "C-042",
    date: dateOffset(1),
    slot: SLOTS[2], // 与种子 R-203-1 不同时段
    risk: "高风险",
    summary: "出现自伤意念",
    recordingName: null,
  };
  const incomplete = { supervisor: SUPERVISORS[0], deadline: "", safetyPlan: "" };
  let blocks = evaluateSession(draft, incomplete, s, { mode: "create" });
  ok("缺响应期限/安全计划被拦截", blocks.length === 2);

  const ref = { supervisor: "王督导", deadline: dateOffset(1), slot: "", safetyPlan: "24h 回访" };

  // 同督导同时段冲突（种子 R-203-1：王督导 + S-203 日期 + 晚间）
  const clashDraft: SessionDraft = { ...draft, date: s.sessions.find((x) => x.id === "S-203-1")!.date, slot: SLOTS[2] };
  blocks = evaluateSession(clashDraft, ref, s, { mode: "create" });
  ok("同一督导同一时段第二单被拦截", blocks.some((b) => b.rule.includes("排班冲突")));

  s = reducer(s, { type: "save-session", draft, referral: ref });
  const created = s.referrals.find((r) => r.caseId === "C-042");
  ok("转介单生成且为待接收", !!created && created.status === "待接收"
    && created.supervisor === "王督导" && created.safetyPlan === "24h 回访");

  // 未接收前不得结案
  s = reducer(s, { type: "close-case", caseId: "C-042" });
  ok("待接收转介未结案", s.cases.find((c) => c.id === "C-042")!.closed === false);
  ok("结案受阻记录在案", s.blocks.some((b) => b.rule.includes("不得结案")));

  // 督导接收后可以结案
  s = reducer(s, { type: "receive-referral", referralId: created!.id });
  s = reducer(s, { type: "close-case", caseId: "C-042" });
  ok("接收后可以结案", s.cases.find((c) => c.id === "C-042")!.closed === true);
}

/* 5. 会后更正：原因必填 + 旧值留痕 + 版本关系 */
{
  let s = seedState();
  const original = s.sessions.find((x) => x.id === "S-119-1")!;
  const draft: SessionDraft = {
    caseId: "C-119",
    date: original.date,
    slot: original.slot,
    risk: "关注",
    summary: original.summary + "（补充）",
    recordingName: original.recordingName,
  };
  const changes = diffSession(draft, original);
  ok("差异检测命中摘要与风险等级", changes.length === 2 && changes.some((c) => c.field === "风险等级"));

  s = reducer(s, { type: "correct-session", sessionId: original.id, draft, referral: null, reason: "" });
  ok("无更正原因被拦截且不产生版本", s.versions.length === 0);

  s = reducer(s, { type: "correct-session", sessionId: original.id, draft, referral: null, reason: "来访者会后补充风险信息" });
  ok("更正成功生成 2 条字段版本", s.versions.length === 2);
  const v = s.versions.find((x) => x.field === "风险等级");
  ok("版本保留旧值/新值/原因且关联一致", v?.oldValue === "稳定" && v.newValue === "关注"
    && v.reason === "来访者会后补充风险信息" && v.caseId === "C-119" && v.sessionId === "S-119-1");

  // 刷新后同意、转介与版本关系一致
  const reloaded = refresh(s);
  ok("刷新后版本仍关联同一会谈", reloaded.versions.every((ver) => reloaded.sessions.some((ses) => ses.id === ver.sessionId)));
  ok("刷新后转介仍关联会谈与个案", reloaded.referrals.every((r) => reloaded.sessions.some((ses) => ses.id === r.sessionId)
    && reloaded.cases.some((c) => c.id === r.caseId)));
}

/* 6. 同意过期：会谈日晚于到期日不得保存录音 */
{
  const s = seedState();
  const c203 = s.cases.find((c) => c.id === "C-203")!;
  ok("C-203 录音同意已过期（未撤回但到期）", !recordingConsentValid(c203));
  const draft: SessionDraft = {
    caseId: "C-203",
    date: todayISO(),
    slot: SLOTS[0],
    risk: "稳定",
    summary: "过期后会谈",
    recordingName: "late.m4a",
  };
  const blocks = evaluateSession(draft, null, s, { mode: "create" });
  ok("过期后保存录音被拦截并提示到期日", blocks.some((b) => b.rule.includes("同意到期日")));
}

/* 7. 同意范围至少一项、代号重复、电话格式 */
{
  const s = seedState();
  const dup: CaseDraft = {
    id: "C-042",
    theme: "焦虑",
    scope: [],
    emergencyName: "某",
    emergencyPhone: "abc",
    consentExpiry: dateOffset(10),
  };
  const blocks = evaluateCase(dup, s);
  ok("重复代号/空范围/坏电话均被拦截", blocks.length === 3);
  void CONSENT_SCOPES;
}

/* 8. 更正时风险升级为高风险，补建待接收转介单并继续阻止结案 */
{
  let s = seedState();
  const original = s.sessions.find((x) => x.id === "S-042-1")!; // 原「关注」，无转介
  const draft: SessionDraft = {
    caseId: "C-042",
    date: original.date,
    slot: original.slot,
    risk: "高风险",
    summary: original.summary,
    recordingName: original.recordingName,
  };
  const referral = { supervisor: "李督导", deadline: dateOffset(0), safetyPlan: "夜间陪护+热线" };
  s = reducer(s, { type: "correct-session", sessionId: original.id, draft, referral, reason: "会后确认风险升级" });
  const r = s.referrals.find((x) => x.sessionId === original.id);
  ok("更正升级风险后补建待接收转介单", !!r && r.status === "待接收" && r.supervisor === "李督导");
  s = reducer(s, { type: "close-case", caseId: "C-042" });
  ok("新转介未接收前仍不得结案", s.cases.find((c) => c.id === "C-042")!.closed === false);
}

console.log(`\n全部 ${pass} 条规则断言通过`);
