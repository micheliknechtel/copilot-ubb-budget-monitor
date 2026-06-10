export type Budget = {
  id: string;
  budget_type: 'BundlePricing' | 'SkuPricing' | 'ProductPricing';
  budget_product_sku: string;
  budget_scope: 'enterprise' | 'multi_user_customer' | 'cost_center' | 'user' | 'organization';
  budget_amount: number;
  prevent_further_usage: boolean;
  budget_entity_name: string;
  budget_alerting: {
    will_alert: boolean;
    alert_recipients: string[];
  };
  consumed_amount?: number;
  user?: string;
  exclude_cost_center_usage?: boolean;
  budget_thresholds?: Record<string, number>;
};

export type BudgetResponse = {
  budgets: Budget[];
  has_next_page: boolean;
  total_count: number;
};

export type CsvRow = {
  date: string;
  username: string;
  aic_quantity: number;
  model: string;
  cost_center_name: string;
};

const SLUG_REGEX = /^[a-zA-Z0-9-]+$/;

export function validateSlug(slug: string): boolean {
  return SLUG_REGEX.test(slug);
}

export async function fetchAllBudgets(
  enterprise: string,
  token: string
): Promise<Budget[]> {
  if (!validateSlug(enterprise)) {
    throw new Error('Invalid enterprise slug. Use only alphanumeric characters and hyphens.');
  }

  const allBudgets: Budget[] = [];
  let page = 1;
  let hasNext = true;

  while (hasNext) {
    const response = await fetch(
      `https://api.github.com/enterprises/${encodeURIComponent(enterprise)}/copilot/billing/budgets?page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );

    if (!response.ok) {
      if (response.status === 401 || response.status === 403)
        throw new Error('Invalid token or insufficient permissions. The PAT needs manage_billing:enterprise scope.');
      if (response.status === 404)
        throw new Error('Enterprise not found. Check the enterprise slug.');
      if (response.status === 429)
        throw new Error('Rate limited by GitHub. Please wait a moment and try again.');
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const data: BudgetResponse = await response.json();
    allBudgets.push(...data.budgets);
    hasNext = data.has_next_page;
    page++;
  }

  return allBudgets;
}

export function filterCopilotBudgets(budgets: Budget[]): Budget[] {
  return budgets.filter(
    b => b.budget_product_sku === 'ai_credits' || b.budget_product_sku === 'coding_agent_ai_credit'
  );
}

export function groupBudgetsByScope(budgets: Budget[]) {
  return {
    enterprise: budgets.filter(b => b.budget_scope === 'enterprise'),
    universal: budgets.filter(b => b.budget_scope === 'multi_user_customer'),
    costCenter: budgets.filter(b => b.budget_scope === 'cost_center'),
    user: budgets.filter(b => b.budget_scope === 'user'),
    organization: budgets.filter(b => b.budget_scope === 'organization'),
  };
}

export function parseCsv(text: string): CsvRow[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const dateIdx = headers.indexOf('date');
  const usernameIdx = headers.indexOf('username');
  const aicIdx = headers.indexOf('aic_quantity');
  const modelIdx = headers.indexOf('model');
  const ccIdx = headers.indexOf('cost_center_name');

  if (usernameIdx === -1 || aicIdx === -1) return [];

  return lines.slice(1).filter(l => l.trim()).map(line => {
    const cols = line.split(',').map(c => c.trim());
    return {
      date: cols[dateIdx] || '',
      username: cols[usernameIdx] || '',
      aic_quantity: parseFloat(cols[aicIdx]) || 0,
      model: cols[modelIdx] || '',
      cost_center_name: cols[ccIdx] || '',
    };
  });
}

export function getUserCsvConsumption(rows: CsvRow[], aicRate: number): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.username, (map.get(row.username) || 0) + row.aic_quantity * aicRate);
  }
  return map;
}

export function getCostCenterCsvConsumption(rows: CsvRow[], aicRate: number): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.cost_center_name) {
      map.set(row.cost_center_name, (map.get(row.cost_center_name) || 0) + row.aic_quantity * aicRate);
    }
  }
  return map;
}

export function formatCurrency(value: number): string {
  return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatPct(value: number): string {
  return value.toFixed(1) + '%';
}

export function getUsageStatus(consumed: number, budget: number): 'OK' | 'NEAR' | 'OVER' {
  if (budget <= 0) return 'OK';
  const pct = (consumed / budget) * 100;
  if (pct >= 100) return 'OVER';
  if (pct >= 80) return 'NEAR';
  return 'OK';
}

export const SCOPE_LABELS: Record<string, string> = {
  enterprise: 'Enterprise Budget',
  multi_user_customer: 'Universal Budget',
  cost_center: 'Cost Center Budget',
  user: 'Individual Budget',
  organization: 'Organization Budget',
};
