import * as vscode from 'vscode';

import { IHistoryFileProperties, HistoryController } from './history.controller';
import { IHistorySettings, HistorySettings } from './history.settings';

// import path = require('path');

const enum EHistoryTreeItem {
    none = 0,
    group,
    file
}

const enum EHistoryTreeContentKind {
    current = 0,
    all,
    search
}

export default class HistoryTreeProvider implements vscode.TreeDataProvider<HistoryItem>  {

    /* tslint:disable */
    private _onDidChangeTreeData: vscode.EventEmitter<HistoryItem | undefined> = new vscode.EventEmitter<HistoryItem | undefined>();
    readonly onDidChangeTreeData: vscode.Event<HistoryItem | undefined> = this._onDidChangeTreeData.event;
    /* tslint:enable*/

    private currentHistoryFile: string;
    private currentHistoryPath: string;
    private historyFiles: Object; // {yesterday: IHistoryFileProperties[]}
    // save historyItem structure to be able to redraw
    private tree = {};  // {yesterday: {grp: HistoryItem, items: HistoryItem[]}}
    private selection: HistoryItem;
    private noLimit = false;
    private date;   // calculs result of relative date against now()
    private format; // function to format against locale

    public contentKind: EHistoryTreeContentKind = 0;
    private searchPattern: string;

    constructor(private controller: HistoryController) {
        this.initLocation();
    }

    initLocation() {
        vscode.commands.executeCommand('setContext', 'local-history:treeLocation', HistorySettings.getTreeLocation());
    }

    getSettingsItem(): HistoryItem {
        // Node only for settings...
        switch (this.contentKind) {
            case EHistoryTreeContentKind.all:
                return new HistoryItem(this, 'Search: all', EHistoryTreeItem.none, undefined, this.currentHistoryPath);
                break;
            case EHistoryTreeContentKind.current:
                return new HistoryItem(this, 'Search: current', EHistoryTreeItem.none, undefined, this.currentHistoryFile);
                break;
            case EHistoryTreeContentKind.search:
                return new HistoryItem(this, `Search: ${this.searchPattern}`, EHistoryTreeItem.none, undefined, this.searchPattern);
                break;
        }
    }

    getTreeItem(element: HistoryItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: HistoryItem): Promise<HistoryItem[]> {
        return new Promise(resolve => {

            // redraw
            const keys = Object.keys(this.tree);
            if (keys && keys.length) {
                if (!element) {
                    const items = [];
                    items.push(this.getSettingsItem());
                    keys.forEach(key => items.push(this.tree[key].grp));
                    return resolve(items);
                } else if (this.tree[String(element.label)].items) {
                    return resolve(this.tree[String(element.label)].items);
                }
            }

            // rebuild
            let items: HistoryItem[] = [];

            if (!element) { // root

                if (!this.historyFiles) {

                    if (!vscode.window.activeTextEditor || !vscode.window.activeTextEditor.document) { return resolve(items); }

                    const filename = vscode.window.activeTextEditor.document.uri;
                    const settings = this.controller.getSettings(filename);

                    this.loadHistoryFile(filename, settings)
                        .then(() => {
                            items.push(this.getSettingsItem());
                            items.push(...this.loadHistoryGroups(this.historyFiles));
                            resolve(items);
                        });
                } else {
                    items.push(this.getSettingsItem());
                    items.push(...this.loadHistoryGroups(this.historyFiles));
                    resolve(items);
                }
            } else {
                if (element.kind === EHistoryTreeItem.group) {
                    this.historyFiles[String(element.label)].forEach((file) => {
                        items.push(new HistoryItem(this, this.format(file), EHistoryTreeItem.file,
                            vscode.Uri.file(file.file), String(element.label), true));
                    });
                    this.tree[String(element.label)].items = items;
                }
                resolve(items);
            }
        });
    }

    private loadHistoryFile(fileName: vscode.Uri, settings: IHistorySettings): Promise<Object> {

        return new Promise((resolve, reject) => {

            let pattern;
            switch (this.contentKind) {
                case EHistoryTreeContentKind.all:
                    pattern = '**/*.*';
                    break;
                case EHistoryTreeContentKind.current:
                    pattern = fileName.fsPath;
                    break;
                case EHistoryTreeContentKind.search:
                    pattern = this.searchPattern;
                    break;
            }

            this.controller.findGlobalHistory(pattern, this.contentKind === EHistoryTreeContentKind.current, settings, this.noLimit)
                .then(findFiles => {
                    // Current file
                    if (this.contentKind === EHistoryTreeContentKind.current) {
                        const historyFile = this.controller.decodeFile(fileName.fsPath, settings);
                        this.currentHistoryFile = historyFile && historyFile.file;
                    }
                    this.currentHistoryPath = settings.historyPath;

                    // History files
                    this.historyFiles = {};

                    this.format = (file) => {
                        const result = file.date.toLocaleString(settings.dateLocale);
                        if (this.contentKind !== EHistoryTreeContentKind.current) { return `${file.name}${file.ext} (${result})`; }
                        return result;
                    };

                    let grp = 'new';
                    const files = findFiles;
                    if (files && files.length) {
                        files.map(file => this.controller.decodeFile(file, settings))
                            .sort((f1, f2) => {
                                if (!f1 || !f2) { return 0; }
                                if (f1.date > f2.date) { return -1; }
                                if (f1.date < f2.date) { return 1; }
                                return f1.name.localeCompare(f2.name);
                            })
                            .forEach((file, index) => {
                                if (file) {
                                    if (grp !== 'Older') {
                                        grp = this.getRelativeDate(file.date);
                                        if (!this.historyFiles[grp]) { this.historyFiles[grp] = [file]; }
                                        else { this.historyFiles[grp].push(file); }
                                    } else {
                                        this.historyFiles[grp].push(file);
                                    }
                                }
                                // else
                                // this.historyFiles['failed'].push(files[index]);
                            });
                    }
                    return resolve(this.historyFiles);
                });
        });
    }

