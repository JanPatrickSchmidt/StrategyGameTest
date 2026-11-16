// Abgleich Spec gegen Tests (E16b): welche Regel-Kennungen der Spec stehen in keinem Testnamen?
// Rein: arbeitet nur auf übergebenen Texten, Dateizugriff liegt in specCoverageCli.ts.

/** Eine in der Spec definierte Regel. */
export interface SpecRule {
  readonly id: string;
  /** Kurztitel (fett gedruckter Name oder Überschrift), kann leer sein. */
  readonly title: string;
  /** Abschnitt der obersten Ebene, z. B. „R-9 Kampf“. */
  readonly section: string;
  /** Zeile in der Spec (ab 1). */
  readonly line: number;
}

/** Ein ausgeführter Test (`it` oder `test`) mit Fundort und den Namen der umschließenden `describe`-Blöcke. */
export interface TestTitle {
  readonly file: string;
  readonly line: number;
  readonly title: string;
  /** Namen der umschließenden `describe`-Blöcke, außen zuerst. Ihre Kennungen gelten für diesen Test. */
  readonly describes: readonly string[];
}

export interface RuleCoverage {
  readonly rule: SpecRule;
  /** Tests, deren Name oder umschließender `describe`-Name die Kennung enthält. */
  readonly tests: readonly TestTitle[];
  /** Dateien, in denen die Kennung nur außerhalb von Testnamen vorkommt (Kommentare, Code). */
  readonly mentionedIn: readonly string[];
}

export interface CoverageReport {
  readonly rules: readonly RuleCoverage[];
  readonly covered: readonly RuleCoverage[];
  readonly uncovered: readonly RuleCoverage[];
  /** Kennungen in Testnamen, die die Spec nicht definiert (Tippfehler oder veraltete Kennungen). */
  readonly unknownIds: readonly { readonly id: string; readonly tests: readonly TestTitle[] }[];
}

const ID_PATTERN = /R-[0-9]+[a-z]?(?:\.[0-9]+[a-z]?)*/g;

/** Alle Regel-Kennungen in einem Text, in Reihenfolge, ohne Doppelte. */
export function ruleIdsIn(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(ID_PATTERN)) {
    if (!found.includes(match[0])) found.push(match[0]);
  }
  return found;
}

/**
 * Liest die definierten Regeln aus der Spec: Überschriften (`## R-9 Kampf`, `### R-9.4 Zielwahl`)
 * und Aufzählungspunkte, die mit einer fetten Kennung beginnen (`- **R-7.5 Genesen:** …`).
 * Erwähnungen im Fließtext definieren keine Regel.
 */
