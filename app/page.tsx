'use client';

import { useState, useMemo, useCallback, useRef } from 'react';
import {
  Budget, CsvRow,
  fetchAllBudgets, filterCopilotBudgets, groupBudgetsByScope,
  parseCsv, getUserCsvConsumption, getCostCenterCsvConsumption,
  formatCurrency, formatPct, getUsageStatus, validateSlug,
  SCOPE_LABELS,
} from './lib/api';

const CARD: React.CSSProperties = {
  background: 'rgba(11, 16, 38, 0.72)',
  border: '1px solid rgba(168, 85, 247, 0.3)',
  borderRadius: 12,
  padding: 20,
  marginBottom: 16,
  boxShadow: '0 0 15px rgba(168, 85, 247, 0.1)',
};

const INPUT: React.CSSProperties = {
  background: 'rgba(15, 23, 42, 0.8)',
  border: '1px solid rgba(99, 102, 241, 0.3)',
  borderRadius: 6,
  padding: '10px 14px',
  color: '#e2e8f0',
  fontSize: 14,
  width: '100%',
};

const BTN: React.CSSProperties = {
  background: 'linear-gradient(135deg, #a855f7, #6366f1)',
  border: 'none',
  borderRadius: 8,
  padding: '10px 24px',
  color: '#fff',
  fontWeight: 600,
  cursor: 'pointer',
  fontSize: 14,
};

const BTN_DANGER: React.CSSProperties = {
  ...BTN,
  background: 'linear-gradient(135deg, #ef4444, #dc2626)',
};

const STATUS_COLORS: Record<string, string> = { OK: '#22c55e', NEAR: '#eab308', OVER: '#ef4444' };
const STATUS_ICONS: Record<string, string> = { OK: '🟢', NEAR: '🟡', OVER: '🔴' };