    private loadHistoryGroups(historyFiles: Object): HistoryItem[] {
        const items = [],
            keys = historyFiles && Object.keys(historyFiles);

        if (keys && keys.length > 0) {
            keys.forEach((key) => {
                const item = new HistoryItem(this, key, EHistoryTreeItem.group);
                this.tree[key] = { grp: item };
                items.push(item);
            });
        }
        else { items.push(new HistoryItem(this, 'No history', EHistoryTreeItem.none)); }

        return items;
    }

    private getRelativeDate(fileDate: Date) {
        const hour = 60 * 60,
            day = hour * 24,
            ref = fileDate.getTime() / 1000;

        if (!this.date) {
            const dt = new Date(),
                now = dt.getTime() / 1000,
                today = dt.setHours(0, 0, 0, 0) / 1000; // clear current hour
            this.date = {
                now: now,
                today: today,
                week: today - ((dt.getDay() || 7) - 1) * day, //  1st day of week (week start monday)
                month: dt.setDate(1) / 1000,        // 1st day of current month
                eLastMonth: dt.setDate(0) / 1000,          // last day of previous month
                lastMonth: dt.setDate(1) / 1000     // 1st day of previous month
            };
        }

        if (this.date.now - ref < hour) { return 'In the last hour'; }
        else if (ref > this.date.today) { return 'Today'; }
        else if (ref > this.date.today - day) { return 'Yesterday'; }
        else if (ref > this.date.week) { return 'This week'; }
        else if (ref > this.date.week - (day * 7)) { return 'Last week'; }
        else if (ref > this.date.month) { return 'This month'; }
        else if (ref > this.date.lastMonth) { return 'Last month'; }
        else { return 'Older'; }
    }

    // private changeItemSelection(select, item) {
    //     if (select)
    //          item.iconPath = this.selectIconPath
    //      else
    //          delete item.iconPath;
    // }

    private redraw() {
        this._onDidChangeTreeData.fire(undefined);
    }

    public changeActiveFile() {
        if (!vscode.window.activeTextEditor) { return; }

        const filename = vscode.window.activeTextEditor.document.uri;
        const settings = this.controller.getSettings(filename);
        const prop = this.controller.decodeFile(filename.fsPath, settings, false);
        if (!prop || prop.file !== this.currentHistoryFile) { this.refresh(); }
    }

    public refresh(noLimit = false): void {
        this.tree = {};
        delete this.selection;
        this.noLimit = noLimit;
        delete this.currentHistoryFile;
        delete this.currentHistoryPath;
        delete this.historyFiles;
        delete this.date;
        this._onDidChangeTreeData.fire(undefined);
    }

    public more(): void {
        if (!this.noLimit) {
            this.refresh(true);
        }
    }

    public deleteAll(): void {
        let message;
        switch (this.contentKind) {
            case EHistoryTreeContentKind.all:
                message = `Delete all history - ${this.currentHistoryPath}?`;
                break;
            case EHistoryTreeContentKind.current:
                message = `Delete history for ${this.currentHistoryFile} ?`;
                break;
            case EHistoryTreeContentKind.search:
                message = `Delete history for ${this.searchPattern} ?`;
                break;
        }

        vscode.window.showInformationMessage(message, { modal: true }, { title: 'Yes' }, { title: 'No', isCloseAffordance: true })
            .then(sel => {
                if (sel.title === 'Yes') {
                    switch (this.contentKind) {
                        case EHistoryTreeContentKind.all:
                            // Delete all history
                            this.controller.deleteAll(this.currentHistoryPath)
                                .then(() => this.refresh())
                                .catch(err => vscode.window.showErrorMessage(`Delete failed: ${err}`));
                            break;
                        case EHistoryTreeContentKind.current:
                            // delete history for current file
                            this.controller.deleteHistory(this.currentHistoryFile)
                                .then(() => this.refresh())
                                .catch(err => vscode.window.showErrorMessage(`Delete failed: ${err}`));
                            break;
                        case EHistoryTreeContentKind.search:
                            // Delete visible history files
                            const keys = Object.keys(this.historyFiles);
                            if (keys && keys.length) {
                                const items = [];
                                keys.forEach(key => items.push(...this.historyFiles[key].map(item => item.file)));
                                this.controller.deleteFiles(items)
                                    .then(() => this.refresh())
                                    .catch(err => vscode.window.showErrorMessage(`Delete failed: ${err}`));
                            }
                            break;
                    }
                }
            },
                (err => { return; })
            );
    }

