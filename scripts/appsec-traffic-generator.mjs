const TARGET = (process.env.TARGET_ORIGIN || "https://spencerkirn.com").replace(/\/$/, "");
const PROFILE = process.env.PROFILE || "browser";
const VOLUME = Number(process.env.VOLUME || 30);
const parsedTarget = new URL(TARGET);

if (parsedTarget.hostname !== "spencerkirn.com") {
  throw new Error("Safety check: this generator is restricted to spencerkirn.com");
}
if (!Number.isInteger(VOLUME) || VOLUME < 1 || VOLUME > 100) {
  throw new Error("VOLUME must be an integer from 1 through 100");
}

const RUN_ID = `${PROFILE}-${new Date().toISOString()}-${crypto.randomUUID().slice(0, 8)}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const randomDelay = (min = 120, max = 650) => Math.floor(Math.random() * (max - min + 1)) + min;

const browserAgents = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36"
];

const profiles = {
  browser: [
    { name: "home", marker: "synthetic-browser", params: { journey: "home", page: "appsec" }, ua: browserAgents[0], accept: "text/html,application/xhtml+xml" },
    { name: "mobile", marker: "synthetic-browser", params: { journey: "mobile", page: "appsec" }, ua: browserAgents[2], accept: "text/html,application/xhtml+xml" },
    { name: "search", marker: "synthetic-browser", params: { journey: "search", q: "application security" }, ua: browserAgents[1], accept: "text/html" },
    { name: "product", marker: "synthetic-browser", params: { journey: "product", item: "waf" }, ua: browserAgents[3], accept: "text/html" },
    { name: "campaign", marker: "synthetic-browser", params: { journey: "campaign", source: "demo", medium: "synthetic" }, ua: browserAgents[0], accept: "text/html" }
  ],
  api: [
    { name: "api-json", marker: "synthetic-api", params: { api: "products", version: "v1" }, ua: "Spencer-Demo-API-Client/2.0", accept: "application/json" },
    { name: "mobile-api", marker: "synthetic-api", params: { api: "profile", client: "mobile" }, ua: "Spencer-Demo-Mobile/2.0", accept: "application/json" },
    { name: "monitor", marker: "synthetic-monitor", params: { check: "availability", probe: "github" }, ua: "Spencer-Demo-Monitor/2.0", accept: "text/html" },
    { name: "integration", marker: "synthetic-api", params: { integration: "inventory", operation: "list" }, ua: "Spencer-Partner-Integration/2.0", accept: "application/json" },
    { name: "custom-rule-event", marker: "synthetic-block", params: { control: "custom-rule", expected: "block" }, ua: "Spencer-AppSec-Test/2.0", accept: "text/html" }
  ],
  bot: [
    { name: "empty-user-agent", marker: "synthetic-bot", params: { client: "empty-ua", signal: "heuristic" }, ua: "", accept: "*/*" },
    { name: "curl", marker: "synthetic-bot", params: { client: "curl", behavior: "scripted" }, ua: "curl/8.10.0", accept: "*/*" },
    { name: "python", marker: "synthetic-bot", params: { client: "python", behavior: "scripted" }, ua: "python-requests/2.32.3", accept: "*/*" },
    { name: "headless", marker: "synthetic-bot", params: { client: "headless", behavior: "automation" }, ua: "Mozilla/5.0 HeadlessChrome/128.0 Safari/537.36", accept: "text/html" },
    { name: "scanner", marker: "synthetic-bot", params: { client: "scanner", behavior: "enumeration" }, ua: "Spencer-AppSec-Scanner/2.0", accept: "*/*" }
  ],
  attack: [
    { name: "sqli-auth-bypass", marker: "synthetic-sqli", params: { vector: "sqli", search: "' OR '1'='1'--", field: "username" }, ua: "Spencer-AppSec-Scanner/2.0", accept: "text/html" },
    { name: "sqli-union", marker: "synthetic-sqli", params: { vector: "sqli", search: "1 UNION SELECT username,password FROM users--", field: "id" }, ua: "sqlmap-demo/1.0", accept: "text/html" },
    { name: "sqli-time", marker: "synthetic-sqli", params: { vector: "sqli", search: "1; SELECT SLEEP(5)--", field: "product" }, ua: "Spencer-AppSec-Scanner/2.0", accept: "text/html" },
    { name: "xss-script", marker: "synthetic-xss", params: { vector: "xss", search: "<script>alert('cf-demo')</script>" }, ua: "Spencer-AppSec-Scanner/2.0", accept: "text/html" },
    { name: "xss-event", marker: "synthetic-xss", params: { vector: "xss", search: "<img src=x onerror=alert('cf-demo')>" }, ua: "Spencer-AppSec-Scanner/2.0", accept: "text/html" },
    { name: "xss-svg", marker: "synthetic-xss", params: { vector: "xss", search: "\"><svg/onload=alert('cf-demo')>" }, ua: "Spencer-AppSec-Scanner/2.0", accept: "text/html" },
    { name: "rce-shell", marker: "synthetic-rce", params: { vector: "rce", command: "; cat /etc/passwd" }, ua: "Spencer-AppSec-Scanner/2.0", accept: "text/html" },
    { name: "rce-substitution", marker: "synthetic-rce", params: { vector: "rce", command: "$(id)" }, ua: "Spencer-AppSec-Scanner/2.0", accept: "text/html" },
    { name: "traversal", marker: "synthetic-traversal", params: { vector: "traversal", file: "../../../../etc/passwd" }, ua: "Spencer-AppSec-Scanner/2.0", accept: "text/html" },
    { name: "encoded-mixed", marker: "synthetic-mixed", params: { vector: "sqli-xss", search: "' UNION SELECT '<script>alert(1)</script>'--" }, ua: "Spencer-AppSec-Scanner/2.0", accept: "text/html" }
  ]
};

if (!profiles[PROFILE]) {
  throw new Error(`Unknown PROFILE '${PROFILE}'. Use browser, api, bot, or attack.`);
}

async function send(template, sequence) {
  const requestId = `${RUN_ID}-${sequence}-${crypto.randomUUID().slice(0, 8)}`;
  const query = new URLSearchParams({
    "cf-demo": template.marker,
    "request-id": requestId,
    "run-id": RUN_ID,
    profile: PROFILE,
    scenario: template.name,
    sequence: String(sequence),
    ...template.params
  });
  const url = `${TARGET}/appsec?${query}`;
  const started = performance.now();

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: {
        Accept: template.accept,
        "Cache-Control": "no-cache",
        "User-Agent": template.ua,
        "X-Demo-Traffic": "scheduled-synthetic-v2",
        "X-Demo-Profile": PROFILE,
        "X-Demo-Scenario": template.name,
        "X-Demo-Request-ID": requestId
      }
    });

    return {
      profile: PROFILE,
      scenario: template.name,
      requestId,
      status: response.status,
      outcome: response.ok ? "allowed" : "mitigated-or-error",
      rayId: response.headers.get("cf-ray"),
      elapsedMs: Math.round(performance.now() - started),
      url
    };
  } catch (error) {
    return { profile: PROFILE, scenario: template.name, requestId, outcome: "request-error", error: error.message, url };
  }
}

const templates = profiles[PROFILE];
const results = [];
console.log(JSON.stringify({ runId: RUN_ID, target: TARGET, profile: PROFILE, volume: VOLUME }));

for (let i = 0; i < VOLUME; i++) {
  const template = templates[i % templates.length];
  const result = await send(template, i + 1);
  results.push(result);
  console.log(JSON.stringify(result));
  if (i < VOLUME - 1) await sleep(randomDelay());
}

const summary = results.reduce((acc, result) => {
  acc[result.outcome] = (acc[result.outcome] || 0) + 1;
  return acc;
}, {});
console.log(JSON.stringify({ runId: RUN_ID, profile: PROFILE, summary }));
