const ORIGIN = (process.env.TARGET_ORIGIN || "https://spencerkirn.com").replace(/\/$/, "");
const RUN_ID = `scheduled-${new Date().toISOString()}-${crypto.randomUUID().slice(0, 8)}`;
const MIN_DELAY_MS = 900;
const MAX_DELAY_MS = 2200;

// Low-volume, labeled synthetic traffic for an owned demo environment.
// Every request includes cf-demo=scheduled-* and X-Demo-Traffic so it can
// be identified and excluded from real traffic analysis.
const scenarios = [
  {
    name: "desktop-home",
    marker: "scheduled-baseline",
    params: { journey: "storefront", page: "home", client: "desktop" },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36",
    accept: "text/html,application/xhtml+xml"
  },
  {
    name: "mobile-browse",
    marker: "scheduled-baseline",
    params: { journey: "storefront", page: "products", client: "mobile" },
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
    accept: "text/html,application/xhtml+xml"
  },
  {
    name: "search",
    marker: "scheduled-search",
    params: { journey: "search", q: "cloudflare security", category: "demo" },
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128 Safari/537.36",
    accept: "text/html"
  },
  {
    name: "api-client",
    marker: "scheduled-api",
    params: { journey: "api", resource: "products", version: "v1" },
    userAgent: "Spencer-Demo-API-Client/1.0",
    accept: "application/json"
  },
  {
    name: "monitor",
    marker: "scheduled-monitor",
    params: { journey: "health", check: "availability" },
    userAgent: "Spencer-Demo-Monitor/1.0",
    accept: "text/html"
  },
  {
    name: "custom-rule-event",
    marker: "synthetic-block",
    params: { journey: "security-test", control: "custom-rule" },
    userAgent: "Spencer-AppSec-Test/1.0",
    accept: "text/html"
  },
  {
    name: "managed-sqli-pattern",
    marker: "scheduled-sqli",
    params: { journey: "security-test", search: "' OR 1=1--", vector: "sqli" },
    userAgent: "Spencer-AppSec-Scanner/1.0",
    accept: "text/html"
  },
  {
    name: "managed-xss-pattern",
    marker: "scheduled-xss",
    params: { journey: "security-test", search: '<script>alert("scheduled-demo")</script>', vector: "xss" },
    userAgent: "Spencer-AppSec-Scanner/1.0",
    accept: "text/html"
  }
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const randomDelay = () => Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1)) + MIN_DELAY_MS;

async function send(scenario, sequence) {
  const requestId = `${RUN_ID}-${sequence}-${crypto.randomUUID().slice(0, 8)}`;
  const query = new URLSearchParams({
    "cf-demo": scenario.marker,
    "request-id": requestId,
    "run-id": RUN_ID,
    sequence: String(sequence),
    ...scenario.params
  });
  const url = `${ORIGIN}/appsec?${query}`;
  const started = performance.now();

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: {
        "Accept": scenario.accept,
        "Cache-Control": "no-cache",
        "User-Agent": scenario.userAgent,
        "X-Demo-Traffic": "scheduled-synthetic",
        "X-Demo-Scenario": scenario.name,
        "X-Demo-Request-ID": requestId
      }
    });

    console.log(JSON.stringify({
      scenario: scenario.name,
      requestId,
      status: response.status,
      outcome: response.ok ? "allowed" : "mitigated-or-error",
      rayId: response.headers.get("cf-ray"),
      elapsedMs: Math.round(performance.now() - started),
      url
    }));
  } catch (error) {
    console.error(JSON.stringify({ scenario: scenario.name, requestId, error: error.message, url }));
    process.exitCode = 1;
  }
}

console.log(JSON.stringify({ runId: RUN_ID, origin: ORIGIN, requests: scenarios.length }));
for (let i = 0; i < scenarios.length; i++) {
  await send(scenarios[i], i + 1);
  if (i < scenarios.length - 1) await sleep(randomDelay());
}