    public show(file: vscode.Uri): void {
        vscode.commands.executeCommand('vscode.open', file);
    }

    public showEntry(element: HistoryItem): void {
        if (element.kind === EHistoryTreeItem.file) { vscode.commands.executeCommand('vscode.open', element.file); }
    }

    public showSide(element: HistoryItem): void {
        if (element.kind === EHistoryTreeItem.file) { vscode.commands.executeCommand('vscode.open', element.file, Math.min(vscode.window.activeTextEditor.viewColumn + 1, 3)); }
    }

    public delete(element: HistoryItem): void {
        if (element.kind === EHistoryTreeItem.file) {
            this.controller.deleteFile(element.file.fsPath)
                .then(() => this.refresh());
        }
        else if (element.kind === EHistoryTreeItem.group) {
            this.controller.deleteFiles(
                this.historyFiles[String(element.label)].map((value: IHistoryFileProperties) => value.file))
                .then(() => this.refresh());
        }
    }

    public compareToCurrent(element: HistoryItem): void {
        if (element.kind === EHistoryTreeItem.file) {
            let currRange;

            if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document &&
                vscode.window.activeTextEditor.document.fileName === this.currentHistoryFile) {

                const currPos = vscode.window.activeTextEditor.selection.active;
                currRange = new vscode.Range(currPos, currPos);
            };

            this.controller.compare(element.file, vscode.Uri.file(this.currentHistoryFile), undefined, currRange);
        }
    }

    public select(element: HistoryItem): void {
        if (element.kind === EHistoryTreeItem.file) {
            if (this.selection) { delete this.selection.iconPath; }
            this.selection = element;
            // this.selection.iconPath = this.selectIconPath;
            this.tree[element.grp].grp.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            this.redraw();
        }
    }
    public compare(element: HistoryItem): void {
        if (element.kind === EHistoryTreeItem.file) {
            if (this.selection) { this.controller.compare(element.file, this.selection.file); }
            else { vscode.window.showErrorMessage('Select a history files to compare with'); }
        }
    }

    public restore(element: HistoryItem): void {
        if (element.kind === EHistoryTreeItem.file) {
            this.controller.restore(element.file)
                .then(() => this.refresh())
                .catch(err => vscode.window.showErrorMessage(`Restore ${element.file.fsPath} failed. Error: ${err}`));
        }
    }

    public forCurrentFile(): void {
        this.contentKind = EHistoryTreeContentKind.current;
        this.refresh();
    }
    public forAll(): void {
        this.contentKind = EHistoryTreeContentKind.all;
        this.refresh();
    }
    public forSpecificFile(): void {
        vscode.window.showInputBox({ prompt: 'Specify what to search:', value: '**/*myFile*.*', valueSelection: [4, 10] })
            .then(value => {
                if (value) {
                    this.searchPattern = value;
                    this.contentKind = EHistoryTreeContentKind.search;
                    this.refresh();
                }
            });
    }
}

class HistoryItem extends vscode.TreeItem {

    public readonly kind: EHistoryTreeItem;
    public readonly file: vscode.Uri;
    public readonly grp: string;

    constructor(provider: HistoryTreeProvider, label: string = '', kind: EHistoryTreeItem, file?: vscode.Uri,
        grp?: string, showIcon?: boolean) {

        super(label, kind === EHistoryTreeItem.group ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);

        this.kind = kind;
        this.file = file;
        this.grp = this.kind !== EHistoryTreeItem.none ? grp : undefined;

        switch (this.kind) {
            case EHistoryTreeItem.file:
                this.contextValue = 'localHistoryItem';
                this.tooltip = file.fsPath; // TODO remove before .history
                this.resourceUri = file;
                if (showIcon) { this.iconPath = undefined; }
                break;
            case EHistoryTreeItem.group:
                this.contextValue = 'localHistoryGrp';
                break;
            default: // EHistoryTreeItem.none
                this.contextValue = 'localHistoryNone';
                this.tooltip = grp;
        }

        // TODO: if current === file
        if (provider.contentKind === EHistoryTreeContentKind.current) {
            this.command = this.kind === EHistoryTreeItem.file ? {
                command: 'treeLocalHistory.compareToCurrentEntry',
                title: 'Compare with current version',
                arguments: [this]
            } : undefined;
        } else {
            this.command = this.kind === EHistoryTreeItem.file ? {
                command: 'treeLocalHistory.showEntry',
                title: 'Open Local History',
                arguments: [file]
            } : undefined;
        }
    }
}
