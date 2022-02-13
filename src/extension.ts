/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as vscode from 'vscode';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import RegexMatchDecorator, { RegexMatch } from './RegexMatchDecorator';

const regexRegex = /(^|\s|[()={},:?;])(\/((?:\\\/|\[[^\]]*\]|[^/])+)\/([gimuy]*))(\s|[()={},:?;]|$)/g;
const phpRegexRegex = /(^|\s|[()={},:?;])['|"](\/((?:\\\/|\[[^\]]*\]|[^/])+)\/([gimuy]*))['|"](\s|[()={},:?;]|$)/g;
const haxeRegexRegex = /(^|\s|[()={},:?;])(~\/((?:\\\/|\[[^\]]*\]|[^/])+)\/([gimsu]*))(\s|[.()={},:?;]|$)/g;

const matchesFileContent = `Lorem ipsum dolor sit amet, consectetur adipiscing elit,
sed do eiusmod tempor incididunt ut labore et dolore magna
aliqua. Ut enim ad minim veniam, quis nostrud exercitation
ullamco laboris nisi ut aliquip ex ea commodo consequat.
Duis aute irure dolor in reprehenderit in voluptate velit
esse cillum dolore eu fugiat nulla pariatur. Excepteur sint
occaecat cupidatat non proident, sunt in culpa qui officia
deserunt mollit anim id est laborum.
`;

const languages = ['javascript', 'javascriptreact', 'typescript', 'typescriptreact', 'vue', 'php', 'haxe'];
const decorators = new Map<vscode.TextEditor, RegexMatchDecorator>();
let addGMEnabled = true;
const toggleGM = vscode.window.createStatusBarItem();
let subscriptions: { dispose(): any }[];
let editorURI : vscode.Uri;
let outputChannel = vscode.window.createOutputChannel("regex");
let activeRegex : RegexMatch | undefined;

export function activate(context: vscode.ExtensionContext) {

    subscriptions = context.subscriptions;
    subscriptions.push(vscode.commands.registerCommand('extension.toggleRegexPreview', toggleRegexPreview));

    languages.forEach(language => {
        subscriptions.push(vscode.languages.registerCodeLensProvider(language, { provideCodeLenses }));
    });

    subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => {
        updateDecorators()
    }));

    subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => {
        updateDecorators();
    }));

    subscriptions.push(vscode.window.onDidChangeTextEditorSelection(e => {
        updateDecorators();
    }));

    subscriptions.push(vscode.workspace.onDidCloseTextDocument(e => {
        for(let editor of decorators.keys()) {
            if(editor.document.uri.fsPath == e.uri.fsPath) {
                decorators.delete(editor);
                decorators.get(editor)?.dispose();
            }
        }
    }));

    subscriptions.push({dispose: () => {
        decorators.forEach(decorator => {
            decorator.dispose();
        })
    }});

    toggleGM.command = 'regexpreview.toggleGM';
    context.subscriptions.push(toggleGM);
    context.subscriptions.push(vscode.commands.registerCommand('regexpreview.toggleGM', () => {
        addGMEnabled = !addGMEnabled;
        updateToggleGM();
        updateDecorators();
    }));

    updateToggleGM();
}

function updateToggleGM() {
    toggleGM.text = addGMEnabled ? 'Adding /gm' : 'Not adding /gm';
    toggleGM.tooltip = addGMEnabled ? 'Click to stop adding global and multiline (/gm) options to regexes for evaluation with example text.' : 'Click to add global and multiline (/gm) options to regexes for evaluation with example text.'
}

function provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken) {
    const config = vscode.workspace.getConfiguration('regex-previewer', document.uri);
    if (!config.enableCodeLens) return;

    const matches = findRegexes(document);
    return matches.map(match => new vscode.CodeLens(match.range, {
        title: 'Test Regex...',
        command: 'extension.toggleRegexPreview',
        arguments: [ match ]
    }));
}

function isEditorEnabled() {
    for(let editor of getVisibleTextEditors()) {
        if(editor.document.uri.fsPath === editorURI?.fsPath) {
            return true;
        }
    }
    return false;
}

