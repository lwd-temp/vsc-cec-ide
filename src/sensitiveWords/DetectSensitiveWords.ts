import * as vscode from 'vscode';
import * as path from 'path';
import Mint from 'mint-filter';
import { decrypt } from '../utils/EncryptionAndDecryption';

// 创建一个诊断集合对象
const diagnosticCollection = vscode.languages.createDiagnosticCollection('sensitiveWords');
// 记录文件监听器
const documentListeners: { [key: string]: vscode.Disposable } = {};
// 记录文件状态
const fileStates: { [key: string]: boolean } = {};
let statusBar: vscode.StatusBarItem; // 状态栏
let selectedWindow: vscode.TextEditor;
const mintCount: { [key: string]: number } = {}; //记录文件敏感词数量

export function detectSensitiveWords(context: vscode.ExtensionContext, data: string) {
  const mint = initializeSensitiveWords(data, 'chuckle');
  const markCommand = vscode.commands.registerCommand('cec-ide.mark-sensitive-words', () => {
    markSensitiveWords(mint);
  });
  const stopCommand = vscode.commands.registerCommand('cec-ide.stop-mark-sensitive-words', () => {
    stopMarkSensitiveWords();
  });
  context.subscriptions.push(markCommand, stopCommand);
  // 创建状态栏项
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  setStatusbar("default");
  statusBar.show();
  // 取消文档更改事件的监听
  vscode.workspace.onDidCloseTextDocument(closedDocument => {
    cleanUpDocument(closedDocument, () => {
      setStatusbar("default");
      diagnosticCollection.delete(closedDocument.uri);
    });
  });

  vscode.window.onDidChangeActiveTextEditor(editor => {
    if (!editor) {
      return;
    }
    if (mintCount[editor.document.fileName] && fileStates[editor.document.fileName]) {
      setStatusbar("listening", mintCount[editor.document.fileName]);
    } else {
      setStatusbar("default");
    }
  });
}

// 获取敏感词
function initializeSensitiveWords(data: string, password: string) {
  const decryptedText = decrypt(data, password); // 解密
  const sensitiveWordsArray = decryptedText.split('\n').map((word: string) => word.trim());
  const mint = new Mint(sensitiveWordsArray);
  return mint;
}

// 标记敏感词
function markSensitiveWords(mint: Mint) {
  const editor = vscode.window.activeTextEditor;
  if (editor && fileStates[editor.document.fileName]) {
    return; // 已经检测中的文件不重复进行检测
  }
  if (editor && mint) {
    if (detectionMarkDiagnosis(editor, mint)) {
      activateDocumentChangeListener(editor.document, mint); // 注册文档更改监听器
      fileStates[editor.document.fileName] = true; // 记录文件状态为已检测
    }
  } else {
    vscode.window.showErrorMessage('没有活动的文本编辑器。');
  }
}

// 激活文档更改监听器
function activateDocumentChangeListener(document: vscode.TextDocument, mint: Mint) {
  if (!documentListeners[document.fileName]) {
    const listener = vscode.workspace.onDidChangeTextDocument(event => {
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document === document && mint) {
        detectionMarkDiagnosis(editor, mint);
      }
    });
    documentListeners[document.fileName] = listener;
  }
}

// 停止检测敏感词
function stopMarkSensitiveWords() {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    stopSensitiveWordDetection(editor.document);
  }
}

// 停止敏感词检测、清除标记
function stopSensitiveWordDetection(document: vscode.TextDocument) {
  cleanUpDocument(document, () => {
    setStatusbar("default");
    diagnosticCollection.delete(document.uri);
    vscode.window.showInformationMessage(`已停止检测敏感词。`);
  });
}

// 进行文档清理操作
function cleanUpDocument(document: vscode.TextDocument, callback?: () => void) {
  if (fileStates[document.fileName]) {
    delete fileStates[document.fileName];
    if (documentListeners[document.fileName]) {
      documentListeners[document.fileName].dispose();
      delete documentListeners[document.fileName];
    }
    if (callback) {
      callback();
    }
  }
}

// 检测敏感词、标记诊断
function detectionMarkDiagnosis(editor: vscode.TextEditor, mint: Mint) {
  const document = editor.document;
  const text = document.getText();
  const sensitiveWords = new Set(mint.filter(text).words); // 使用 Set 来存储唯一的敏感词
  const diagnostics: vscode.Diagnostic[] = [];

  for (const word of sensitiveWords) {
    const wordRegExp = new RegExp(word, 'gi');
    let match;

    while ((match = wordRegExp.exec(text)) !== null) {
      const startPos = document.positionAt(match.index);
      const endPos = document.positionAt(match.index + word.length);
      const range = new vscode.Range(startPos, endPos);

      const diagnostic = new vscode.Diagnostic(range, '敏感词', vscode.DiagnosticSeverity.Warning);
      diagnostic.source = '敏感词检测';
      diagnostic.relatedInformation = [
        new vscode.DiagnosticRelatedInformation(new vscode.Location(document.uri, range), `${word}`)
      ];

      diagnostics.push(diagnostic);
      mintCount[editor.document.fileName] = diagnostics.length;
      setStatusbar("listening", mintCount[editor.document.fileName]);
    }
  }

  diagnosticCollection.delete(document.uri);

  if (diagnostics.length > 0) {
    diagnosticCollection.set(document.uri, diagnostics);
  } else {
    vscode.window.showInformationMessage(`${path.basename(document.fileName)}中已没有敏感词，停止检测。`);
    cleanUpDocument(document, ()=>{
      setStatusbar("default");
    });
  }
  return diagnostics.length;
}

function setStatusbar(type: string, count?: number) {
  if (type === "default") {
    statusBar.command = 'cec-ide.mark-sensitive-words';
    statusBar.text = `$(cec-ide-line) 敏感词检测`;
    statusBar.tooltip = '点击进行敏感词检测';
  }
  else if (type === "listening") {
    statusBar.text = `$(cec-ide-line) 检测到 ${count} 敏感词`;
    statusBar.tooltip = '点击停止检测';
    statusBar.command = 'cec-ide.stop-mark-sensitive-words';
  }
}

