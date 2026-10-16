#!/usr/bin/env node
/**
 * paper-digest CLI.
 *
 * Subcommands:
 *
 *   paper-digest prompt <source> [--out <file>]
 *       Fetch the source and print the master prompt (Markdown-output instructions).
 *       Use this to hand the prompt to a chat AI, which returns the digest Markdown.
 *
 *   paper-digest digest <source> [--out <dir>]
 *       Full pipeline: fetch -> OpenRouter agent (Markdown) -> template -> HTML.
 *
 *   paper-digest template <digest.md> [--out <dir>] [--stdout]
 *       Take an already-written digest Markdown (with YAML frontmatter) and render
 *       it into the HTML template. Reads Markdown from a file argument, from `-`,
 *       or from stdin (piped). With --stdout the rendered HTML is written to stdout
 *       instead of a file.
 *
 * source: an arXiv id/link, a URL, raw HTML text, or a local PDF path.
 */

import { resolve } from "./fetch.js";
import { buildMasterPrompt } from "./prompt.js";
import { digestSource, loadConfig, createClient } from "./digest.js";
import { renderString, renderFile, outputFilenameBase, sanitize, shortenedTitle, extractYear, venueAbbv } from "./template.js";
import { extractMarkdown } from "./llm.js";
import { readFile, mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { existsSync, readFileSync } from "fs";

const DEFAULT_OUT = "outputs";

function parseArgs(argv) {
  const args = argv.slice(2);
  const subcommand = args[0];
  const rest = args.slice(1);
  let out = DEFAULT_OUT;
  let stdout = false;
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--out" || rest[i] === "-o") {
      out = rest[++i];
    } else if (rest[i] === "--stdout" || rest[i] === "-s") {
      stdout = true;
    } else {
      positional.push(rest[i]);
    }
  }
  return { subcommand, out, stdout, positional };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function readLocalIfFile(source) {
  if (existsSync(source)) {
    return readFileSync(source, "utf8");
  }
  return source;
}

async function runPrompt(source) {
  const resolved = await resolve(readLocalIfFile(source));
  resolved.whatRead =
    resolved.kind === "arxiv" && !resolved.html
      ? "arXiv abstract page only (no HTML version)"
      : resolved.kind === "arxiv"
        ? "arXiv HTML full text"
        : "provided HTML";
  const prompt = buildMasterPrompt({
    paperText: resolved.html ? extractTextFromHtml(resolved.html) : "",
    figures: resolved.figures || [],
    baseUrl: resolved.baseUrl || "",
    whatRead: resolved.whatRead,
  });
  return { prompt, source: resolved };
}

async function runDigest(source, { outDir, cfg }) {
  const resolved = await resolve(readLocalIfFile(source));
  if (resolved.kind === "pdf") {
    throw new Error("PDF text extraction is not implemented; supply HTML or a URL.");
  }
  const paperText = resolved.html ? extractTextFromHtml(resolved.html) : "";
  resolved.whatRead =
    resolved.kind === "arxiv" && !resolved.html
      ? "arXiv abstract page only (no HTML version)"
      : resolved.kind === "arxiv"
        ? "arXiv HTML full text"
        : "provided HTML";

  const llm = createClient(cfg);
  const md = await digestSource(resolved, { client: llm });

  // Inject figures and baseUrl into frontmatter so standalone template
  // rendering can resolve image URLs (figures are parsed at fetch time).
  let mdText = md.raw;
  const fmEnd = mdText.indexOf("\n---\n", 4);
  if (fmEnd !== -1) {
    const injection = `figures: ${JSON.stringify(md.figures || [])}\nbaseUrl: ${JSON.stringify(md.baseUrl || "")}\n`;
    mdText = mdText.slice(0, fmEnd + 1) + injection + mdText.slice(fmEnd + 1);
  }

  // Persist intermediate digest Markdown next to the output.
  await mkdir(outDir, { recursive: true });
  const baseName = outputFilenameBase(md, resolved);
  const mdPath = join(outDir, baseName + ".md");
  await writeFile(mdPath, mdText, "utf8");

  const html = await renderString(md, resolved);
  const htmlPath = join(outDir, baseName + ".html");
  await writeFile(htmlPath, html, "utf8");

  return { digest: md, mdPath, htmlPath, source: resolved };
}

