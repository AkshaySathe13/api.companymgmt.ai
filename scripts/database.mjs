import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
const name = "companymgmt-postgres";
const label = "ai.companymgmt.local";
function docker(args, capture = false) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (!capture && result.status !== 0) process.exit(result.status ?? 1);
  return result;
}
const action = process.argv[2] ?? "up";
if (!["up", "stop"].includes(action)) throw new Error("Use up or stop");
const existing = docker(["inspect", name], true);
if (existing.status === 0) {
  const container = JSON.parse(existing.stdout)[0];
  if (container.Config.Labels?.[label] !== "true")
    throw new Error(
      `Container ${name} exists but is not owned by this project`,
    );
  docker([action === "up" ? "start" : "stop", name]);
} else if (action === "stop") {
  console.log("No project database container to stop");
} else {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", () =>
      reject(
        new Error(
          "Port 55432 is already in use. Choose a free port in scripts/database.mjs and DATABASE_URL before starting the database.",
        ),
      ),
    );
    probe.listen(55432, "127.0.0.1", () => probe.close(resolve));
  });
  docker(["volume", "create", "companymgmt-postgres-data"]);
  docker([
    "run",
    "--detach",
    "--name",
    name,
    "--label",
    `${label}=true`,
    "--publish",
    "127.0.0.1:55432:5432",
    "--env",
    "POSTGRES_USER=companymgmt",
    "--env",
    "POSTGRES_PASSWORD=companymgmt_local",
    "--env",
    "POSTGRES_DB=companymgmt",
    "--volume",
    "companymgmt-postgres-data:/var/lib/postgresql/data",
    "--health-cmd",
    "pg_isready -U companymgmt -d companymgmt",
    "--health-interval",
    "2s",
    "--health-timeout",
    "5s",
    "--health-retries",
    "30",
    "postgres:17-alpine",
  ]);
}
if (action === "up") {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = docker(
      ["exec", name, "pg_isready", "-U", "companymgmt", "-d", "companymgmt"],
      true,
    );
    if (result.status === 0) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!ready) throw new Error("PostgreSQL did not become ready in 60 seconds");
  console.log(
    "PostgreSQL ready on localhost:55432 (data preserved across stops)",
  );
}
