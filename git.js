const path = require('path');
const { execFile } = require('child_process');

// VS Code pornit din Finder moștenește PATH-ul de la launchd, care n-are
// Homebrew; git-ul din Command Line Tools e însă mereu la calea absolută.
const BINARIES = ['git', '/usr/bin/git'];

async function git(cwd, args) {
  let lastError;
  for (const bin of BINARIES) {
    try {
      return await new Promise((resolve, reject) => {
        execFile(bin, args, { cwd }, (err, stdout) => {
          if (err) reject(err);
          else resolve(stdout.trim());
        });
      });
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      lastError = err;
    }
  }
  throw lastError;
}

const repoRoot = (cwd) => git(cwd, ['rev-parse', '--show-toplevel']);

// Remote-ul pe care urmărește branșa curentă, dacă are unul; altfel `origin`,
// altfel primul remote existent — un fork clonat cu alt nume tot trebuie să dea
// un rezultat, nu o eroare.
async function remoteUrl(cwd) {
  const candidates = [];
  try {
    const upstream = await git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    candidates.push(upstream.split('/')[0]);
  } catch { /* branșă fără upstream */ }
  candidates.push('origin');
  const all = (await git(cwd, ['remote'])).split('\n').filter(Boolean);
  candidates.push(...all);
  for (const name of candidates) {
    if (all.includes(name)) return git(cwd, ['remote', 'get-url', name]);
  }
  return undefined;
}

// Branșa curentă, ca în bara de stare. Pe HEAD detașat `--abbrev-ref` întoarce
// literal "HEAD", care n-ar duce nicăieri pe GitHub — acolo cade pe SHA.
async function currentRef(cwd) {
  const branch = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return branch === 'HEAD' ? git(cwd, ['rev-parse', 'HEAD']) : branch;
}

/** Calea fișierului relativ la rădăcina repo-ului, cu `/` chiar și pe Windows. */
const relativeToRoot = (root, fsPath) =>
  path.relative(root, fsPath).split(path.sep).filter(Boolean).join('/');

module.exports = { git, repoRoot, remoteUrl, currentRef, relativeToRoot };
