import * as path from "path";
import * as vscode from "vscode";
import { CacheKey, Constants, ModelType } from "../../common/constants";
import { FileManager } from "../../common/filesManager";
import { Console } from "../../common/outputChannel";
import { Util } from "../../common/util";
import { DbTreeDataProvider } from "../../provider/treeDataProvider";
import { ConnectionManager } from "../../service/connectionManager";
import { DatabaseCache } from "../../service/common/databaseCache";
import { QueryUnit } from "../../service/queryUnit";
import { Node } from "../interface/node";
import { InfoNode } from "../other/infoNode";
import { DatabaseNode } from "./databaseNode";
import { UserGroup } from "./userGroup";
import { Connection } from "mysql";
import { CopyAble } from "../interface/copyAble";

export class ConnectionNode extends Node implements CopyAble {

    public iconPath: string = path.join(Constants.RES_PATH, "icon/server.png");
    public contextValue: string = ModelType.CONNECTION;
    constructor(readonly id: string, readonly parent: Node) {
        super(id)
        this.init(parent)
        this.id=this.getConnectId()
        if (parent.name) {
            this.label = `${parent.name}_${this.id}`
            this.name = parent.name
        }
        const lcp = ConnectionManager.getLastConnectionOption(false);
        if (lcp && lcp.getConnectId() == this.getConnectId()) {
            this.iconPath = path.join(Constants.RES_PATH, "icon/connection-active.svg");
            this.description = `Active`
        }
    }

    public async getChildren(isRresh: boolean = false): Promise<Node[]> {

        let connection: Connection;
        try {
            connection = await ConnectionManager.getConnection(this);
        } catch (err) {
            return [new InfoNode(err)];
        }

        return QueryUnit.queryPromise<any[]>(connection, "show databases")
            .then((databases) => {
                const databaseNodes = databases.filter((db) => {
                    if (this.database) {
                        return db.Database == this.database;
                    }
                    if (this.excludeDatabases) {
                        for (const excludeDatabase of this.excludeDatabases.split(",")) {
                            if (db.Database == excludeDatabase.trim()) { return false; }
                        }
                    }
                    return true;
                }).map<DatabaseNode>((database) => {
                    return new DatabaseNode(database.Database, this);
                });

                if (this.user.toLocaleLowerCase() == "root") {
                    databaseNodes.unshift(new UserGroup("USER", this));
                }

                DatabaseCache.setDataBaseListOfConnection(this.id, databaseNodes);

                return databaseNodes;
            })
            .catch((err) => {
                return [new InfoNode(err)];
            });
    }

    public copyName() {
        Util.copyToBoard(this.host)
    }

    public async newQuery() {

        const key = `${this.getConnectId()}`;
        await FileManager.show(`${key}.sql`);
        const dbNameList = DatabaseCache.getDatabaseListOfConnection(key).filter((databaseNode) => !(databaseNode instanceof UserGroup)).map((databaseNode) => databaseNode.database);
        let dbName;
        if (dbNameList.length == 1) {
            dbName = dbNameList[0]
        }
        if (dbNameList.length > 1) {
            dbName = await vscode.window.showQuickPick(dbNameList, { placeHolder: "active database" })
        }
        if (dbName) {
            await ConnectionManager.getConnection({
                ...this, database: dbName
            } as Node, true);
        }

    }

    public createDatabase() {
        vscode.window.showInputBox({ placeHolder: 'Input you want to create new database name.' }).then(async (inputContent) => {
            if (!inputContent) { return; }
            QueryUnit.queryPromise(await ConnectionManager.getConnection(this), `create database \`${inputContent}\` default character set = 'utf8mb4' `).then(() => {
                DatabaseCache.clearDatabaseCache(this.id);
                DbTreeDataProvider.refresh();
                vscode.window.showInformationMessage(`create database ${inputContent} success!`);
            });
        });
    }

    public async deleteConnection(context: vscode.ExtensionContext) {

        Util.confirm(`Are you want to Delete Connection ${this.id} ? `, async () => {
            const targetContext = this.global === false ? context.workspaceState : context.globalState;
            const connections = targetContext.get<{ [key: string]: Node }>(CacheKey.ConectionsKey);
            ConnectionManager.removeConnection(this.id)
            DatabaseCache.clearDatabaseCache(this.id)
            delete connections[this.id];
            await targetContext.update(CacheKey.ConectionsKey, connections);
            DbTreeDataProvider.refresh();
        })

    }

    public importData(fsPath: string) {
        Console.log(`Doing import ${this.getHost()}:${this.getPort()}...`);
        ConnectionManager.getConnection(this).then((connection) => {
            QueryUnit.runFile(connection, fsPath);
        });
    }

    public static init() { }


}