async function runTemplate(mdPath, { outDir, stdout }) {
  let text;
  let sourceLabel;
  if (mdPath === undefined || mdPath === "-" || mdPath === "") {
    text = await readStdin();
    sourceLabel = "<stdin>";
  } else {
    text = await readFile(mdPath, "utf8");
    sourceLabel = mdPath;
  }
  const { metadata, body, _salvaged, raw } = extractMarkdown(text);
  if (_salvaged) {
    console.warn(`[paper-digest] salvaged malformed Markdown from ${sourceLabel}`);
  }
  // Reconstruct a minimal source descriptor from whatever metadata the markdown carries.
  const source = {
    figures: metadata.figures || [],
    baseUrl: metadata.baseUrl || "",
    value: sourceLabel,
  };
  const digest = {
    ...metadata,
    sections: [], // filled by render? No - need sections from body
    body,
    raw,
  };
  // We need to parse sections from body. digestSource does this, but here we
  // only have raw markdown. Re-run the split locally.
  const { splitSections, parseIcymi, parseJudge, parseCitations } = await import("./digest.js");
  const sections = splitSections(body);
  for (const s of sections) {
    if (s.id === "icymi") s.entries = parseIcymi(s.content);
    if (s.id === "judge") s.rows = parseJudge(s.content);
    if (s.id === "src") s.citations = parseCitations(s.content);
  }
  digest.sections = sections;
  const html = await renderString(digest, source);
  let outPath = null;
  if (!stdout) {
    outPath = await renderFile(digest, source, outDir);
  }
  return { html, digest, outPath };
}

function extractTextFromHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export async function run(argv) {
  const { subcommand, out, stdout, positional } = parseArgs(argv);

  if (subcommand === "prompt") {
    if (positional.length === 0) {
      console.error("Usage: paper-digest prompt <source> [--out <file>]");
      process.exit(1);
    }
    const { prompt, source } = await runPrompt(positional[0]);
    if (out !== DEFAULT_OUT) {
      await writeFile(out, prompt, "utf8");
      console.log(`Wrote prompt to ${out}`);
    } else {
      process.stdout.write(prompt);
    }
    return;
  }

  if (subcommand === "digest") {
    if (positional.length === 0) {
      console.error("Usage: paper-digest digest <source> [--out <dir>]");
      process.exit(1);
    }
    const cfg = loadConfig();
    const result = await runDigest(positional[0], { outDir: out, cfg });
    console.log(`Wrote ${result.htmlPath}`);
    console.log(`Digest Markdown: ${result.mdPath}`);
    console.log(`Verdict: ${result.digest.verdict}`);
    return;
  }

  if (subcommand === "template") {
    if (positional.length > 1) {
      console.error("Usage: paper-digest template [digest.md|-] [--out <dir>] [--stdout]");
      process.exit(1);
    }
    if (positional.length === 0 && process.stdin.isTTY) {
      console.error("Usage: paper-digest template [digest.md|-] [--out <dir>] [--stdout]");
      process.exit(1);
    }
    const { html, digest, outPath } = await runTemplate(positional[0], { outDir: out, stdout });
    if (stdout) {
      process.stdout.write(html);
      return;
    }
    console.log(`Wrote ${outPath}`);
    return;
  }

  console.error(
    "Usage: paper-digest <prompt|digest|template> <source|digest.md> [--out <dir|file>] [--stdout]"
  );
  process.exit(1);
}

const mainFile = process.argv[1] || "";
if (mainFile && (mainFile.endsWith("src/cli.js") || mainFile.endsWith("src\\cli.js"))) {
  run(process.argv).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
