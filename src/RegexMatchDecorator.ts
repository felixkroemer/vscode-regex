import * as vscode from "vscode";

const regexHighlight = vscode.window.createTextEditorDecorationType({
  backgroundColor: "rgba(100,100,100,.35)",
});
const matchHighlight = vscode.window.createTextEditorDecorationType({
  backgroundColor: "rgba(255,255,0,.35)",
});

export interface RegexMatch {
  document: vscode.TextDocument;

  regex: RegExp;

  range: vscode.Range;
}

interface Match {
  range: vscode.Range;
}

export default class RegexMatchDecorator {
  constructor(private editor: vscode.TextEditor) {}

  public update(
    activeRegex: RegexMatch | undefined,
    editorURI: vscode.Uri,
    addGMEnabled: Boolean
  ) {
    let isEditor = false;
    if (activeRegex) {
      if (
        (isEditor = this.editor.document.uri.fsPath == editorURI.fsPath) ||
        activeRegex?.document.uri.fsPath === this.editor.document.uri.fsPath
      ) {
        const matches = findMatches(
          activeRegex,
          this.editor.document,
          addGMEnabled
        );
        this.editor.setDecorations(
          isEditor ? matchHighlight : regexHighlight,
          matches.map((match) => match.range)
        );
      }
    } else {
      this.editor.setDecorations(matchHighlight, []);
      this.editor.setDecorations(regexHighlight, []);
    }
  }

  public dispose() {
    this.editor.setDecorations(matchHighlight, []);
    this.editor.setDecorations(regexHighlight, []);
  }
}

function findMatches(
  regexMatch: RegexMatch,
  document: vscode.TextDocument,
  addGMEnabled: Boolean
) {
  const text = document.getText();
  const matches: Match[] = [];
  const regex = addGM(regexMatch.regex, addGMEnabled);
  let match: RegExpExecArray | null;
  while ((regex.global || !matches.length) && (match = regex.exec(text))) {
    matches.push({
      range: new vscode.Range(
        document.positionAt(match.index),
        document.positionAt(match.index + match[0].length)
      ),
    });
    // Handle empty matches (fixes #4)
    if (regex.lastIndex === match.index) {
      regex.lastIndex++;
    }
  }
  return matches;
}

function addGM(regex: RegExp, addGMEnabled: Boolean) {
  if (!addGMEnabled || (regex.global && regex.multiline)) {
    return regex;
  }

  let flags = regex.flags;
  if (!regex.global) {
    flags += "g";
  }
  if (!regex.multiline) {
    flags += "m";
  }
  return new RegExp(regex.source, flags);
}
