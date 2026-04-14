#!/usr/bin/env bun
/**
 * Schedulr - Visual Task Scheduler
 * Schedule commands, scripts, and HTTP requests
 */

const PORT = parseInt(process.env.PORT || "3000");
const STORE_FILE = ".schedulr/tasks.json";

interface Task {
  id: number;
  name: string;
  type: "http" | "shell";
  schedule: string;
  enabled: boolean;
  config: Record<string, string>;
  lastRun?: string;
  lastStatus?: "success" | "failed";
  nextRun?: string;
}

interface RunLog {
  taskId: number;
  timestamp: string;
  status: "success" | "failed";
  output: string;
  duration: number;
}

const tasks: Task[] = [];
const logs: RunLog[] = [];
let nextId = 1;

// Load tasks from disk
function load() {
  try {
    const data = Bun.file(STORE_FILE).text();
    const parsed = JSON.parse(data);
    tasks.splice(0, tasks.length, ...parsed.tasks);
    logs.splice(0, logs.length, ...parsed.logs || []);
    nextId = parsed.nextId || 1;
  } catch {
    // Start fresh
  }
}

// Save tasks to disk
function save() {
  try {
    // Create directory if needed - use sync for reliability
    const dir = STORE_FILE.substring(0, STORE_FILE.lastIndexOf("/"));
    try {
      require("fs").mkdirSync(dir, { recursive: true });
    } catch {
      // May already exist
    }
  } catch {
    // Ignore errors
  }
  const data = JSON.stringify({ tasks, logs, nextId }, null, 2);
  Bun.write(STORE_FILE, data);
}

// Parse crontab (second minute hour day month dow)
function parseCron(expr: string): { next: Date } | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5 || parts.length > 6) return null;

  const now = new Date();
  let next = new Date(now);

  // Simple: find next minute/second match
  const [sec = "0", min = "*", hour = "*", day = "*", month = "*", dow = "*"] = parts.length === 5 ? ["0", ...parts] : parts;

  const cronToValue = (field: string, max: number, isDOW = false): number[] => {
    if (field === "*") return Array.from({ length: max + 1 }, (_, i) => i);
    const result: number[] = [];
    for (const part of field.split(",")) {
      if (part.includes("/")) {
        const [range, step] = part.split("/");
        const start = range === "*" ? 0 : parseInt(range);
        const stepNum = parseInt(step);
        for (let i = start; i <= max; i += stepNum) result.push(i);
      } else if (part.includes("-")) {
        const [start, end] = part.split("-").map(Number);
        for (let i = start; i <= end; i++) result.push(i);
      } else {
        const v = parseInt(part);
        if (!isNaN(v)) result.push(isDOW && v === 7 ? 0 : v); // Handle Sunday=0 or 7
      }
    }
    return [...new Set(result)].sort((a, b) => a - b);
  };

  const seconds = cronToValue(sec, 59);
  const minutes = cronToValue(min, 59);
  const hours = cronToValue(hour, 23);
  const days = cronToValue(day, 31, true);
  const months = cronToValue(month, 12);
  const daysOfWeek = cronToValue(dow.replace("?", "*"), 6, true);

  // Advance to next valid time
  for (let i = 0; i < 525600; i++) { // Max 1 year of minutes
    next.setSeconds(next.getSeconds() + 1);

    if (!months.includes(next.getMonth() + 1)) continue;
    if (!daysOfWeek.includes(next.getDay())) continue;
    if (!days.includes(next.getDate())) continue;
    if (!hours.includes(next.getHours())) continue;
    if (!minutes.includes(next.getMinutes())) continue;
    if (!seconds.includes(next.getSeconds())) continue;

    return { next };
  }

  return null;
}

// Execute a task
async function runTask(task: Task): Promise<RunLog> {
  const start = Date.now();
  let output = "";
  let status: "success" | "failed" = "success";

  try {
    if (task.type === "http") {
      const { url, method = "GET", headers = {} } = task.config;
      const res = await fetch(url, { method, headers });
      output = `HTTP ${res.status} ${res.statusText}`;
    } else if (task.type === "shell") {
      const { command } = task.config;
      const proc = Bun.spawn(["sh", "-c", command], { stdout: "pipe" });
      output = await new Response(proc.stdout).text();
      const code = await proc.exited;
      if (code !== 0) {
        status = "failed";
        output += `\nExit code: ${code}`;
      }
    }
  } catch (e: any) {
    status = "failed";
    output = e.message || String(e);
  }

  const duration = Date.now() - start;
  return { taskId: task.id, timestamp: new Date().toISOString(), status, output, duration };
}

// Scheduler loop
async function scheduler() {
  while (true) {
    const now = new Date();

    for (const task of tasks) {
      if (!task.enabled) continue;

      const next = parseCron(task.schedule);
      if (!next) continue;

      task.nextRun = next.next.toISOString();

      // Check if should run (within 1 second window)
      const diff = Math.abs(next.next.getTime() - now.getTime());
      if (diff < 2000) {
        const log = await runTask(task);
        logs.unshift(log);
        if (logs.length > 100) logs.pop();
        task.lastRun = log.timestamp;
        task.lastStatus = log.status;
        save();
      }
    }

    await new Promise(r => setTimeout(r, 1000));
  }
}

// HTTP Server
const server = Bun.serve({
  port: PORT,

  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // CORS headers
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    // API routes
    if (path === "/api/tasks" && req.method === "GET") {
      return Response.json({ tasks }, { headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (path === "/api/tasks" && req.method === "POST") {
      const body = await req.json();
      const task: Task = {
        id: nextId++,
        name: body.name || "Untitled",
        type: body.type || "shell",
        schedule: body.schedule || "* * * * *",
        enabled: true,
        config: body.config || {},
      };
      tasks.push(task);
      save();
      return Response.json({ task }, { headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (path.startsWith("/api/tasks/") && req.method === "DELETE") {
      const id = parseInt(path.split("/")[3]);
      const idx = tasks.findIndex(t => t.id === id);
      if (idx >= 0) {
        tasks.splice(idx, 1);
        save();
      }
      return new Response(null, { status: 204, headers: cors });
    }

    if (path.startsWith("/api/tasks/") && req.method === "PATCH") {
      const id = parseInt(path.split("/")[3]);
      const body = await req.json();
      const task = tasks.find(t => t.id === id);
      if (task) {
        Object.assign(task, body);
        save();
      }
      return Response.json({ task }, { headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (path === "/api/logs" && req.method === "GET") {
      return Response.json({ logs: logs.slice(0, 50) }, { headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (path === "/api/run" && req.method === "POST") {
      const body = await req.json();
      const task = tasks.find(t => t.id === body.id);
      if (task) {
        const log = await runTask(task);
        logs.unshift(log);
        task.lastRun = log.timestamp;
        task.lastStatus = log.status;
        save();
        return Response.json({ log }, { headers: { ...cors, "Content-Type": "application/json" } });
      }
      return new Response("Task not found", { status: 404, headers: cors });
    }

    // Serve SPA
    return new Response(Bun.file("index.html"), {
      headers: { ...cors, "Content-Type": "text/html" },
    });
  },
});

console.log(`
╭──────────────────────────────────────╮
│  ⚡ Schedulr                          │
│  Visual Task Scheduler                │
├──────────────────────────────────────┤
│  Dashboard: http://localhost:${PORT}   │
│  API:      http://localhost:${PORT}/api │
├──────────────────────────────────────┤
│  Ctrl+C to stop                       │
╰──────────────────────────────────────╯
`);

// Load and start
load();
scheduler();