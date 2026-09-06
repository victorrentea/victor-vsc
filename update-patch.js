const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile, spawn } = require('child_process');

// „Update with AI" — butonul din stânga celui albastru de update al VS Code.
//
// Un update de VS Code rescrie tot `out/`, deci patch-urile din `vscode-patch/`
// dispar fără niciun mesaj (vezi VSCODE-UPDATE.md). Până acum reaplicarea era un
// pas manual de ținut minte *după* ce aplicația repornea — adică exact momentul
// în care nimeni nu se mai gândește la ea.
//
// Împărțirea muncii e cea deja folosită pentru butonul de unelte și pentru
// liniile din SCM: DOM-ul îl atinge `vscode-patch/workbench.js` (numai el vede
// butonul albastru `.update-indicator.prominent` și numai el poate apăsa în locul
// nostru), iar tot ce cere API sau disc stă aici. Canalul dintre ele e o intrare
// de status bar cu id explicit, ascunsă din CSS:
//
//   workbench.js  --click-->  intrarea `victorrentea.victor-vsc.updatepatch`
//   aici          --armez marker-ul, scriu „armed" în textul intrării-->
//   workbench.js  --vede „armed", apasă butonul albastru al VS Code-ului-->
//   VS Code       --update + repornire-->
//   aici, la activare  --commit-ul s-a schimbat, deci rulez apply.sh-->
//
// De ce trecem prin butonul albastru în loc să executăm noi comanda: acțiunea
// corectă depinde de starea update-ului („available for download" → `update.downloadNow`,
// „downloaded" → `update.install`, „ready" → `update.restart`), iar starea aia
// n-o poate citi o extensie. Butonul o știe; noi doar îl apăsăm.
const ITEM_ID = 'updatepatch';
const MARKER = 'pending-update-patch.json';
const LOG = 'update-patch.log';
const PROMPT = 'update-patch-prompt.txt';

// Cât ține un marker armat. Dacă Victor apasă butonul și apoi amână update-ul
// două săptămâni, nu vrem să reaplicăm patch-ul la un update întâmplător de
// peste o lună, când între timp s-ar putea să fi rulat apply.sh cu mâna.
const MARKER_TTL_MS = 14 * 24 * 60 * 60 * 1000;

// `appRoot` e `<bundle>/Contents/Resources/app`; bundle-ul e cu trei nivele mai sus.
function appBundle() {
  return path.resolve(vscode.env.appRoot, '..', '..', '..');
}

// Versiunea singură nu e destulă: un 1.135.0 → 1.135.1 poate păstra `vscode.version`
// în unele canale, dar commit-ul se schimbă la fiecare build.
function currentBuild() {
  let commit = '';
  try {
    commit = JSON.parse(fs.readFileSync(path.join(vscode.env.appRoot, 'product.json'), 'utf8')).commit || '';
  } catch { /* build fără product.json — rămâne versiunea */ }
  return { version: vscode.version, commit };
}

function patchApplied() {
  try {
    const html = path.join(vscode.env.appRoot, 'out/vs/code/electron-browser/workbench/workbench.html');
    return fs.readFileSync(html, 'utf8').includes('victor-vsc');
  } catch {
    return false;   // entry point mutat: apply.sh spune el ce s-a întâmplat
  }
}

// Sursa de adevăr e repo-ul, nu copia instalată din ~/.vscode/extensions: dacă
// o ancoră s-a rupt, reparația trebuie să ajungă versionată în git, nu într-un
// fișier care se rescrie la următoarea instalare de vsix.
function repoDir() {
  const configured = vscode.workspace.getConfiguration('victorVsc').get('repoPath') || '';
  const candidates = [
    configured.replace(/^~/, os.homedir()),
    path.join(os.homedir(), 'workspace', 'victor-vsc'),
    __dirname,
  ].filter(Boolean);
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'vscode-patch', 'apply.sh'))) return dir;
  }
  return null;
}