export function parseSpecRules(markdown: string): SpecRule[] {
  const rules: SpecRule[] = [];
  let section = "";
  const lines = markdown.split(/\r?\n/);
  lines.forEach((raw, index) => {
    const heading = /^(#{2,6})\s+(R-[0-9]+[a-z]?(?:\.[0-9]+[a-z]?)*)\s*(.*)$/.exec(raw);
    const bullet = /^\s*(?:[-*]|\d+\.)\s+\*\*(R-[0-9]+[a-z]?(?:\.[0-9]+[a-z]?)*)\s*([^*]*)\*\*/.exec(raw);
    let id: string | undefined;
    let title = "";
    if (heading) {
      id = heading[2];
      title = (heading[3] ?? "").trim();
      if (heading[1] === "##") section = `${id} ${title}`.trim();
    } else if (bullet) {
      id = bullet[1];
      title = (bullet[2] ?? "").replace(/:$/, "").trim();
      if (title === "") {
        // Ohne fetten Namen: Anfang des Regeltexts als Titel (z. B. „- **R-2.1** Die Spieler sitzen …“).
        const rest = raw.slice(bullet[0].length).replace(/[`*]/g, "").trim();
        title = rest.length > 60 ? `${rest.slice(0, 57).trimEnd()} …` : rest;
      }
    }
    if (id === undefined || rules.some((rule) => rule.id === id)) return;
    rules.push({ id, title, section, line: index + 1 });
  });
  return rules;
}

/** Nur die Blätter: Regeln, unter denen keine weitere Kennung mit Punkt steht (R-9 hat R-9.1 …). */
export function leafRules(rules: readonly SpecRule[]): SpecRule[] {
  return rules.filter((rule) => !rules.some((other) => other.id.startsWith(`${rule.id}.`)));
}

/**
 * Zwei maskierte Fassungen eines Quelltexts, gleich lang wie das Original, Zeilenumbrüche bleiben:
 * `noComments` ohne Kommentare, `codeOnly` zusätzlich ohne Inhalte von String- und Template-Literalen
 * (Ausdrücke in `${…}` bleiben Code). Regex-Literale werden nicht erkannt; `//` darin wäre ein Kommentar.
 */
export function maskSource(source: string): { readonly noComments: string; readonly codeOnly: string } {
  const noComments: string[] = [];
  const codeOnly: string[] = [];
  const blank = (ch: string) => (ch === "\n" ? "\n" : " ");
  // Stapel offener Template-Literale: Zahl der offenen geschweiften Klammern im aktuellen `${…}`.
  const templates: number[] = [];
  let state: "code" | "line" | "block" | "single" | "double" | "template" = "code";
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i] as string;
    const next = source[i + 1];
    const push = (a: string, b: string) => {
      noComments.push(a);
      codeOnly.push(b);
    };
    switch (state) {
      case "code":
        if (ch === "/" && next === "/") {
          state = "line";
          push(" ", " ");
        } else if (ch === "/" && next === "*") {
          state = "block";
          push(" ", " ");
          push(" ", " ");
          i += 1;
        } else if (ch === "'" || ch === '"') {
          state = ch === "'" ? "single" : "double";
          push(ch, ch);
        } else if (ch === "`") {
          state = "template";
          push(ch, ch);
        } else {
          if (templates.length > 0) {
            const depth = templates[templates.length - 1] as number;
            if (ch === "{") templates[templates.length - 1] = depth + 1;
            else if (ch === "}") {
              if (depth === 0) {
                templates.pop();
                state = "template";
              } else templates[templates.length - 1] = depth - 1;
            }
          }
          push(ch, ch);
        }
        break;
      case "line":
        if (ch === "\n") state = "code";
        push(blank(ch), blank(ch));
        break;
      case "block":
        if (ch === "*" && next === "/") {
          state = "code";
          push(" ", " ");
          push(" ", " ");
          i += 1;
        } else push(blank(ch), blank(ch));
        break;
      case "single":
      case "double":
      case "template":
        if (ch === "\\" && next !== undefined) {
          push(ch, " ");
          push(next, blank(next));
          i += 1;
        } else if ((state === "single" && ch === "'") || (state === "double" && ch === '"') || (state === "template" && ch === "`")) {
          state = "code";
          push(ch, ch);
        } else if (state === "template" && ch === "$" && next === "{") {
          templates.push(0);
          state = "code";
          push(ch, ch);
          push("{", "{");
          i += 1;
        } else push(ch, blank(ch));
        break;
    }
  }
  return { noComments: noComments.join(""), codeOnly: codeOnly.join("") };
}

/** Index der schließenden Klammer zur öffnenden bei `open` in maskiertem Code, sonst Ende des Texts. */
function matchingParen(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === "(") depth += 1;
    else if (code[i] === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return code.length;
}

// Modifikatoren, mit denen ein Test oder Block nicht ausgeführt wird oder nur sein Scheitern prüft.
const NOT_RUN = new Set(["skip", "todo", "skipIf", "fails"]);

/**
 * Liest die ausgeführten Tests einer Testdatei: `it(` und `test(` (auch `.each(...)(`, `.only`, `.concurrent`)
 * mit einem String-Literal als erstem Argument, jeweils mit den Namen der umschließenden `describe`-Blöcke.
 * Nicht gezählt werden (P10): Tests und Blöcke mit `.skip`, `.todo`, `.skipIf(…)` oder `.fails`, alles in
 * Kommentaren und `describe`-Namen ohne einen gezählten Test darin.
 */
export function parseTestTitles(file: string, source: string): TestTitle[] {
  const { noComments, codeOnly } = maskSource(source);
  const pattern =
    /\b(it|test|describe)((?:\.(?:skip|only|concurrent|sequential|todo|fails|skipIf\((?:[^()]|\([^()]*\))*\)|runIf\((?:[^()]|\([^()]*\))*\)))*)(?:\.each\((?:[^()]|\([^()]*\))*\))?\(\s*(["'`])((?:\\.|(?!\3)[^\\])*)\3/g;
  interface Call {
    readonly keyword: string;
    readonly run: boolean;
    readonly title: string;
    readonly start: number;
    readonly end: number;
  }
  const calls: Call[] = [];
  for (const match of noComments.matchAll(pattern)) {
    const keyword = match[1];
    const modifiers = match[2] ?? "";
    const title = match[4];
    if (keyword === undefined || title === undefined || match.index === undefined) continue;
    // Treffer innerhalb eines Strings (z. B. Beispiel-Quelltext in einem Test) sind keine Aufrufe.
    if (codeOnly.slice(match.index, match.index + keyword.length) !== keyword) continue;
    // Methodenaufrufe wie `/re/.test("…")` sind keine Tests.
    if (codeOnly[match.index - 1] === ".") continue;
    const quoteStart = match.index + match[0].length - title.length - 2;
    const open = codeOnly.lastIndexOf("(", quoteStart);
    const names = [...modifiers.matchAll(/\.([A-Za-z]+)/g)].map((m) => m[1] ?? "");
    calls.push({
      keyword,
      run: !names.some((name) => NOT_RUN.has(name)),
      title,
      start: match.index,
      end: matchingParen(codeOnly, open),
    });
  }
  const blocks = calls.filter((call) => call.keyword === "describe");
  const titles: TestTitle[] = [];
  for (const call of calls) {
    if (call.keyword === "describe") continue;
    const enclosing = blocks.filter((block) => block.start < call.start && call.start < block.end);
    if (!call.run || enclosing.some((block) => !block.run)) continue;
    const line = source.slice(0, call.start).split("\n").length;
    titles.push({ file, line, title: call.title, describes: enclosing.map((block) => block.title) });
  }
  return titles;
}

export interface SourceFile {
  readonly path: string;
  readonly content: string;
}

/** Abgleich: je Blatt-Regel die Tests mit der Kennung im Namen. */
export function coverage(specMarkdown: string, testFiles: readonly SourceFile[], otherFiles: readonly SourceFile[] = []): CoverageReport {
  const allRules = parseSpecRules(specMarkdown);
  const leaves = leafRules(allRules);
  const titles = testFiles.flatMap((file) => parseTestTitles(file.path, file.content));
  const titlesById = new Map<string, TestTitle[]>();
  for (const title of titles) {
    for (const id of ruleIdsIn([...title.describes, title.title].join(" "))) {
      const list = titlesById.get(id) ?? [];
      list.push(title);
      titlesById.set(id, list);
    }
  }
  const mentionIndex = new Map<string, string[]>();
  for (const file of [...testFiles, ...otherFiles]) {
    for (const id of ruleIdsIn(file.content)) {
      const list = mentionIndex.get(id) ?? [];
      if (!list.includes(file.path)) list.push(file.path);
      mentionIndex.set(id, list);
    }
  }
  const rules: RuleCoverage[] = leaves.map((rule) => ({
    rule,
    tests: titlesById.get(rule.id) ?? [],
    mentionedIn: mentionIndex.get(rule.id) ?? [],
  }));
  const known = new Set(allRules.map((rule) => rule.id));
  const unknownIds = [...titlesById.entries()]
    .filter(([id]) => !known.has(id))
    .map(([id, tests]) => ({ id, tests }))
    .sort((a, b) => compareRuleIds(a.id, b.id));
  return {
    rules,
    covered: rules.filter((entry) => entry.tests.length > 0),
    uncovered: rules.filter((entry) => entry.tests.length === 0),
    unknownIds,
  };
}

/** Natürliche Sortierung von Kennungen: R-2.5 < R-10.1, R-17.5 < R-17a.1. */
export function compareRuleIds(a: string, b: string): number {
  const parts = (id: string) => id.slice(2).split(/(\d+)/).filter((part) => part !== "");
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const x = left[i];
    const y = right[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = Number(x);
    const ny = Number(y);
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) {
      if (nx !== ny) return nx - ny;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** Kurzer Text für die Konsole. */
export function formatCoverage(report: CoverageReport): string {
  const lines = [
    `Regeln (Blätter): ${report.rules.length}, mit Test: ${report.covered.length}, ohne Test: ${report.uncovered.length}`,
  ];
  for (const entry of report.uncovered) {
    const where = entry.mentionedIn.length > 0 ? ` (erwähnt in ${entry.mentionedIn.length} Datei(en))` : "";
    lines.push(`  ohne Test: ${entry.rule.id} ${entry.rule.title}${where}`);
  }
  for (const unknown of report.unknownIds) {
    lines.push(`  unbekannte Kennung in Testnamen: ${unknown.id} (${unknown.tests.length}×, z. B. ${unknown.tests[0]?.file ?? "?"})`);
  }
  return lines.join("\n");
}

/** Markdown-Tabelle aller Blatt-Regeln mit Zahl der Tests und erstem Fundort (für Berichte). */
export function coverageTable(report: CoverageReport): string {
  const escape = (text: string) => text.replace(/\|/g, "\\|");
  const rows = report.rules.map((entry) => {
    const first = entry.tests[0];
    const where = first === undefined ? "–" : `\`${first.file}\`:${first.line}`;
    return `| ${entry.rule.id} | ${escape(entry.rule.title)} | ${entry.tests.length} | ${where} |`;
  });
  return ["| Regel | Titel | Tests | erster Fundort |", "| --- | --- | ---: | --- |", ...rows].join("\n");
}
