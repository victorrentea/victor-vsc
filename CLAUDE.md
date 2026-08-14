# victor-vsc — regula de lucru

**Orice customizare de VS Code pe care o cere Victor se face AICI**, în această
extensie, nu în `~/Library/Application Support/Code/User/settings.json`.
Extensia e singura sursă: culori, iconițe, profiluri de terminal, comenzi,
butoane, keybindings — toate stau versionate în repo.

Repo public: <https://github.com/victorrentea/victor-vsc> (branch `main`).

## Ciclul complet, la fiecare schimbare

1. Editează fișierele de aici.
2. Bump `version` în `package.json` (VS Code nu reinstalează peste aceeași versiune).
3. Împachetează și instalează:
   ```sh
   npx --yes @vscode/vsce package
   "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
     --install-extension victor-vsc-<version>.vsix --force
   ```
   `code` nu e în PATH — de-aia calea completă din bundle.
4. **Commit și push la fiecare schimbare** — nu se lasă lucruri necomise:
   ```sh
   git add -A && git commit -m "..." && git push
   ```
5. Spune-i lui Victor să dea *Developer: Reload Window* — nimic nu se aplică fără.

`*.vsix` e în `.gitignore`, deci artefactele de build nu ajung în repo.

## Unde stă ce

| fișier | ce face |
|---|---|
| `package.json` | toate `contributes`: culori (`configurationDefaults`), icon theme, profil de terminal, custom editor, comenzi, meniuri, setări |
| `COLORS.md` | de ce sunt culorile alea — `package.json` e JSON strict, n-are comentarii |
| `extension.js` | status bar (breadcrumb, problems, cog), profilul de terminal Claude |
| `puml.js` | randare PlantUML + comanda text / split / diagramă |
| `build-flower-font.py` | generează `icons/victor-icons.woff` (floarea din dropdown-ul de terminale) |
| `intellij-icon-theme.json`, `icons/` | icon theme-ul expui |

## Ce NU poate o extensie

Nu are acces la DOM-ul workbench-ului: nu poate schimba fontul/înălțimea
rândurilor din Explorer, nu poate intercepta click-uri de mouse pe UI-ul VS
Code. Astea cer ori o setare oficială, ori un patch de CSS/JS peste aplicație
(extensia „Custom CSS and JS Loader"), care se rupe la fiecare update de VS Code.
Spune-i lui Victor explicit când o cerere cade în categoria asta, nu improviza.
