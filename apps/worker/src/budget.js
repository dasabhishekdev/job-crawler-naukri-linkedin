const { AiUsage, startOfDayIst } = require("@jobportal/db");

class BudgetExceededError extends Error {
  constructor(used, budget) {
    super(
      `Daily AI token budget reached (${used.toLocaleString("en-US")} of ${budget.toLocaleString("en-US")} tokens). AI steps pause until tomorrow; free crawls continue.`
    );
    this.name = "BudgetExceededError";
  }
}

/** In-memory budget for one run, seeded with today's usage. `budget` 0 means unlimited. */
function createBudget({ budget, used }) {
  let spent = used;
  return {
    get used() {
      return spent;
    },
    budget,
    add(tokens) {
      spent += tokens || 0;
    },
    exceeded() {
      return budget > 0 && spent >= budget;
    },
    /** Throws unless `need` tokens fit while keeping `reserve` (a fraction of the budget) free. */
    check(need = 0, reserve = 0) {
      if (budget > 0 && spent + need + budget * reserve > budget) throw new BudgetExceededError(spent, budget);
    },
  };
}

async function tokensUsedToday(userId) {
  const [row] = await AiUsage.aggregate([
    { $match: { user_id: userId, created_at: { $gte: startOfDayIst() } } },
    { $group: { _id: null, total: { $sum: "$total_tokens" } } },
  ]);
  return row?.total || 0;
}

async function budgetForUser(user) {
  return createBudget({ budget: user.crawler?.daily_token_budget ?? 1_500_000, used: await tokensUsedToday(user._id) });
}

module.exports = { createBudget, budgetForUser, tokensUsedToday, BudgetExceededError };
