import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Construeix el paquet del CRM de PROVES des de Git, no des del worktree.
 * Això evita que un `app/` arrel no seguit faci ombra a `src/app/`.
 */

const repoDir = fileURLToPath(new URL("..", import.meta.url));
const outputDir = resolve(process.argv[2] ?? join(repoDir, ".package-cpanel-proves"));
const stageDir = mkdtempSync(join(tmpdir(), "vocero-proves-"));
const archivePath = join(stageDir, "source.tar");
const runner = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: stageDir,
    stdio: "inherit",
    env: { ...process.env, NEXT_DIST_DIR: ".next-cpanel" },
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} ha fallat amb ${result.status ?? "senyal"}`);
  }
}

try {
  const archive = execFileSync("git", ["-C", repoDir, "archive", "--format=tar", "HEAD"], {
    maxBuffer: 64 * 1024 * 1024,
  });
  writeFileSync(archivePath, archive);
  execFileSync("tar", ["-xf", archivePath, "-C", stageDir], { stdio: "inherit" });

  // `app/` a l'arrel és un directori local no seguit que Next pot prioritzar
  // sobre `src/app/`. El worktree no es modifica: només s'exclou de l'escenari
  // de construcció (i, per tant, de l'artefacte) si arriba a estar present.
  const rootAppDir = join(stageDir, "app");
  rmSync(rootAppDir, { recursive: true, force: true });
  if (existsSync(rootAppDir)) {
    throw new Error("No s'ha pogut excloure app/ de l'escenari de packaging");
  }

  run(runner, ["install", "--frozen-lockfile"]);
  run(runner, ["build"]);

  const manifestPath = join(stageDir, ".next-cpanel", "app-path-routes-manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (Object.keys(manifest).length === 0) {
    throw new Error("app-path-routes-manifest.json és buit");
  }

  const healthArtifact = join(stageDir, ".next-cpanel", "server", "app", "api", "health", "route.js");
  if (!existsSync(healthArtifact)) {
    throw new Error("No s'ha generat l'artefacte de /api/health");
  }

  rmSync(outputDir, { recursive: true, force: true });
  cpSync(stageDir, outputDir, {
    recursive: true,
    filter: (source) =>
      source !== archivePath &&
      source !== rootAppDir &&
      !source.includes(`${join(stageDir, "node_modules")}`),
  });
  if (existsSync(join(outputDir, "app"))) {
    throw new Error("L'artefacte conté app/ a l'arrel");
  }
  console.log(`Paquet PROVES generat a ${outputDir}`);
} finally {
  rmSync(stageDir, { recursive: true, force: true });
}