function run(cmd, args, opts) {
  return new Promise(resolve => {
    execFile(cmd, args, { maxBuffer: 8 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code ?? 1) : 0, out: `${stdout || ''}${stderr || ''}` });
    });
  });
}

function register(context) {
  const storage = context.globalStorageUri.fsPath;
  fs.mkdirSync(storage, { recursive: true });
  const markerFile = path.join(storage, MARKER);

  // Ascunsă din CSS de vscode-patch/workbench.css. Textul e canalul: workbench.js
  // așteaptă „armed" înainte să apese butonul albastru, ca update-ul să nu plece
  // înaintea marker-ului. Fără patch intrarea se vede jos ca o floricică — și
  // atunci comanda ei rămâne utilă, doar că butonul de update îl apeși singur.
  const item = vscode.window.createStatusBarItem(ITEM_ID, vscode.StatusBarAlignment.Right, -1500000);
  item.name = 'Update with AI';
  item.text = '$(victor-flower)';
  item.tooltip = 'Update VS Code și reaplică patch-urile victor-vsc după repornire';
  item.command = 'victor-vsc.updateWithAi';
  item.show();

  const arm = vscode.commands.registerCommand('victor-vsc.updateWithAi', () => {
    const build = currentBuild();
    fs.writeFileSync(markerFile, JSON.stringify({ ...build, armedAt: new Date().toISOString() }, null, 2));
    item.text = '$(victor-flower) armed';
    // Când patch-ul e aplicat, workbench.js apasă el butonul albastru imediat ce
    // vede „armed" — mesajul ăsta e pentru cazul invers, în care comanda a fost
    // dată din paletă sau din bară.
    if (!patchApplied()) {
      vscode.window.showInformationMessage(
        'Armat: după update reaplic patch-urile victor-vsc. Poți da acum Update.');
    }
  });

  context.subscriptions.push(item, arm);

  // Nu blocăm activarea: apply.sh umblă în /Applications și durează.
  consume(markerFile, storage).catch(() => { /* niciun update nu merită un extension host mort */ });
}

async function consume(markerFile, storage) {
  let marker;
  try { marker = JSON.parse(fs.readFileSync(markerFile, 'utf8')); } catch { return; }

  if (Date.now() - Date.parse(marker.armedAt || 0) > MARKER_TTL_MS) {
    fs.rmSync(markerFile, { force: true });
    return;
  }

  const build = currentBuild();
  // Același build → update-ul n-a avut loc încă (Victor a amânat repornirea, sau
  // asta e a doua fereastră deschisă între timp). Marker-ul rămâne armat.
  if (build.commit && build.commit === marker.commit) return;
  if (!build.commit && build.version === marker.version) return;

  // La pornire se activează TOATE ferestrele deodată, fiecare cu extension host-ul
  // ei, iar două `apply.sh` care rescriu în paralel `workbench.desktop.main.js` ar
  // strica bundle-ul. `rename` e atomic pe APFS, deci marker-ul e și fișier de
  // stare, și lacăt: câștigă o singură fereastră, celelalte iau ENOENT și tac.
  const claimed = `${markerFile}.claimed`;
  try { fs.renameSync(markerFile, claimed); } catch { return; }
  if (patchApplied()) { fs.rmSync(claimed, { force: true }); return; }

  const repo = repoDir();
  if (!repo) {
    fs.rmSync(claimed, { force: true });
    vscode.window.showErrorMessage(
      'Update with AI: nu găsesc vscode-patch/apply.sh — setează `victorVsc.repoPath`.');
    return;
  }

  const apply = path.join(repo, 'vscode-patch', 'apply.sh');
  const { code, out } = await run('/bin/bash', [apply], { cwd: repo });
  fs.rmSync(claimed, { force: true });
  fs.writeFileSync(path.join(storage, LOG),
    `${new Date().toISOString()}  ${marker.version} → ${build.version}  exit=${code}\n${out}\n`);

  // apply.sh nu iese cu cod de eroare când o ancoră nu mai prinde: scrie
  // „ATENȚIE" și lasă valoarea din fabrică (vezi VSCODE-UPDATE.md). Deci semnalul
  // e textul, nu codul de ieșire — și exact ăsta e cazul care cere AI.
  const warnings = out.split('\n').filter(l => l.includes('ATENȚIE'));
  if (code !== 0 || warnings.length) {
    await handOffToClaude(repo, storage, marker, build, code, out, warnings);
    return;
  }

  await restart(build);
}

