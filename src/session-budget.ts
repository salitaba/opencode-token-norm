// Facade keeping the public entry point stable: src/index.ts and the tests
// import SessionBudgetPlugin from "./session-budget.js". The implementation
// lives in ./budget/.
export { SessionBudgetPlugin } from "./budget/plugin.js"