export default function Home() {
  const [slug, setSlug] = useState('');
  const [token, setToken] = useState('');
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [csvFileName, setCsvFileName] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const AIC_RATE = 0.01;

  const connect = useCallback(async () => {
    if (!slug.trim()) { setError('Please enter an enterprise slug.'); return; }
    if (!validateSlug(slug.trim())) { setError('Invalid slug. Use only alphanumeric characters and hyphens.'); return; }
    if (!token.trim()) { setError('Please enter a Personal Access Token.'); return; }
    setLoading(true);
    setError('');
    try {
      const all = await fetchAllBudgets(slug.trim(), token.trim());
      const copilot = filterCopilotBudgets(all);
      setBudgets(copilot);
      setConnected(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  }, [slug, token]);

  const disconnect = useCallback(() => {
    setToken('');
    setBudgets([]);
    setConnected(false);
    setError('');
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const all = await fetchAllBudgets(slug.trim(), token.trim());
      const copilot = filterCopilotBudgets(all);
      setBudgets(copilot);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setLoading(false);
    }
  }, [slug, token]);

  const grouped = useMemo(() => groupBudgetsByScope(budgets), [budgets]);

  const userCsvConsumption = useMemo(
    () => csvRows.length > 0 ? getUserCsvConsumption(csvRows, AIC_RATE) : new Map<string, number>(),
    [csvRows]
  );
  const ccCsvConsumption = useMemo(
    () => csvRows.length > 0 ? getCostCenterCsvConsumption(csvRows, AIC_RATE) : new Map<string, number>(),
    [csvRows]
  );

  const sortedUserBudgets = useMemo(() => {
    return [...grouped.user].sort((a, b) => {
      const pctA = a.budget_amount > 0 ? ((a.consumed_amount || 0) / a.budget_amount) * 100 : 0;
      const pctB = b.budget_amount > 0 ? ((b.consumed_amount || 0) / b.budget_amount) * 100 : 0;
      return pctB - pctA;
    });
  }, [grouped.user]);

  const blockingRisk = useMemo(() => {
    const atRisk = grouped.user.filter(b => {
      const pct = b.budget_amount > 0 ? ((b.consumed_amount || 0) / b.budget_amount) * 100 : 0;
      return pct >= 80 && pct < 100;
    });
    const blocked = grouped.user.filter(b => {
      const pct = b.budget_amount > 0 ? ((b.consumed_amount || 0) / b.budget_amount) * 100 : 0;
      return pct >= 100 && b.prevent_further_usage;
    });
    const ccAtRisk = grouped.costCenter.filter(b => {
      const consumed = b.consumed_amount || ccCsvConsumption.get(b.budget_entity_name) || 0;
      const pct = b.budget_amount > 0 ? (consumed / b.budget_amount) * 100 : 0;
      return pct >= 80;
    });
    const entBudget = grouped.enterprise[0];
    const totalConsumed = csvRows.length > 0
      ? Array.from(userCsvConsumption.values()).reduce((s, v) => s + v, 0)
      : grouped.user.reduce((s, b) => s + (b.consumed_amount || 0), 0);
    const entHeadroom = entBudget ? entBudget.budget_amount - totalConsumed : 0;
    return { atRisk, blocked, ccAtRisk, entHeadroom, totalConsumed };
  }, [grouped, ccCsvConsumption, userCsvConsumption, csvRows]);

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setCsvRows(parseCsv(text));
      setCsvFileName(file.name);
    };
    reader.readAsText(file);
  }, []);

  const hierarchyTree = useMemo(() => {
    if (budgets.length === 0) return null;
    const entBudget = grouped.enterprise[0];
    const univBudget = grouped.universal[0];
    type TreeNode = { label: string; children: TreeNode[]; color?: string };
    const tree: TreeNode = {
      label: entBudget ? `Enterprise Budget: ${formatCurrency(entBudget.budget_amount)} (global cap)` : 'Enterprise Budget: Not set',
      children: [],
    };
    for (const cc of grouped.costCenter) {
      const ccNode: TreeNode = {
        label: `Cost Center "${cc.budget_entity_name}": ${formatCurrency(cc.budget_amount)}${cc.budget_amount === 0 ? ' (BLOCKED)' : ''}`,
        children: [],
        color: cc.budget_amount === 0 ? '#ef4444' : undefined,
      };
      tree.children.push(ccNode);
    }
    if (grouped.user.length > 0) {
      const indNode: TreeNode = { label: `Individual Budgets (${grouped.user.length} users)`, children: [] };
      for (const u of sortedUserBudgets.slice(0, 20)) {
        const pct = u.budget_amount > 0 ? ((u.consumed_amount || 0) / u.budget_amount) * 100 : 0;
        const status = getUsageStatus(u.consumed_amount || 0, u.budget_amount);
        const warn = pct >= 80 ? (pct >= 100 ? ' 🔴' : ' ⚠️') : '';
        indNode.children.push({
          label: `${u.budget_entity_name}: consumed ${formatCurrency(u.consumed_amount || 0)} of ${formatCurrency(u.budget_amount)} (${formatPct(pct)})${warn}`,
          children: [],
          color: STATUS_COLORS[status],
        });
      }
      if (sortedUserBudgets.length > 20) {
        indNode.children.push({ label: `... and ${sortedUserBudgets.length - 20} more users`, children: [], color: '#94a3b8' });
      }
      tree.children.push(indNode);
    }
    if (univBudget) {
      tree.children.push({ label: `Other users (universal: ${formatCurrency(univBudget.budget_amount)})`, children: [] });
    }
    return tree;
  }, [budgets, grouped, sortedUserBudgets]);

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '24px 16px' }}>
      <header style={{ textAlign: 'center', marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, background: 'linear-gradient(135deg, #a855f7, #6366f1)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          GitHub Copilot UBB Budget Monitor
        </h1>
        <p style={{ color: '#94a3b8', marginTop: 8 }}>Real-time budget controls and consumption monitoring</p>
      </header>

      {/* Connection Panel */}
      <div style={CARD}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, color: '#a855f7' }}>🔌 Connection</h2>
        {!connected ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <div>
                <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Enterprise Slug</label>
                <input type="text" placeholder="my-enterprise" value={slug} onChange={(e) => setSlug(e.target.value)} style={INPUT} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Personal Access Token</label>
                <input type="password" placeholder="ghp_..." value={token} onChange={(e) => setToken(e.target.value)} style={INPUT} />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <button onClick={connect} disabled={loading} style={{ ...BTN, opacity: loading ? 0.6 : 1 }}>
                {loading ? '⏳ Connecting...' : '🔗 Connect'}
              </button>
              <span style={{ fontSize: 12, color: '#64748b' }}>
                🔒 Your token is only used in your browser and is never stored or sent anywhere except GitHub&apos;s API
              </span>
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span style={{ color: '#22c55e', fontWeight: 600 }}>✅ Connected to <strong>{slug}</strong></span>
            <span style={{ color: '#94a3b8' }}>({budgets.length} Copilot budgets loaded)</span>
            <div style={{ flex: 1 }} />
            <button onClick={refresh} disabled={loading} style={{ ...BTN, opacity: loading ? 0.6 : 1, padding: '8px 16px', fontSize: 13 }}>
              {loading ? '⏳' : '🔄'} Refresh
            </button>
            <button onClick={disconnect} style={{ ...BTN_DANGER, padding: '8px 16px', fontSize: 13 }}>
              ⏏️ Disconnect
            </button>
          </div>
        )}
        {error && (
          <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 8, color: '#ef4444', fontSize: 13 }}>
            ❌ {error}
          </div>
        )}
      </div>

      {connected && (
        <>
          {/* CSV Upload */}
          <div style={{ ...CARD, textAlign: 'center', cursor: 'pointer', border: isDragOver ? '2px dashed #a855f7' : CARD.border }}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setIsDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
            onClick={() => fileRef.current?.click()}
          >
            <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            {csvRows.length === 0 ? (
              <>
                <p style={{ color: '#a855f7', fontSize: 14 }}>📊 Optional: Drop a Premium Request Usage Report CSV for enriched data</p>
                <p style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>Cross-references API budgets with actual consumption data</p>
              </>
            ) : (
              <p style={{ color: '#22c55e' }}>✅ <strong>{csvFileName}</strong> — {csvRows.length.toLocaleString()} rows loaded</p>
            )}
          </div>

          {/* Blocking Risk Summary */}
          <div style={{ ...CARD, borderColor: 'rgba(239, 68, 68, 0.3)' }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#ef4444' }}>⚠️ Blocking Risk Summary</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
              <RiskCard label="Users at risk (≥80%)" count={blockingRisk.atRisk.length} color="#eab308" items={blockingRisk.atRisk.map(b => b.budget_entity_name)} />
              <RiskCard label="Users blocked" count={blockingRisk.blocked.length} color="#ef4444" items={blockingRisk.blocked.map(b => b.budget_entity_name)} />
              <RiskCard label="Cost centers at risk" count={blockingRisk.ccAtRisk.length} color="#eab308" items={blockingRisk.ccAtRisk.map(b => b.budget_entity_name)} />
              <div style={{ padding: 12, background: 'rgba(15, 23, 42, 0.5)', borderRadius: 8 }}>
                <div style={{ fontSize: 12, color: '#94a3b8' }}>Enterprise Headroom</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: blockingRisk.entHeadroom >= 0 ? '#22c55e' : '#ef4444' }}>{formatCurrency(blockingRisk.entHeadroom)}</div>
              </div>
            </div>
          </div>

          {/* Budget Cards by Scope */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16, marginBottom: 16 }}>
            {grouped.enterprise.map(b => (
              <div key={b.id} style={CARD}>
                <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: '#a855f7' }}>🏢 {SCOPE_LABELS.enterprise}</h3>
                <StatRow label="Budget Amount" value={formatCurrency(b.budget_amount)} />
                <StatRow label="Enforcement" value={b.prevent_further_usage ? '🛡️ Blocking enabled' : '⚠️ Alert only'} color={b.prevent_further_usage ? '#22c55e' : '#eab308'} />
                {b.exclude_cost_center_usage !== undefined && <StatRow label="Exclude CC Usage" value={b.exclude_cost_center_usage ? 'Yes' : 'No'} />}
                <StatRow label="Alerts" value={b.budget_alerting.will_alert ? `Yes (${b.budget_alerting.alert_recipients.join(', ')})` : 'Disabled'} />
                {csvRows.length > 0 && (
                  <>
                    <StatRow label="CSV Total Consumption" value={formatCurrency(blockingRisk.totalConsumed)} />
                    <ProgressBar pct={b.budget_amount > 0 ? (blockingRisk.totalConsumed / b.budget_amount) * 100 : 0} />
                  </>
                )}
              </div>
            ))}
            {grouped.universal.map(b => (
              <div key={b.id} style={CARD}>
                <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: '#6366f1' }}>🌐 {SCOPE_LABELS.multi_user_customer}</h3>
                <StatRow label="Budget Amount" value={formatCurrency(b.budget_amount)} />
                <StatRow label="Enforcement" value={b.prevent_further_usage ? '🛡️ Blocking enabled' : '⚠️ Alert only'} color={b.prevent_further_usage ? '#22c55e' : '#eab308'} />
                {b.budget_thresholds && <StatRow label="Alert Thresholds" value={Object.keys(b.budget_thresholds).map(k => `${k}%`).join(', ') || 'None'} />}
                <StatRow label="Users under this default" value="All users without individual budgets" />
              </div>
            ))}
            {grouped.organization.map(b => (
              <div key={b.id} style={CARD}>
                <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: '#6366f1' }}>🏛️ {SCOPE_LABELS.organization}: {b.budget_entity_name}</h3>
                <StatRow label="Budget Amount" value={formatCurrency(b.budget_amount)} />
                <StatRow label="Enforcement" value={b.prevent_further_usage ? '🛡️ Blocking enabled' : '⚠️ Alert only'} color={b.prevent_further_usage ? '#22c55e' : '#eab308'} />
                <StatRow label="Alerts" value={b.budget_alerting.will_alert ? `Yes (${b.budget_alerting.alert_recipients.join(', ')})` : 'Disabled'} />
              </div>
            ))}
          </div>

          {/* Cost Center Table */}
          {grouped.costCenter.length > 0 && (
            <div style={CARD}>
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#a855f7' }}>🏗️ Cost Center Budgets</h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: 'rgba(99, 102, 241, 0.15)' }}>
                      <Th>Cost Center</Th><Th>Budget ($)</Th><Th>Blocking?</Th><Th>Alert Recipients</Th><Th>Consumed</Th><Th>Progress</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {grouped.costCenter.map(b => {
                      const consumed = b.consumed_amount || ccCsvConsumption.get(b.budget_entity_name) || 0;
                      const pct = b.budget_amount > 0 ? (consumed / b.budget_amount) * 100 : 0;
                      const status = getUsageStatus(consumed, b.budget_amount);
                      return (
                        <tr key={b.id} style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.08)' }}>
                          <td style={{ padding: 8, fontWeight: 500 }}>{b.budget_entity_name}</td>
                          <td style={{ padding: 8, textAlign: 'right' }}>{formatCurrency(b.budget_amount)}</td>
                          <td style={{ padding: 8, textAlign: 'center' }}>{b.prevent_further_usage ? '🛡️' : '⚠️'}</td>
                          <td style={{ padding: 8, color: '#94a3b8' }}>{b.budget_alerting.alert_recipients.join(', ') || '—'}</td>
                          <td style={{ padding: 8, textAlign: 'right', color: STATUS_COLORS[status] }}>{formatCurrency(consumed)}</td>
                          <td style={{ padding: 8, width: 120 }}><ProgressBar pct={pct} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Individual User Budgets Table */}
          {grouped.user.length > 0 && (
            <div style={CARD}>
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#a855f7' }}>👤 Individual User Budgets</h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: 'rgba(99, 102, 241, 0.15)' }}>
                      <Th>Username</Th><Th>Budget ($)</Th><Th>Consumed ($)</Th><Th>Remaining ($)</Th>
                      <Th>Usage %</Th><Th>Status</Th><Th>Blocking?</Th><Th>Alert Recipients</Th>
                      {csvRows.length > 0 && <Th>CSV Cost ($)</Th>}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedUserBudgets.map(b => {
                      const consumed = b.consumed_amount || 0;
                      const remaining = b.budget_amount - consumed;
                      const pct = b.budget_amount > 0 ? (consumed / b.budget_amount) * 100 : 0;
                      const status = getUsageStatus(consumed, b.budget_amount);
                      const csvCost = userCsvConsumption.get(b.budget_entity_name);
                      return (
                        <tr key={b.id} style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.08)', background: status === 'OVER' ? 'rgba(239, 68, 68, 0.06)' : status === 'NEAR' ? 'rgba(234, 179, 8, 0.06)' : 'transparent' }}>
                          <td style={{ padding: 8, fontWeight: 500 }}>{b.budget_entity_name}</td>
                          <td style={{ padding: 8, textAlign: 'right' }}>{formatCurrency(b.budget_amount)}</td>
                          <td style={{ padding: 8, textAlign: 'right' }}>{formatCurrency(consumed)}</td>
                          <td style={{ padding: 8, textAlign: 'right', color: remaining < 0 ? '#ef4444' : '#22c55e' }}>{formatCurrency(remaining)}</td>
                          <td style={{ padding: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <div style={{ flex: 1, height: 6, background: 'rgba(148, 163, 184, 0.1)', borderRadius: 3, overflow: 'hidden', minWidth: 60 }}>
                                <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: STATUS_COLORS[status], borderRadius: 3 }} />
                              </div>
                              <span style={{ fontSize: 11, color: STATUS_COLORS[status], minWidth: 40 }}>{formatPct(pct)}</span>
                            </div>
                          </td>
                          <td style={{ padding: 8, textAlign: 'center' }}>{STATUS_ICONS[status]} {status}</td>
                          <td style={{ padding: 8, textAlign: 'center' }}>{b.prevent_further_usage ? '🛡️' : '⚠️'}</td>
                          <td style={{ padding: 8, color: '#94a3b8', fontSize: 12 }}>{b.budget_alerting.alert_recipients.join(', ') || '—'}</td>
                          {csvRows.length > 0 && <td style={{ padding: 8, textAlign: 'right', color: '#6366f1' }}>{csvCost !== undefined ? formatCurrency(csvCost) : '—'}</td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Budget Hierarchy */}
          {hierarchyTree && (
            <div style={CARD}>
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#a855f7' }}>🌳 Budget Hierarchy</h3>
              <TreeView node={hierarchyTree} depth={0} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid rgba(148, 163, 184, 0.06)' }}>
      <span style={{ color: '#94a3b8', fontSize: 13 }}>{label}</span>
      <span style={{ fontWeight: 600, fontSize: 13, color: color || '#e2e8f0' }}>{value}</span>
    </div>
  );
}

function ProgressBar({ pct }: { pct: number }) {
  const color = pct >= 100 ? '#ef4444' : pct >= 80 ? '#eab308' : '#22c55e';
  return (
    <div style={{ height: 8, background: 'rgba(148, 163, 184, 0.1)', borderRadius: 4, overflow: 'hidden' }}>
      <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.3s' }} />
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th style={{ padding: '10px 8px', textAlign: 'left', color: '#94a3b8', fontWeight: 600, whiteSpace: 'nowrap', borderBottom: '1px solid rgba(168, 85, 247, 0.2)' }}>{children}</th>
  );
}

function RiskCard({ label, count, color, items }: { label: string; count: number; color: string; items: string[] }) {
  return (
    <div style={{ padding: 12, background: 'rgba(15, 23, 42, 0.5)', borderRadius: 8 }}>
      <div style={{ fontSize: 12, color: '#94a3b8' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{count}</div>
      {items.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 11, color: '#94a3b8' }}>
          {items.slice(0, 5).join(', ')}{items.length > 5 ? ` +${items.length - 5} more` : ''}
        </div>
      )}
    </div>
  );
}

type TreeNode = { label: string; children: TreeNode[]; color?: string };

function TreeView({ node, depth }: { node: TreeNode; depth: number }) {
  return (
    <div style={{ marginLeft: depth * 20, fontFamily: 'monospace', fontSize: 13 }}>
      <div style={{ padding: '3px 0', color: node.color || '#e2e8f0' }}>
        {depth > 0 && <span style={{ color: '#4b5563' }}>├── </span>}
        {node.label}
      </div>
      {node.children.map((child, i) => (
        <TreeView key={i} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}
