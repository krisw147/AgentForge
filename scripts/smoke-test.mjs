const apiUrl = (process.env.SMOKE_API_URL || "http://127.0.0.1:8000").replace(
  /\/$/,
  ""
);
const webUrl = (process.env.SMOKE_WEB_URL || "http://127.0.0.1:3000").replace(
  /\/$/,
  ""
);
const email = process.env.SMOKE_EMAIL || "lin@forward.tech";
const password = process.env.SMOKE_PASSWORD || "demo1234";
const runAgent =
  process.env.SMOKE_RUN === "true" || process.argv.includes("--run");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function jsonRequest(path, options = {}, cookie = "") {
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

async function main() {
  const health = await jsonRequest("/health");
  assert(health.response.ok, "API health check failed");

  const unauthorized = await jsonRequest("/api/dashboard");
  assert(unauthorized.response.status === 401, "Unauthorized request should return 401");

  const login = await jsonRequest("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  assert(login.response.ok, `Login failed: ${login.body?.detail || login.response.status}`);
  const setCookie = login.response.headers.get("set-cookie") || "";
  const cookie = setCookie.split(";")[0];
  assert(cookie.startsWith("agentforge_session="), "Session cookie missing");

  const [me, dashboard, agents, tools, mcpServers] = await Promise.all([
    jsonRequest("/api/auth/me", {}, cookie),
    jsonRequest("/api/dashboard", {}, cookie),
    jsonRequest("/api/agents", {}, cookie),
    jsonRequest("/api/tools", {}, cookie),
    jsonRequest("/api/mcp/servers", {}, cookie)
  ]);
  for (const result of [me, dashboard, agents, tools, mcpServers]) {
    assert(result.response.ok, `Authenticated request failed: ${result.response.status}`);
  }
  assert(dashboard.body?.stats, "Dashboard stats missing");
  assert(Array.isArray(agents.body) && agents.body.length > 0, "No agents found");
  assert(Array.isArray(tools.body), "Tool list malformed");

  const web = await fetch(webUrl);
  assert(web.ok, `Web health check failed: ${web.status}`);

  let runResult = null;
  if (runAgent) {
    const runnableAgent = agents.body.find((agent) => agent.latestVersion);
    assert(runnableAgent, "No published agent available");
    const created = await jsonRequest(
      "/api/runs",
      {
        method: "POST",
        body: JSON.stringify({
          agent_id: runnableAgent.id,
          input: "帮我查一下订单 ORD-2026-1088 现在是什么状态？"
        })
      },
      cookie
    );
    assert(created.response.status === 202, "Run creation failed");
    let run = created.body;
    const deadline = Date.now() + 60_000;
    while (!["completed", "failed", "rejected", "needs_input", "waiting_approval"].includes(run.status)) {
      assert(Date.now() < deadline, "Agent smoke run timed out");
      await new Promise((resolve) => setTimeout(resolve, 350));
      const current = await jsonRequest(`/api/runs/${run.id}`, {}, cookie);
      assert(current.response.ok, "Run polling failed");
      run = current.body;
    }
    assert(run.status === "completed", `Agent run ended with ${run.status}`);
    runResult = {
      id: run.id,
      status: run.status,
      output: run.output,
      events: run.events?.length || 0
    };
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        api: apiUrl,
        web: webUrl,
        user: me.body.user.email,
        tenant: me.body.activeTenant.slug,
        agents: agents.body.length,
        tools: tools.body.length,
        mcpServers: mcpServers.body.length,
        run: runResult
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(`Smoke test failed: ${error.message}`);
  process.exit(1);
});