function toggleRegexPreview(match : RegexMatch) {
    let enableEditor = !isEditorEnabled();
    if (enableEditor) {
        toggleGM['show']();
        openLoremIpsum();
    } else {
        if (match) {
            updateDecorators(match);
        }
        else {
            toggleGM['hide']();
            decorators.forEach(decorator => decorator.dispose());
            decorators.clear();
        }
    }
}

function openLoremIpsum() {

  if (!editorURI) {
    editorURI = vscode.Uri.joinPath(vscode.Uri.file(os.tmpdir()), uuidv4());
    fs.writeFileSync(editorURI.fsPath, matchesFileContent);
    outputChannel.appendLine(editorURI.fsPath);
    subscriptions.push({dispose: () => {
        fs.rm(editorURI.fsPath, () => {});
    }})
  }

  vscode.workspace.openTextDocument(editorURI).then((document) => {
    vscode.window.showTextDocument(document, vscode.ViewColumn.Beside, true).then(() => {
      updateDecorators();
    });
  });

}

function updateDecorators(match?: RegexMatch) {

    if (!isEditorEnabled()) {
        return;
    }

    if(match) {
        activeRegex = match;
    } else {
        let activeEditor = vscode.window.activeTextEditor;
        if (activeEditor && isLanguageSupported(activeEditor.document)) {
            activeRegex = findRegexAtCaret(activeEditor);
        }
    }

    const remove = new Map(decorators);
    getVisibleTextEditors().forEach(editor => {
        remove.delete(editor);
        let decorator = decorators.get(editor);
        if(isLanguageSupported(editor.document) || editor.document.uri.fsPath === editorURI.fsPath) {
            if(!decorator) {
                decorator = new RegexMatchDecorator(editor);
                subscriptions.push(decorator);
                decorators.set(editor, decorator);
            }
            decorator.update(activeRegex, editorURI, addGMEnabled);
        }
    });
    remove.forEach(decorator => decorator.dispose());
    for(let editor of remove.keys()) {
        decorators.delete(editor);
    }
}

function getVisibleTextEditors() {
    return vscode.window.visibleTextEditors.filter(
      (editor) => typeof editor.viewColumn === "number"
    );
}

function findRegexAtCaret(editor: vscode.TextEditor): RegexMatch | undefined {
    const anchor = editor.selection.anchor;
    const line = editor.document.lineAt(anchor);
    const text = line.text.substr(0, 1000);

    let match: RegExpExecArray | null;
    let regex = getRegexRegex(editor.document.languageId);
    regex.lastIndex = 0;
    while ((match = regex.exec(text)) && (match.index + match[1].length + match[2].length < anchor.character));
    if (match && match.index + match[1].length <= anchor.character) {
        return createRegexMatch(editor.document, anchor.line, match);
    }
}

function findRegexes(document: vscode.TextDocument) {
    const matches: RegexMatch[] = [];
    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        let match: RegExpExecArray | null;
        let regex = getRegexRegex(document.languageId);
        regex.lastIndex = 0;
        const text = line.text.substr(0, 1000);
        while ((match = regex.exec(text))) {
            const result = createRegexMatch(document, i, match);
            if (result) {
                matches.push(result);
            }
        }
    }
    return matches;
}

function getRegexRegex(languageId: String) {
    if (languageId == 'haxe') {
        return haxeRegexRegex;
    } else if (languageId == 'php') {
        return phpRegexRegex;
    }
    return regexRegex;
}

function createRegexMatch(document: vscode.TextDocument, line: number, match: RegExpExecArray) {
    const regex = createRegex(match[3], match[4]);
    if (regex) {
        return {
            document: document,
            regex: regex,
            range: new vscode.Range(line, match.index + match[1].length, line, match.index + match[1].length + match[2].length)
        };
    }
}

function createRegex(pattern: string, flags: string) {
        try {
            return new RegExp(pattern, flags);
        } catch (e) {
            // discard
        }
}

function isLanguageSupported(document : vscode.TextDocument) {
    return languages.indexOf(document.languageId) !== -1;
}