// Opt-in only: semantic, performance and safety assertions retain their budgets.
// This extends Testing Library's asynchronous DOM-loading wait on a busy host.
if (typeof document !== 'undefined') {
  const { configure } = await import('@testing-library/react');
  configure({ asyncUtilTimeout: Number(process.env.REHAB_TEST_TIMEOUT_MS) });
}

export {};
