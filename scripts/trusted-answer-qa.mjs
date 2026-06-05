const baseUrl = (process.env.AYUDITA_QA_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

const checks = [];

async function main() {
  const wifiAnswer = await postJson("/api/memory-query", {
    question: "What is my office WiFi password?"
  });

  check(
    "WiFi answers from Trusted Answers",
    wifiAnswer.answer_source === "trusted_answer" && wifiAnswer.confidence === "high"
  );
  check("WiFi answer includes password", String(wifiAnswer.answer ?? "").includes("westswitch551"));
  check("WiFi has duplicate proof sources grouped", wifiAnswer.duplicate_source_count === 2);

  const proofDocumentId = wifiAnswer.document?.id;
  check("WiFi answer points to a proof document", Boolean(proofDocumentId));

  const proofDocument = proofDocumentId
    ? await getJson(`/api/documents/${proofDocumentId}`)
    : { document: null };

  check(
    "Proof document is the WiFi screenshot",
    proofDocument.document?.document_type === "Wi-Fi Settings Screenshot"
  );
  check(
    "Proof document signed URL is the WiFi screenshot file",
    String(proofDocument.document?.source_url ?? "").includes("whatsapp-4447825912129359.jpg")
  );

  const tollAnswer = await postJson("/api/memory-query", {
    question: "What toll bill do I owe?"
  });

  check("Broad toll question does not over-answer", tollAnswer.answer === null && tollAnswer.confidence === "none");
  check("Broad toll question reports ambiguity", String(tollAnswer.message ?? "").includes("more than one"));

  const trustedAnswers = await getJson("/api/trusted-answers");
  const officeWifi = trustedAnswers.trusted_answers?.find((answer) => answer.title === "Office WiFi");
  check("Trusted Answers contains Office WiFi", Boolean(officeWifi));
  check("Office WiFi has two proof sources", officeWifi?.source_count === 2);
  check("Office WiFi main proof matches answer document", officeWifi?.main_document_id === proofDocumentId);

  const failed = checks.filter((item) => !item.ok);
  for (const item of checks) {
    console.log(`${item.ok ? "PASS" : "FAIL"} ${item.name}`);
  }

  if (failed.length) {
    console.error(`\n${failed.length} trusted-answer QA check(s) failed against ${baseUrl}.`);
    process.exit(1);
  }

  console.log(`\nTrusted-answer QA passed against ${baseUrl}.`);
}

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}`);
  }
  return response.json();
}

async function postJson(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}`);
  }
  return response.json();
}

function check(name, ok) {
  checks.push({ name, ok: Boolean(ok) });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