// Ancorele din apply.sh sunt nume minificați și forme de expresie care se schimbă
// la fiecare release — repararea lor e citit de bundle, adică fix ce face Claude
// mai bine decât un script. De-aia butonul se cheamă „with AI", nu „and repatch".
async function handOffToClaude(repo, storage, marker, build, code, out, warnings) {
  const promptFile = path.join(storage, PROMPT);
  fs.writeFileSync(promptFile, [
    `VS Code s-a actualizat de la ${marker.version} la ${build.version} (commit ${build.commit || '?'}).`,
    `Am rulat ${path.join(repo, 'vscode-patch/apply.sh')} și nu a ieșit curat (exit=${code}):`,
    '',
    (warnings.join('\n') || out.trim().split('\n').slice(-20).join('\n')),
    '',
    'Repară ancorele din vscode-patch/apply.sh pentru noul build — procedura e în',
    'VSCODE-UPDATE.md, capcanele deja plătite sunt în UPDATE-LESSONS.md. Ancora se',
    'caută pe ceva stabil din jur, nu pe numele minificat.',
    '',
    'Apoi rulează din nou ./vscode-patch/apply.sh până iese fără „ATENȚIE", repornește',
    `aplicația (⌘Q + open -a), adaugă o secțiune nouă în UPDATE-LESSONS.md pentru`,
    `${marker.version} → ${build.version} și fă commit + push.`,
  ].join('\n'));

  const terminal = vscode.window.createTerminal({
    name: 'Update with AI',
    cwd: repo,
    iconPath: new vscode.ThemeIcon('victor-flower'),
  });
  terminal.show();
  // Prompt-ul trece prin fișier, nu prin linia de comandă: are ghilimele,
  // diacritice și rânduri noi, iar `sendText` ar trebui să le scape pe toate.
  terminal.sendText(`claude "$(cat ${JSON.stringify(promptFile)})"`);

  vscode.window.showWarningMessage(
    `Update with AI: apply.sh n-a mai găsit ${warnings.length} ancoră/ancore pe ${build.version}. ` +
    'Am pornit Claude în repo ca să le repare.');
}

// Capcana 1 din UPDATE-LESSONS.md: aplicația e deja pornită când patch-ul ajunge
// pe disc, iar renderer-ul a citit workbench.html de mult. Fără repornire completă
// totul e corect pe disc și nimic nu se vede în UI. Reload Window nu ajunge:
// checksum-urile din product.json se verifică doar la pornirea aplicației.
async function restart(build) {
  const auto = vscode.workspace.getConfiguration('victorVsc').get('restartAfterUpdatePatch');
  const applied = `Patch-urile victor-vsc au fost reaplicate peste VS Code ${build.version}`;

  if (!auto) {
    const picked = await vscode.window.showInformationMessage(
      `${applied} — repornește aplicația ca să se vadă.`, 'Repornește acum');
    if (picked === 'Repornește acum') quit();
    return;
  }

  // Câteva secunde în care „Nu reporni" mai contează; nimic de pierdut între
  // timp, fiindcă update-ul tocmai a omorât oricum toate terminalele integrate.
  let cancelled = false;
  vscode.window.showInformationMessage(`${applied} — repornesc aplicația.`, 'Nu reporni')
    .then(picked => { cancelled = picked === 'Nu reporni'; });
  await new Promise(r => setTimeout(r, 6000));
  if (!cancelled) quit();
}

function quit() {
  spawn('/bin/sh', ['-c', `sleep 2; open -a ${JSON.stringify(appBundle())}`],
    { detached: true, stdio: 'ignore' }).unref();
  vscode.commands.executeCommand('workbench.action.quit');
}

module.exports = { register };
