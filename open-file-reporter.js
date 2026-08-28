const vscode = require('vscode');
const path = require('path');
const http = require('http');
const { repoRoot, remoteUrl, currentRef, relativeToRoot } = require('./git');

// Port din plugin-ul de IntelliJ (live-coding, `openfile/OpenFileReporter.kt`):
// raportează fișierul la care Victor se uită efectiv către Victor Addons, care
// îl împinge mai departe pe WebSocket la daemonul de sesiune. Aceleași reguli,
// ca cele două IDE-uri să se comporte identic în timpul cursului:
//   - raportăm doar după ce fișierul a stat DWELL_MS în fereastra focusată, ca
//     un ⌘P plimbat prin zece fișiere să nu inunde sala;
//   - refocalizarea ferestrei repornește dwell-ul, deci privitul lung al unui
//     fișier deja deschis se raportează și fără schimbare de tab;
//   - același fișier nu se trimite de două ori la rând.
const DWELL_MS = 5000;
const FAILURES_BEFORE_BACKOFF = 3;
const BACKOFF_MS = 5 * 60 * 1000;

// Endpoint-ul e cel al plugin-ului de IntelliJ, cu tot cu numele lui: payload-ul
// e identic și add-on-ul nu se uită de unde vine. Un `/ide/file-opened` neutru
// ar cere modificat și add-on-ul, și plugin-ul, pentru exact același efect.
const DEFAULT_URL = 'http://127.0.0.1:55123/intellij/file-opened';

class OpenFileReporter {
  constructor() {
    this.pending = undefined;
    this.lastSentKey = undefined;
    this.consecutiveFailures = 0;
    this.lastAttemptMillis = 0;
  }

  settings() {
    return vscode.workspace.getConfiguration('victorVsc');
  }

  /** Fișierul din editorul activ, dacă e un fișier de pe disc. */
  activeFile() {
    const uri = vscode.window.activeTextEditor?.document.uri;
    return uri && uri.scheme === 'file' ? uri : undefined;
  }

  /** Tab schimbat, fișier deschis sau fereastră refocusată — (re)pornește dwell-ul. */
  candidateChanged() {
    if (!this.settings().get('reportOpenFileToAddon')) {
      this.consecutiveFailures = 0; // o reactivare manuală merită o încercare curată
      return;
    }
    clearTimeout(this.pending);
    this.pending = undefined;
    const uri = this.activeFile();
    if (!uri || !vscode.window.state.focused) return;
    this.pending = setTimeout(() => this.report(uri), DWELL_MS);
  }

  /** Fereastra a pierdut focusul OS — un dwell pe jumătate nu are voie să tragă. */
  windowBlurred() {
    clearTimeout(this.pending);
    this.pending = undefined;
  }

  async report(uri) {
    if (!this.settings().get('reportOpenFileToAddon')) return;
    // Revalidare: fereastra tot focusată, tot pe același fișier.
    if (!vscode.window.state.focused) return;
    if (this.activeFile()?.toString() !== uri.toString()) return;

    const payload = await this.buildPayload(uri);
    if (!payload) return;

    const key = `${payload.url}|${payload.file}`;
    if (key === this.lastSentKey) return;
    this.lastSentKey = key;
    this.post(payload);
  }

  async buildPayload(uri) {
    try {
      const cwd = path.dirname(uri.fsPath);
      const root = await repoRoot(cwd);
      const url = await remoteUrl(root);
      if (!url) return undefined;
      // Add-on-ul rezolvă linkul de GitHub din remote + cale, deci fișierele
      // din afara unui repo n-au ce căuta acolo.
      return {
        url,
        branch: await currentRef(root),
        file: relativeToRoot(root, uri.fsPath),
        project: vscode.workspace.workspaceFolders?.[0]?.name ?? path.basename(root),
      };
    } catch {
      return undefined; // fișier din afara oricărui repo git
    }
  }

  post(payload) {
    // Fără probă separată de viață: un connect pe 127.0.0.1 cu nimeni în
    // ascultare e refuzat instant (ECONNREFUSED, nu timeout), deci POST-ul pe
    // care oricum îl trimiteam E verificarea. După câteva refuzuri tăcem,
    // reîncercând cel mult o dată la BACKOFF_MS — destul cât să ne revenim dacă
    // add-on-ul pornește după IDE, destul de liniștit pe o mașină fără add-on.
    const now = Date.now();
    if (this.consecutiveFailures >= FAILURES_BEFORE_BACKOFF && now - this.lastAttemptMillis < BACKOFF_MS) return;
    this.lastAttemptMillis = now;

    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const endpoint = new URL(this.settings().get('addonReportUrl') || DEFAULT_URL);
    const request = http.request(
      {
        hostname: endpoint.hostname,
        port: endpoint.port,
        path: endpoint.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
        timeout: 1500,
      },
      (response) => {
        // Add-on-ul a răspuns — e viu, iar un status de eroare nu spune nimic
        // despre asta. Starea siguranței rămâne neatinsă: nici avansată, nici resetată.
        if (response.statusCode < 400) this.consecutiveFailures = 0;
        response.resume();
      },
    );
    request.on('timeout', () => request.destroy());
    request.on('error', () => { this.consecutiveFailures++; });
    request.end(body);
  }

  dispose() {
    clearTimeout(this.pending);
    this.pending = undefined;
  }
}

function register(context) {
  const reporter = new OpenFileReporter();
  context.subscriptions.push(
    reporter,
    vscode.window.onDidChangeActiveTextEditor(() => reporter.candidateChanged()),
    vscode.window.onDidChangeWindowState((state) =>
      state.focused ? reporter.candidateChanged() : reporter.windowBlurred()),
  );
  reporter.candidateChanged(); // fișierul deja deschis la pornirea ferestrei
}

module.exports = { register };
