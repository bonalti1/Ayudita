const baseUrl = (process.env.AYUDITA_QA_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

async function main() {
  const report = await getJson("/api/source-qa");
  const checks = report.checks ?? [];
  const failed = checks.filter((check) => check.status === "fail");

  console.log(`Source QA against ${baseUrl}`);
  console.log(
    `Health: ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail`
  );
  console.log(
    `Sources: ${report.source_counts.total} total, ${report.source_counts.remembered} remembered, ${report.source_counts.contract_like} contract-like`
  );
  console.log("");

  for (const check of checks) {
    console.log(`${check.status.toUpperCase()} ${check.title}`);
    console.log(`  ${check.detail}`);
    console.log(`  Customer impact: ${check.customerImpact}`);
  }

  if (failed.length) {
    console.error(`\n${failed.length} Source QA check(s) failed.`);
    process.exit(1);
  }
}

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}`);
  }
  return response.json();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
